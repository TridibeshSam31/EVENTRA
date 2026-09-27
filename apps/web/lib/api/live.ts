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
