/**
 * Agent Run Store
 *
 * Client mirror of the backend's persisted agent run and its ordered progress
 * events. State is always reconstructed from the backend (snapshot + replay by
 * sequence), never from timers or component state, so refreshes, reconnects and
 * navigation all converge on the same authoritative view.
 */
import { create } from "zustand";
import { startOperations } from "@/lib/api/discoveryRuns";
import {
  agentRunStreamHeaders,
  agentRunStreamUrl,
  cancelAgentRun,
  getCurrentAgentRun,
  type AgentRunEvent,
  type AgentRunRecord,
} from "@/lib/api/agentRuns";
import { openSseStream } from "@/lib/sse";
import { decideAutoNav, navTargetForEvent, type NavTarget } from "@/lib/agentRun/navigation";
import { isExecuting, isStreamOpen, lifecycleOf } from "@/lib/agentRun/view";

export type StreamConnection = "idle" | "connecting" | "live" | "reconnecting" | "closed";

const AUTO_NAV_STORAGE_KEY = "eventra_agent_auto_navigate";
const MAX_BACKOFF_MS = 15000;

interface PendingNav extends NavTarget {
  sequence: number;
}

interface AgentRunState {
  eventId: string | null;
  run: AgentRunRecord | null;
  events: AgentRunEvent[];
  lastSequence: number;
  hydrated: boolean;
  loadError: string | null;
  starting: boolean;
  startError: string | null;
  cancelling: boolean;
  connection: StreamConnection;
  autoNavigate: boolean;
  navSuppressed: boolean;
  lastAutoNavPath: string | null;
  pendingNav: PendingNav | null;
  suggestion: NavTarget | null;

  hydrate: (eventId: string) => Promise<void>;
  startRun: (eventId: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  setAutoNavigate: (enabled: boolean) => void;
  resolvePendingNav: (currentPath: string | null) => string | null;
  dismissSuggestion: () => void;
  applyEvent: (ev: AgentRunEvent, live: boolean) => void;
  disconnect: () => void;
}

function readAutoNavPreference(): boolean {
  try {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(AUTO_NAV_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// Connection bookkeeping lives outside React state: it is not rendered.
let streamAbort: AbortController | null = null;
let streamGeneration = 0;
let hydrateInFlight: { eventId: string; promise: Promise<void> } | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useAgentRunStore = create<AgentRunState>((set, get) => {
  const runIsLive = () => {
    const { run, events } = get();
    return isStreamOpen(lifecycleOf(run, events));
  };

  async function streamLoop(eventId: string, runId: string, generation: number, signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted && generation === streamGeneration) {
      set({ connection: attempt === 0 ? "connecting" : "reconnecting" });
      try {
        await openSseStream({
          url: agentRunStreamUrl(eventId, runId),
          headers: agentRunStreamHeaders(get().lastSequence, runId),
          signal,
          onOpen: () => {
            attempt = 0;
            set({ connection: "live" });
          },
          onFrame: (frame) => {
            if (frame.event === "connected" || !frame.data) return;
            try {
              get().applyEvent(JSON.parse(frame.data) as AgentRunEvent, true);
            } catch {
              // Malformed frame: skip it; replay by sequence recovers anything missed.
            }
          },
        });
      } catch (err) {
        if (signal.aborted) return;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) {
          set({ connection: "closed", loadError: errorMessage(err, "Not allowed to view this run") });
          return;
        }
      }
      if (signal.aborted || generation !== streamGeneration) return;
      if (!runIsLive()) {
        set({ connection: "closed" });
        return;
      }
      set({ connection: "reconnecting" });
      attempt += 1;
      await sleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt - 1, 4)));
    }
  }

  function connect(eventId: string, runId: string) {
    get().disconnect();
    streamGeneration += 1;
    const controller = new AbortController();
    streamAbort = controller;
    void streamLoop(eventId, runId, streamGeneration, controller.signal);
  }

  function adoptSnapshot(eventId: string, run: AgentRunRecord | null, events: AgentRunEvent[], live: boolean) {
    const sameRun = get().run?.run_id === run?.run_id && get().eventId === eventId;
    set({
      eventId,
      run,
      events: [],
      lastSequence: 0,
      hydrated: true,
      loadError: null,
      ...(sameRun ? {} : { navSuppressed: false, lastAutoNavPath: null, pendingNav: null, suggestion: null }),
    });
    for (const ev of events) get().applyEvent(ev, live);
    if (run && runIsLive()) connect(eventId, run.run_id);
    else set({ connection: run ? "closed" : "idle" });
  }

  return {
    eventId: null,
    run: null,
    events: [],
    lastSequence: 0,
    hydrated: false,
    loadError: null,
    starting: false,
    startError: null,
    cancelling: false,
    connection: "idle",
    autoNavigate: readAutoNavPreference(),
    navSuppressed: false,
    lastAutoNavPath: null,
    pendingNav: null,
    suggestion: null,

    hydrate: async (eventId) => {
      if (hydrateInFlight?.eventId === eventId) return hydrateInFlight.promise;
      if (get().eventId !== eventId) {
        get().disconnect();
        set({ eventId, run: null, events: [], lastSequence: 0, hydrated: false, connection: "idle" });
      }
      const promise = (async () => {
        try {
          const snapshot = await getCurrentAgentRun(eventId);
          if (get().eventId !== eventId) return;
          // Restored history never triggers navigation.
          adoptSnapshot(eventId, snapshot.run, snapshot.events, false);
        } catch (err) {
          if (get().eventId === eventId) {
            set({ hydrated: true, loadError: errorMessage(err, "Could not load agent status") });
          }
        }
      })();
      hydrateInFlight = { eventId, promise };
      try {
        await promise;
      } finally {
        if (hydrateInFlight?.promise === promise) hydrateInFlight = null;
      }
    },

    startRun: async (eventId) => {
      const { starting, run, events } = get();
      if (starting) return;
      if (get().eventId === eventId && isExecuting(lifecycleOf(run, events))) return;
      set({ starting: true, startError: null });
      try {
        const res = await startOperations(eventId);
        const snapshot = await getCurrentAgentRun(eventId);
        // For a run this click started, everything recorded so far is new to the
        // user, so it drives navigation. A pre-existing run is restored silently.
        const startedHere = res.status === "STARTED" && snapshot.run?.run_id === res.run_id;
        get().disconnect();
        set({ eventId });
        adoptSnapshot(eventId, snapshot.run, snapshot.events, startedHere);
      } catch (err) {
        set({ startError: errorMessage(err, "Could not start the agent") });
      } finally {
        set({ starting: false });
      }
    },

    cancelRun: async () => {
      const { eventId, run, cancelling } = get();
      if (!eventId || !run || cancelling) return;
      set({ cancelling: true });
      try {
        const record = await cancelAgentRun(eventId, run.run_id);
        set((s) => ({ run: s.run ? { ...s.run, status: record.status } : s.run }));
      } catch (err) {
        set({ startError: errorMessage(err, "Could not cancel the run") });
      } finally {
        set({ cancelling: false });
      }
    },

    setAutoNavigate: (enabled) => {
      try {
        window.localStorage.setItem(AUTO_NAV_STORAGE_KEY, String(enabled));
      } catch {
        // Preference persistence is best-effort.
      }
      set({ autoNavigate: enabled, navSuppressed: enabled ? false : get().navSuppressed, suggestion: null });
    },

    resolvePendingNav: (currentPath) => {
      const { pendingNav, autoNavigate, navSuppressed, lastAutoNavPath } = get();
      if (!pendingNav) return null;
      const decision = decideAutoNav({
        enabled: autoNavigate,
        suppressed: navSuppressed,
        currentPath,
        lastAutoNavPath,
        target: pendingNav,
      });
      const target = { path: pendingNav.path, label: pendingNav.label };
      if (decision.action === "navigate") {
        set({ pendingNav: null, navSuppressed: decision.suppressed, lastAutoNavPath: target.path, suggestion: null });
        return target.path;
      }
      set({
        pendingNav: null,
        navSuppressed: decision.suppressed,
        suggestion: decision.action === "suggest" ? target : get().suggestion,
      });
      return null;
    },

    dismissSuggestion: () => set({ suggestion: null }),

    applyEvent: (ev, live) => {
      const { run, lastSequence, eventId } = get();
      if (!run || ev.run_id !== run.run_id || ev.sequence <= lastSequence) return;
      const target = live && eventId ? navTargetForEvent(eventId, ev) : null;
      // Run lifecycle is derived from lifecycle events (see lifecycleOf), not from
      // per-event `status` fields, which describe tools/discoveries.
      set((s) => ({
        events: [...s.events, ev],
        lastSequence: ev.sequence,
        ...(target ? { pendingNav: { ...target, sequence: ev.sequence } } : {}),
      }));
    },

    disconnect: () => {
      streamGeneration += 1;
      streamAbort?.abort();
      streamAbort = null;
    },
  };
});
