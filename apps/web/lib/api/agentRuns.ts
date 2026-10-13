/**
 * Agent run progress API: persisted run state, replayable events, live stream.
 */
import { API_BASE_URL, apiRequest, getOperatorId } from "./client";

export interface AgentRunRecord {
  id: string;
  run_id: string;
  event_id: string;
  user_id?: string | null;
  trigger_message?: string | null;
  objective?: string | null;
  status: string;
  termination_status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  final_response?: string | null;
  error?: string | null;
}

export interface AgentRunEvent {
  id: string;
  run_id: string;
  event_id: string;
  sequence: number;
  type: string;
  timestamp?: string | null;
  data: Record<string, any>;
}

export interface AgentRunSnapshot {
  run: AgentRunRecord | null;
  events: AgentRunEvent[];
  last_sequence: number;
}

export interface AgentRunEventPage {
  run_id: string;
  run_status: string;
  items: AgentRunEvent[];
  last_sequence: number;
}

export function getCurrentAgentRun(eventId: string): Promise<AgentRunSnapshot> {
  return apiRequest<AgentRunSnapshot>(`/events/${eventId}/agent/runs/current`);
}

export function getAgentRunEvents(eventId: string, runId: string, after = 0): Promise<AgentRunEventPage> {
  return apiRequest<AgentRunEventPage>(`/events/${eventId}/agent/runs/${runId}/events`, { params: { after } });
}

export function cancelAgentRun(eventId: string, runId: string): Promise<AgentRunRecord> {
  return apiRequest<AgentRunRecord>(`/events/${eventId}/agent/runs/${runId}/cancel`, { method: "POST" });
}

export function agentRunStreamUrl(eventId: string, runId: string): string {
  return `${API_BASE_URL}/events/${eventId}/agent/runs/${runId}/stream`;
}

export function agentRunStreamHeaders(lastSequence: number, runId: string): Record<string, string> {
  const headers: Record<string, string> = { "x-user-id": getOperatorId() };
  if (lastSequence > 0) headers["Last-Event-ID"] = `${runId}:${lastSequence}`;
  return headers;
}
