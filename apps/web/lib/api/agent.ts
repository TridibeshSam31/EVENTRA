import { apiClient } from "./client";
import type {
  AgentRunRequest,
  AgentRunResponse,
  AgentToolSummary,
  OperationsStatusResponse,
} from "../../types/api";

export async function runOperationsAgent(
  eventId: string,
  payload: AgentRunRequest
): Promise<AgentRunResponse> {
  return apiClient.post<AgentRunResponse>(
    `/agent/events/${eventId}/run`,
    payload
  );
}

export async function getAgentTools(
  eventId?: string
): Promise<AgentToolSummary[]> {
  const url = eventId ? `/agent/events/${eventId}/tools` : `/agent/tools`;
  return apiClient.get<AgentToolSummary[]>(url);
}

export async function getOperationsStatus(
  eventId: string
): Promise<OperationsStatusResponse> {
  return apiClient.get<OperationsStatusResponse>(`/events/${eventId}/operations/status`);
}
