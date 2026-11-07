"use client";

/**
 * Guided journey state: the event's next step + readiness, whether the big
 * "next step" card is open, and per-event memory of what the user already saw.
 *
 * Data comes from /next-step and /readiness (ux-v3 contract). When those are
 * unavailable, the next step is derived client-side from the workspace store.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { setAdvancedMode } from "@/hooks/useAdvancedMode";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  deriveFallbackNextStep,
  getNextStep,
  getReadiness,
  samePage,
  type NextStep,
  type Readiness,
} from "@/lib/api/guidance";

const SHOW_ALL_KEY = "eventra.guide.showAll";
const seenKey = (eventId: string) => `eventra.guide.v1.${eventId}`;
const POLL_MS = 15000;

interface SeenRecord {
  stepId: string;
  pillHidden?: boolean;
}

function readSeen(eventId: string): SeenRecord | null {
  try {
    const raw = localStorage.getItem(seenKey(eventId));
    return raw ? (JSON.parse(raw) as SeenRecord) : null;
  } catch {
    return null;
  }
}

function writeSeen(eventId: string, rec: SeenRecord) {
  try {
    localStorage.setItem(seenKey(eventId), JSON.stringify(rec));
  } catch {
    /* storage may be unavailable */
  }
}

function readShowAll(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === "1";
  } catch {
    return false;
  }
}

interface GuideState {
  eventId: string | null;
  nextStep: NextStep | null;
  readiness: Readiness | null;
  source: "api" | "fallback" | null;
  /** Big card visibility */
  cardOpen: boolean;
  /** Title of the step that was just completed (shown as "✓ Done — …") */
  doneTitle: string | null;
  /** Floating pill hidden by the user (normal urgency only) */
  pillHidden: boolean;
  /** Step whose target element should be spotlighted on its page */
  coachFor: string | null;
  showAll: boolean;

  setShowAll: (on: boolean) => void;
  openCard: () => void;
  minimize: () => void;
  hidePill: () => void;
  /** User pressed the card's CTA: close card, remember, spotlight on arrival */
  followCta: () => void;
  clearCoach: () => void;
  /** Internal: apply a freshly loaded step */
  _apply: (eventId: string, step: NextStep, readiness: Readiness | null, source: "api" | "fallback", pathname: string | null) => void;
  _onPath: (pathname: string | null) => void;
  _reset: (eventId: string | null) => void;
}

export const useGuideStore = create<GuideState>((set, get) => ({
  eventId: null,
  nextStep: null,
  readiness: null,
  source: null,
  cardOpen: false,
  doneTitle: null,
  pillHidden: false,
  coachFor: null,
  showAll: false,

  setShowAll: (on) => {
    try {
      localStorage.setItem(SHOW_ALL_KEY, on ? "1" : "0");
    } catch {}
    // "Show all pages" also exposes the operator views the old Advanced toggle used to.
    setAdvancedMode(on);
    set({ showAll: on });
  },

  openCard: () => set({ cardOpen: true }),

  minimize: () => {
    const { eventId, nextStep } = get();
    if (eventId && nextStep) writeSeen(eventId, { stepId: nextStep.step_id, pillHidden: false });
    set({ cardOpen: false, doneTitle: null, pillHidden: false });
  },

  hidePill: () => {
    const { eventId, nextStep } = get();
    if (!nextStep || nextStep.urgency === "critical") return;
    if (eventId) writeSeen(eventId, { stepId: nextStep.step_id, pillHidden: true });
    set({ pillHidden: true });
  },

  followCta: () => {
    const { eventId, nextStep } = get();
    if (eventId && nextStep) writeSeen(eventId, { stepId: nextStep.step_id, pillHidden: false });
    set({ cardOpen: false, doneTitle: null, coachFor: nextStep?.step_id ?? null });
  },

  clearCoach: () => set({ coachFor: null }),

  _apply: (eventId, step, readiness, source, pathname) => {
    const prev = get().eventId === eventId ? get().nextStep : null;
    const changed = !prev || prev.step_id !== step.step_id;
    const seen = readSeen(eventId);
    const alreadySeen = seen?.stepId === step.step_id;

    let cardOpen = get().cardOpen;
    let doneTitle = get().doneTitle;
    let coachFor = get().coachFor;
    let pillHidden = alreadySeen ? !!seen?.pillHidden && step.urgency !== "critical" : false;

    if (changed && !alreadySeen) {
      if (samePage(pathname, step.path)) {
        // Already where the step happens: no pop-up, just point at the action.
        writeSeen(eventId, { stepId: step.step_id });
        cardOpen = false;
        coachFor = step.step_id;
      } else {
        cardOpen = true;
        const justCompleted =
          !!prev &&
          prev.step_id !== step.step_id &&
          step.urgency !== "critical" &&
          (source === "fallback" || (step.completed_steps ?? []).includes(prev.step_id));
        doneTitle = justCompleted ? prev!.title : null;
      }
      pillHidden = false;
    }

    set({ eventId, nextStep: step, readiness, source, cardOpen, doneTitle, coachFor, pillHidden });
  },

  _onPath: (pathname) => {
    const { nextStep, cardOpen, eventId } = get();
    if (!nextStep || !eventId) return;
    if (samePage(pathname, nextStep.path)) {
      if (cardOpen) {
        writeSeen(eventId, { stepId: nextStep.step_id });
        set({ cardOpen: false, doneTitle: null, coachFor: nextStep.step_id });
      }
    }
  },

  _reset: (eventId) =>
    set({
      eventId,
      nextStep: null,
      readiness: null,
      source: null,
      cardOpen: false,
      doneTitle: null,
      pillHidden: false,
      coachFor: null,
    }),
}));

/**
 * Mount once (AppShell). Loads next step + readiness for the event, polls every
 * 15 s, refreshes on window focus and on live updates, and falls back to the
 * workspace data when the backend endpoints are unavailable.
 */
export function useGuideController(eventId: string | null, pathname: string | null) {
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // Persisted preference
  useEffect(() => {
    useGuideStore.setState({ showAll: readShowAll() });
  }, []);

  useEffect(() => {
    useGuideStore.getState()._reset(eventId);
    if (!eventId) return;
    let cancelled = false;

    const load = async () => {
      const [step, readiness] = await Promise.all([getNextStep(eventId), getReadiness(eventId)]);
      if (cancelled) return;
      if (step) {
        useGuideStore.getState()._apply(eventId, step, readiness, "api", pathRef.current);
        return;
      }
      // Fallback: derive from the workspace (load it if this page hasn't).
      const ws = useWorkspaceStore.getState();
      if (ws.eventId !== eventId) {
        ws.setEventId(eventId);
        return; // the workspace subscription below will derive once it loads
      }
      if (ws.loadedEventId !== eventId) return;
      useGuideStore.getState()._apply(eventId, fallbackFromWorkspace(eventId), readiness, "fallback", pathRef.current);
    };

    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    // Live updates + workspace loads → refresh
    let lastVersion = useWorkspaceStore.getState().liveVersion;
    let lastLoaded = useWorkspaceStore.getState().loadedEventId;
    const unsub = useWorkspaceStore.subscribe((s) => {
      if (s.eventId !== eventId) return;
      const versionBumped = s.liveVersion !== lastVersion;
      const justLoaded = s.loadedEventId === eventId && lastLoaded !== eventId;
      lastVersion = s.liveVersion;
      lastLoaded = s.loadedEventId;
      if (versionBumped) {
        load();
      } else if (justLoaded && useGuideStore.getState().source !== "api") {
        useGuideStore
          .getState()
          ._apply(eventId, fallbackFromWorkspace(eventId), useGuideStore.getState().readiness, "fallback", pathRef.current);
      } else if (useGuideStore.getState().source === "fallback" && s.loadedEventId === eventId) {
        // Workspace data changed (pick, approve…): re-derive immediately.
        const step = fallbackFromWorkspace(eventId);
        const cur = useGuideStore.getState().nextStep;
        if (!cur || cur.step_id !== step.step_id || cur.count !== step.count) {
          useGuideStore.getState()._apply(eventId, step, useGuideStore.getState().readiness, "fallback", pathRef.current);
        }
      }
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [eventId]);

  useEffect(() => {
    useGuideStore.getState()._onPath(pathname);
  }, [pathname]);
}

function fallbackFromWorkspace(eventId: string): NextStep {
  const ws = useWorkspaceStore.getState();
  return deriveFallbackNextStep({
    eventId,
    event: ws.event,
    shortlist: ws.shortlist,
    approvals: ws.approvals,
    incidents: ws.incidents,
    isAgentRunning: ws.isAgentRunning,
  });
}

/** Convenience selector hook for consumers. */
export function useGuide() {
  return useGuideStore();
}
