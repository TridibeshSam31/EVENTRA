import type { AgentRunEvent, AgentRunRecord } from "@/lib/api/agentRuns";

export const EVENT_ID = "evt-1";
export const RUN_ID = "RUN-ABC12345";

export function makeRun(status = "RUNNING", runId = RUN_ID): AgentRunRecord {
  return { id: `id-${runId}`, run_id: runId, event_id: EVENT_ID, status };
}

export function makeEvent(sequence: number, type: string, data: Record<string, any> = {}, runId = RUN_ID): AgentRunEvent {
  return {
    id: `${runId}:${sequence}`,
    run_id: runId,
    event_id: EVENT_ID,
    sequence,
    type,
    timestamp: new Date(Date.UTC(2026, 9, 13, 12, 0, sequence)).toISOString(),
    data,
  };
}

/** A realistic event sequence as recorded by the backend for a successful discovery run. */
export function discoveryRunEvents(): AgentRunEvent[] {
  return [
    makeEvent(1, "agent.run_started", { status: "RUNNING" }),
    makeEvent(2, "agent.phase_changed", { phase: "VENUE_DISCOVERY", status: "DISCOVERING", label: "Discovering venues in Delhi" }),
    makeEvent(3, "venue.discovery_started", {
      discovery_run_id: "disc_v",
      location: "Delhi",
      guest_count: 100,
      min_capacity: 80,
      source: "EVENTRA_VENUE_CATALOG",
    }),
    makeEvent(4, "agent.tool_started", { tool: "venue_search" }),
    makeEvent(5, "agent.tool_completed", { tool: "venue_search", status: "SUCCESS", result_count: 1 }),
    makeEvent(6, "venue.results_updated", {
      discovery_run_id: "disc_v",
      status: "COMPLETED",
      total: 1,
      candidates: [
        { shortlist_entry_id: "sl-1", name: "Grand Hall", capacity: 150, hourly_rate: null, has_contact_phone: false, score: 0.9, rank: 1, source: "DATABASE" },
      ],
    }),
    makeEvent(7, "agent.phase_changed", { phase: "PROVIDER_DISCOVERY", category: "CATERING", label: "Discovering Catering providers in Delhi" }),
    makeEvent(8, "provider.discovery_started", { category: "CATERING", discovery_run_id: "disc_c", location: "Delhi" }),
    makeEvent(9, "provider.discovery_progress", {
      category: "CATERING",
      milestone: "batch_scraped",
      iteration: 1,
      message: "3 candidates discovered from directory/scraper",
    }),
    makeEvent(10, "provider.results_updated", {
      category: "CATERING",
      status: "COMPLETED",
      counts: { discovered: 3, unique: 3, qualified: 1, pending_verification: 1, rejected: 1, recommended: 2 },
      candidates: [
        { shortlist_entry_id: "sl-2", name: "Spice Caterers", rating: 4.2, qualification: "qualified", source: "GOOGLE_MAPS" },
        { shortlist_entry_id: "sl-3", name: "Unverified Kitchen", rating: null, qualification: "pending_verification", source: "GOOGLE_MAPS" },
      ],
    }),
    makeEvent(11, "selection.required", {
      status: "WAITING_FOR_USER_SELECTION",
      categories: [{ category: "VENUE", status: "RECOMMENDED", candidates_count: 1 }],
    }),
  ];
}
