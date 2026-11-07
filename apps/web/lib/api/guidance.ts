/**
 * Guided journey — readiness gates and "the one next step" for an event.
 * Contract: docs/contracts/ux-v3-api.md §2 (readiness) and §3 (next-step).
 *
 * The backend is authoritative. When the endpoints are unavailable the UI falls
 * back to `deriveFallbackNextStep`, which only uses data the app already has
 * (shortlist, approvals, incidents, event fields) and never invents facts.
 */
import { apiRequest } from "./client";

/* ── Types (from the contract) ─────────────────────────────── */

export type GuidePageId =
  | "overview"
  | "vendors"
  | "venue"
  | "decisions"
  | "plan"
  | "budget"
  | "conversations"
  | "live"
  | "problems"
  | "setup"
  | "report"
  | "team"
  | "activity"
  | "audit";

export type GuideStage = "DEFINE" | "DISCOVER" | "CONTACT" | "DECIDE" | "PLAN" | "READY" | "LIVE" | "RECOVER" | "DONE";
export type GuideUrgency = "normal" | "attention" | "critical";

export type GuideStepId =
  | "complete_details"
  | "start_discovery"
  | "discovery_running"
  | "pick_vendors"
  | "approve_requests"
  | "awaiting_replies"
  | "review_quotes"
  | "fix_plan_blockers"
  | "compute_schedule"
  | "go_live"
  | "run_event"
  | "resolve_problem"
  | "event_done";

export interface NextStep {
  event_id: string;
  step_id: GuideStepId | string;
  stage: GuideStage | string;
  urgency: GuideUrgency;
  title: string;
  body: string;
  cta_label: string;
  page: GuidePageId | string;
  path: string;
  count?: number | null;
  completed_steps?: string[];
  /** null / missing → every page is available */
  unlocked_pages?: string[] | null;
  progress?: { done: number; total: number } | null;
}

export type GateStatus = "done" | "in_progress" | "blocked" | "not_started" | "not_applicable";

export interface ReadinessGate {
  id: string;
  label: string;
  status: GateStatus | string;
  detail?: string | null;
  progress?: { done: number; total: number } | null;
  action?: { label: string; page: string; path: string } | null;
}

export interface Readiness {
  event_id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "AT_RISK" | "BLOCKED" | "READY" | "LIVE" | "DONE" | string;
  days_until_event?: number | null;
  gates: ReadinessGate[];
}

/* ── Page routing ──────────────────────────────────────────── */

const PAGE_SEGMENT: Record<GuidePageId, string> = {
  overview: "",
  vendors: "vendors",
  venue: "venue",
  decisions: "approvals",
  plan: "plan",
  budget: "budget",
  conversations: "conversations",
  live: "live",
  problems: "incidents",
  setup: "setup",
  report: "report",
  team: "collaborators",
  activity: "activity",
  audit: "audit",
};

export function pagePath(eventId: string, page: GuidePageId | string): string {
  const seg = PAGE_SEGMENT[page as GuidePageId];
  if (seg === undefined) return `/events/${eventId}`;
  return seg ? `/events/${eventId}/${seg}` : `/events/${eventId}`;
}

/** Which guide page a pathname belongs to (null when it isn't an event page). */
export function pageFromPath(pathname: string | null | undefined): GuidePageId | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/events\/[^/]+(?:\/([^/?#]+))?/);
  if (!m) return null;
  const seg = m[1] || "";
  if (seg === "new") return null;
  if (seg === "recovery") return "problems";
  if (seg === "negotiations") return "conversations";
  if (seg === "tasks" || seg === "schedule") return "plan";
  const entry = (Object.entries(PAGE_SEGMENT) as Array<[GuidePageId, string]>).find(([, s]) => s === seg);
  return entry ? entry[0] : null;
}

/** Normalise a step path for comparison with the current pathname. */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const clean = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean(a) === clean(b);
}

/* ── Fetchers ──────────────────────────────────────────────── */

/** Returns null when the endpoint isn't available, so callers can fall back. */
export async function getNextStep(eventId: string): Promise<NextStep | null> {
  try {
    const res = await apiRequest<NextStep>(`/events/${eventId}/next-step`);
    if (!res || typeof res !== "object" || !res.step_id || !res.title) return null;
    return { ...res, path: res.path || pagePath(eventId, res.page) };
  } catch {
    return null;
  }
}

export async function getReadiness(eventId: string): Promise<Readiness | null> {
  try {
    const res = await apiRequest<Readiness>(`/events/${eventId}/readiness`);
    if (!res || !Array.isArray(res.gates)) return null;
    return res;
  } catch {
    return null;
  }
}

/* ── Client-side fallback ──────────────────────────────────── */

export interface FallbackInput {
  eventId: string;
  event?: {
    name?: string | null;
    location?: string | null;
    guest_count?: number | null;
    total_budget?: number | string | null;
    start_datetime?: string | null;
    lifecycle_state?: string | null;
  } | null;
  shortlist?: Array<{
    status?: string | null;
    category?: string | null;
    candidate_data?: Record<string, any> | null;
  }> | null;
  approvals?: Array<{ status?: string | null }> | null;
  incidents?: Array<{ status?: string | null; severity?: string | null; title?: string | null }> | null;
  isAgentRunning?: boolean;
}

const OPEN_INCIDENT = (s?: string | null) => {
  const v = (s || "").toUpperCase();
  return v !== "RESOLVED" && v !== "CLOSED" && v !== "CANCELLED";
};

function hasContacted(entry: { candidate_data?: Record<string, any> | null }): boolean {
  const comm = entry.candidate_data?.communication;
  if (!comm) return false;
  const sent = (s?: string) => !!s && s !== "NOT_ATTEMPTED" && s !== "NOT_REQUESTED";
  return sent(comm.whatsapp_status) || sent(comm.call_status) || sent(comm.overall_status);
}

/**
 * Minimal, honest next step from data the app already loaded.
 * Mirrors the backend priority order: problem → approvals → picks → discovery → replies → plan.
 * `unlocked_pages` is null here: without the backend we don't hide anything.
 */
export function deriveFallbackNextStep(input: FallbackInput): NextStep {
  const { eventId, event } = input;
  const shortlist = input.shortlist ?? [];
  const approvals = input.approvals ?? [];
  const incidents = input.incidents ?? [];

  const base = (s: Omit<NextStep, "event_id" | "path" | "completed_steps" | "unlocked_pages">): NextStep => ({
    ...s,
    event_id: eventId,
    path: pagePath(eventId, s.page),
    completed_steps: [],
    unlocked_pages: null,
  });

  const openIncidents = incidents.filter((i) => OPEN_INCIDENT(i.status));
  if (openIncidents.length > 0) {
    const critical = openIncidents.some((i) => ["CRITICAL", "HIGH"].includes((i.severity || "").toUpperCase()));
    return base({
      step_id: "resolve_problem",
      stage: "RECOVER",
      urgency: critical ? "critical" : "attention",
      title: openIncidents.length === 1 ? openIncidents[0].title || "A problem needs your attention" : `${openIncidents.length} problems need your attention`,
      body: "See what's affected and choose how to fix it. Nothing changes until you approve a fix.",
      cta_label: "Open problems",
      page: "problems",
      count: openIncidents.length,
    });
  }

  const pending = approvals.filter((a) => (a.status || "").toUpperCase() === "PENDING");
  if (pending.length > 0) {
    return base({
      step_id: "approve_requests",
      stage: "DECIDE",
      urgency: "attention",
      title: pending.length === 1 ? "One request is waiting for your OK" : `${pending.length} requests are waiting for your OK`,
      body: "EVENTRA only contacts vendors or commits to anything after you approve it.",
      cta_label: "Review requests",
      page: "decisions",
      count: pending.length,
    });
  }

  const byCat = new Map<string, { recommended: number; selected: number }>();
  for (const s of shortlist) {
    const cat = (s.category || "OTHER").toUpperCase();
    const row = byCat.get(cat) ?? { recommended: 0, selected: 0 };
    if ((s.status || "").toUpperCase() === "SELECTED") row.selected += 1;
    else row.recommended += 1;
    byCat.set(cat, row);
  }
  const unpicked = Array.from(byCat.entries()).filter(([, r]) => r.selected === 0 && r.recommended > 0);
  if (unpicked.length > 0) {
    return base({
      step_id: "pick_vendors",
      stage: "DISCOVER",
      urgency: "attention",
      title: unpicked.length === 1 ? "Pick a vendor to contact" : `Pick vendors for ${unpicked.length} categories`,
      body: "EVENTRA found options that fit your event. Pick the ones you want EVENTRA to contact for a quote.",
      cta_label: "Compare options",
      page: "overview",
      count: unpicked.length,
    });
  }

  const missingDetails = !event?.location || !event?.guest_count || !Number(event?.total_budget) || !event?.start_datetime;
  if (shortlist.length === 0 && input.isAgentRunning) {
    return base({
      step_id: "discovery_running",
      stage: "DISCOVER",
      urgency: "normal",
      title: "EVENTRA is finding vendors",
      body: "This usually takes a minute or two. You'll be asked to pick when options are ready.",
      cta_label: "Watch progress",
      page: "overview",
      count: null,
    });
  }
  if (shortlist.length === 0 && missingDetails) {
    return base({
      step_id: "complete_details",
      stage: "DEFINE",
      urgency: "normal",
      title: "Finish your event details",
      body: "Date, city, guest count and budget let EVENTRA search for vendors that actually fit.",
      cta_label: "Add details",
      page: "setup",
      count: null,
    });
  }
  if (shortlist.length === 0) {
    return base({
      step_id: "start_discovery",
      stage: "DISCOVER",
      urgency: "normal",
      title: "Let EVENTRA find your vendors",
      body: "EVENTRA searches venues and suppliers that fit your city, guest count and budget.",
      cta_label: "Start finding vendors",
      page: "overview",
      count: null,
    });
  }

  const selected = shortlist.filter((s) => (s.status || "").toUpperCase() === "SELECTED");
  const contacted = selected.filter(hasContacted);
  if (contacted.length > 0) {
    return base({
      step_id: "awaiting_replies",
      stage: "CONTACT",
      urgency: "normal",
      title: "See what vendors replied",
      body: "Replies, call results and quotes appear in Messages & Calls as they arrive.",
      cta_label: "Open messages",
      page: "conversations",
      count: contacted.length,
    });
  }

  if ((event?.lifecycle_state || "").toUpperCase() === "LIVE") {
    return base({
      step_id: "run_event",
      stage: "LIVE",
      urgency: "normal",
      title: "Your event is live",
      body: "Follow the run of show and respond to anything that comes up.",
      cta_label: "Open live view",
      page: "live",
      count: null,
    });
  }

  return base({
    step_id: "fix_plan_blockers",
    stage: "PLAN",
    urgency: "normal",
    title: "Check what your plan still needs",
    body: "The plan shows which tasks still need a vendor or a time before the event can run.",
    cta_label: "Open the plan",
    page: "plan",
    count: null,
  });
}

/* ── Presentation helpers ──────────────────────────────────── */

export const STAGE_ORDER: GuideStage[] = ["DEFINE", "DISCOVER", "CONTACT", "DECIDE", "PLAN", "READY", "LIVE"];

export const STAGE_LABEL: Record<string, string> = {
  DEFINE: "Define",
  DISCOVER: "Discover",
  CONTACT: "Contact",
  DECIDE: "Decide",
  PLAN: "Plan",
  READY: "Ready",
  LIVE: "Live",
  RECOVER: "Recover",
  DONE: "Done",
};
