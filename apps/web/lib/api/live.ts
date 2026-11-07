import { apiClient } from "./client";
import type {
  EventLiveState,
  TaskProgress,
  ProviderOperationalSummary,
} from "../../types/api";

export async function goLive(
  eventId: string,
  reason: string = "Operations commencing on schedule"
): Promise<EventLiveState> {
  return apiClient.post<EventLiveState>(`/events/${eventId}/go-live`, { reason });
}

export async function getLiveState(eventId: string): Promise<EventLiveState> {
  return apiClient.get<EventLiveState>(`/events/${eventId}/live-state`);
}

export async function updateTaskStatus(
  eventId: string,
  taskId: string,
  status: string,
  actualStart?: string,
  actualEnd?: string
): Promise<TaskProgress> {
  return apiClient.put<TaskProgress>(
    `/events/${eventId}/tasks/${taskId}/status`,
    {
      status,
      actual_start: actualStart,
      actual_end: actualEnd,
    }
  );
}

export async function getProvidersLiveState(
  eventId: string
): Promise<ProviderOperationalSummary> {
  return apiClient.get<ProviderOperationalSummary>(
    `/events/${eventId}/providers/live-state`
  );
}

export async function concludeEvent(
  eventId: string,
  reason: string = "Operations completed"
): Promise<EventLiveState> {
  return apiClient.post<EventLiveState>(`/events/${eventId}/conclude`, { reason });
}

export type OperationalStatus = "ON_TRACK" | "AT_RISK" | "CRITICAL" | "UNKNOWN";

export interface OperationalIssue {
  kind: "INCIDENT" | "TASK" | "COMMUNICATION";
  id: string;
  title: string;
  severity: string;
  status: string;
  vendor_id?: string | null;
  task_id?: string | null;
  evidence?: string | null;
  detected_at?: string | null;
  updated_at?: string | null;
  consequence?: string | null;
  action: { label: string; href: string };
}

export interface OperationalSummary {
  event: { id: string; name: string; start_datetime: string | null; lifecycle_state: string; state: string };
  status: OperationalStatus;
  status_reasons: string[];
  tasks: { total: number; completed: number; in_progress: number; blocked: number; failed: number; by_status: Record<string, number> };
  vendors: {
    vendor_id: string;
    name: string | null;
    category: string | null;
    selected: boolean;
    contact_approval: string;
    whatsapp: string;
    call: string;
    commitment: string;
    agreed_cost: number | null;
  }[];
  pending_approvals: { id: string; action_type: string; impact_level: string; recovery_option_id: string | null; created_at: string | null; link: string }[];
  milestones: { task_id: string; name: string; planned_start: string | null; status: string }[];
  budget: { currency: string; total: number | null; committed: number; pending_quotes: number; remaining: number | null; basis: string };
  issues: OperationalIssue[];
  next_action: { title: string; reason?: string | null; label: string; href: string } | null;
  timeline: { id: string; at: string | null; actor: string; category: string; action: string; summary: string; needs_review: boolean }[];
  generated_at: string;
}

/** Organizer summary built from authoritative backend records only. */
export async function getOperationalSummary(eventId: string): Promise<OperationalSummary> {
  return apiClient.get<OperationalSummary>(`/events/${eventId}/operations/summary`);
}
