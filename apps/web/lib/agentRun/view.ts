/**
 * Derives the agent run view (lifecycle, phase, per-workflow progress) purely
 * from the persisted run record and its ordered progress events. Nothing here
 * invents progress: every field traces back to a backend event.
 */
import type { AgentRunEvent, AgentRunRecord } from "@/lib/api/agentRuns";

export type RunLifecycle =
  | "idle"
  | "running"
  | "cancelling"
  | "awaiting_selection"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

const STATUS_LIFECYCLE: Record<string, RunLifecycle> = {
  INITIALIZED: "running",
  RUNNING: "running",
  DISCOVERING: "running",
  CANCELLING: "cancelling",
  WAITING_FOR_USER_SELECTION: "awaiting_selection",
  PENDING_APPROVAL: "awaiting_approval",
  WAITING_FOR_APPROVAL: "awaiting_approval",
  COMPLETED: "completed",
  EXECUTED: "completed",
  VERIFIED: "completed",
  FAILED: "failed",
  RECOVERY_FAILED: "failed",
  CANCELLED: "cancelled",
  PAUSED: "paused",
};

const EVENT_LIFECYCLE: Record<string, RunLifecycle> = {
  "agent.run_started": "running",
  "agent.cancel_requested": "cancelling",
  "selection.required": "awaiting_selection",
  "approval.required": "awaiting_approval",
  "agent.run_completed": "completed",
  "agent.run_failed": "failed",
  "agent.run_cancelled": "cancelled",
  "agent.run_paused": "paused",
};

const FAILED_TOOL_STATUSES = new Set(["FAILED", "FAILURE", "UNSUPPORTED", "VERIFICATION_FAILED"]);

/** Lifecycles in which the backend may still emit events for the run. */
export function isStreamOpen(lifecycle: RunLifecycle): boolean {
  return ["running", "cancelling", "awaiting_selection", "awaiting_approval"].includes(lifecycle);
}

/** Lifecycles in which a worker is executing (Agent button must stay disabled). */
export function isExecuting(lifecycle: RunLifecycle): boolean {
  return lifecycle === "running" || lifecycle === "cancelling";
}

export function lifecycleOf(run: AgentRunRecord | null, events: AgentRunEvent[]): RunLifecycle {
  if (!run) return "idle";
  // Events are persisted after the status they describe is committed, so the
  // latest lifecycle event is at least as fresh as the run record snapshot.
  for (let i = events.length - 1; i >= 0; i--) {
    const lifecycle = EVENT_LIFECYCLE[events[i].type];
    if (lifecycle) return lifecycle;
  }
  return STATUS_LIFECYCLE[run.status] ?? "running";
}

export type DiscoveryStatus = "idle" | "searching" | "completed" | "empty" | "failed";

export interface VenueCandidate {
  shortlist_entry_id?: string;
  venue_id?: string;
  name: string;
  capacity?: number | null;
  city?: string | null;
  address?: string | null;
  hourly_rate?: number | null;
  has_contact_phone?: boolean;
  score?: number | null;
  rank?: number;
  shortlist_status?: string;
  source?: string | null;
}

export interface VenueProgress {
  status: DiscoveryStatus;
  discoveryRunId?: string;
  location?: string;
  guestCount?: number;
  minCapacity?: number;
  source?: string;
  capacityFilterRelaxed?: boolean;
  total?: number;
  candidates: VenueCandidate[];
  error?: string;
}

export interface ProviderCandidate {
  shortlist_entry_id?: string;
  vendor_id?: string | null;
  name: string;
  city?: string | null;
  rating?: number | null;
  has_contact_phone?: boolean;
  score?: number | null;
  rank?: number;
  qualification?: "qualified" | "pending_verification" | "rejected" | null;
  qualification_reason?: string | null;
  source?: string | null;
  from_cache?: boolean;
  shortlist_status?: string;
}

export interface ProviderCounts {
  discovered?: number;
  unique?: number;
  qualified?: number;
  pending_verification?: number;
  rejected?: number;
  recommended?: number;
}

export interface ProviderMilestone {
  sequence: number;
  milestone: string;
  message: string;
  iteration: number;
}

export interface ProviderProgress {
  category: string;
  status: DiscoveryStatus;
  discoveryRunId?: string;
  location?: string;
  milestones: ProviderMilestone[];
  counts?: ProviderCounts;
  candidates: ProviderCandidate[];
  usedCachedProviders?: boolean;
  error?: string;
}

export interface CommunicationProgress {
  key: string;
  candidateName?: string;
  category?: string;
  assignmentId?: string;
  approvalId?: string;
  updates: { sequence: number; channel?: string; status: string; detail?: string }[];
}

export interface RunView {
  lifecycle: RunLifecycle;
  phase?: { phase: string; label?: string; category?: string };
  activeTool?: string;
  venue: VenueProgress;
  providers: ProviderProgress[];
  communications: CommunicationProgress[];
  approval?: { approvalId?: string; action?: string; reason?: string };
  selection?: { categories: { category: string; status: string; candidates_count: number }[] };
  error?: string;
}

export function deriveRunView(run: AgentRunRecord | null, events: AgentRunEvent[]): RunView {
  const view: RunView = {
    lifecycle: lifecycleOf(run, events),
    venue: { status: "idle", candidates: [] },
    providers: [],
    communications: [],
  };
  const providers = new Map<string, ProviderProgress>();
  const comms = new Map<string, CommunicationProgress>();
  const openTools: string[] = [];

  const provider = (category: string): ProviderProgress => {
    let p = providers.get(category);
    if (!p) {
      p = { category, status: "idle", milestones: [], candidates: [] };
      providers.set(category, p);
    }
    return p;
  };
  const communication = (data: Record<string, any>): CommunicationProgress => {
    const key = String(data.assignment_id ?? data.candidate_id ?? data.candidate_name ?? "communication");
    let c = comms.get(key);
    if (!c) {
      c = { key, updates: [] };
      comms.set(key, c);
    }
    c.candidateName = data.candidate_name ?? c.candidateName;
    c.category = data.category ?? c.category;
    c.assignmentId = data.assignment_id ?? c.assignmentId;
    c.approvalId = data.approval_id ?? c.approvalId;
    return c;
  };

  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case "agent.phase_changed":
        view.phase = { phase: d.phase, label: d.label, category: d.category };
        break;
      case "agent.tool_started":
        openTools.push(d.tool);
        break;
      case "agent.tool_completed": {
        const idx = openTools.lastIndexOf(d.tool);
        if (idx !== -1) openTools.splice(idx, 1);
        if (FAILED_TOOL_STATUSES.has(d.status)) {
          if (d.tool === "venue_search") {
            view.venue.status = "failed";
            view.venue.error = d.error;
          } else if (d.category) {
            const p = provider(d.category);
            p.status = "failed";
            p.error = d.error;
          }
        } else if (d.tool === "venue_search") {
          view.venue.capacityFilterRelaxed = Boolean(d.capacity_filter_relaxed);
        }
        break;
      }
      case "venue.discovery_started":
        view.venue = {
          status: "searching",
          candidates: [],
          discoveryRunId: d.discovery_run_id,
          location: d.location,
          guestCount: d.guest_count,
          minCapacity: d.min_capacity,
          source: d.source,
        };
        break;
      case "venue.results_updated":
        view.venue.status = d.status === "EMPTY" ? "empty" : "completed";
        view.venue.total = d.total;
        view.venue.candidates = d.candidates ?? [];
        break;
      case "provider.discovery_started": {
        const p = provider(d.category);
        p.status = "searching";
        p.discoveryRunId = d.discovery_run_id;
        p.location = d.location;
        p.milestones = [];
        p.candidates = [];
        p.error = undefined;
        break;
      }
      case "provider.discovery_progress":
        provider(d.category).milestones.push({
          sequence: ev.sequence,
          milestone: d.milestone,
          message: d.message,
          iteration: d.iteration,
        });
        break;
      case "provider.results_updated": {
        const p = provider(d.category);
        p.status = d.status === "EMPTY" ? "empty" : "completed";
        p.counts = d.counts;
        p.candidates = d.candidates ?? [];
        p.usedCachedProviders = Boolean(d.used_cached_providers);
        break;
      }
      case "communication.started":
        communication(d).updates.push({ sequence: ev.sequence, status: "STARTED", detail: d.message });
        break;
      case "communication.status_changed":
        communication(d).updates.push({
          sequence: ev.sequence,
          channel: d.channel,
          status: d.status,
          detail: d.detail ?? d.error,
        });
        break;
      case "approval.required":
        view.approval = { approvalId: d.approval_id, action: d.action, reason: d.reason };
        break;
      case "selection.required":
        view.selection = { categories: d.categories ?? [] };
        break;
      case "agent.run_failed":
        view.error = d.error;
        break;
    }
  }

  // A run that stopped mid-discovery leaves that discovery unfinished, not "searching".
  if (!isStreamOpen(view.lifecycle) || view.lifecycle === "awaiting_selection") {
    if (view.venue.status === "searching") view.venue.status = "failed";
    providers.forEach((p) => {
      if (p.status === "searching") p.status = "failed";
    });
  }

  view.activeTool = openTools[openTools.length - 1];
  view.providers = Array.from(providers.values());
  view.communications = Array.from(comms.values());
  return view;
}

/** Short human-readable description of a progress event for timelines. */
export function describeEvent(ev: AgentRunEvent): string | null {
  const d = ev.data ?? {};
  const cat = d.category ? String(d.category).replace(/_/g, " ").toLowerCase() : "";
  switch (ev.type) {
    case "agent.run_started":
      return "Run started";
    case "agent.phase_changed":
      return d.label ?? `Phase: ${d.phase}`;
    case "agent.tool_started":
      return `Running ${String(d.tool).replace(/_/g, " ")}${cat ? ` (${cat})` : ""}`;
    case "agent.tool_completed": {
      const tool = String(d.tool).replace(/_/g, " ");
      if (FAILED_TOOL_STATUSES.has(d.status)) return `${tool} failed`;
      if (d.status === "REQUIRES_APPROVAL") return `${tool} needs approval`;
      return d.result_count != null ? `${tool} returned ${d.result_count} result(s)` : `${tool} finished`;
    }
    case "venue.discovery_started":
      return `Searching venues in ${d.location} for ${d.guest_count} guests`;
    case "venue.results_updated":
      return d.status === "EMPTY" ? "No suitable venues found" : `${d.candidates?.length ?? 0} venues recommended`;
    case "provider.discovery_started":
      return `Discovering ${cat} providers in ${d.location}`;
    case "provider.discovery_progress":
      return d.message ?? null;
    case "provider.results_updated":
      return d.status === "EMPTY"
        ? `No suitable ${cat} providers found`
        : `${d.candidates?.length ?? 0} ${cat} providers recommended`;
    case "communication.started":
      return `Outreach started: ${d.candidate_name ?? "provider"}`;
    case "communication.status_changed":
      return `${d.channel ?? "Communication"} ${String(d.status).toLowerCase()}${d.candidate_name ? `: ${d.candidate_name}` : ""}`;
    case "approval.required":
      return "Approval required";
    case "selection.required":
      return "Waiting for your selection";
    case "agent.cancel_requested":
      return "Cancellation requested";
    case "agent.run_completed":
      return "Run completed";
    case "agent.run_failed":
      return `Run failed${d.error ? `: ${d.error}` : ""}`;
    case "agent.run_cancelled":
      return "Run cancelled";
    case "agent.run_paused":
      return "Run stopped: event execution is paused";
    default:
      return null;
  }
}
