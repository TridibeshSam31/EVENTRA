import { apiClient } from "./client";
import type {
  EventCreate,
  EventResponse,
  EventSpecification,
  EventSpecificationPreviewRequest,
} from "../../types/api";

export async function listEvents(): Promise<EventResponse[]> {
  try {
    return await apiClient.get<EventResponse[]>("/events");
  } catch {
    return [];
  }
}

export async function getEvent(eventId: string): Promise<EventResponse> {
  return apiClient.get<EventResponse>(`/events/${eventId}`);
}

export async function createEvent(payload: EventCreate): Promise<EventResponse> {
  return apiClient.post<EventResponse>("/events", payload);
}

export async function previewEventSpecification(
  payload: EventSpecificationPreviewRequest
): Promise<EventSpecification> {
  return apiClient.post<EventSpecification>("/events/specification/preview", payload);
}

export async function getEventSpecification(
  eventId: string
): Promise<EventSpecification> {
  return apiClient.get<EventSpecification>(`/events/${eventId}/specification`);
}

export async function getEventMembers(eventId: string): Promise<any[]> {
  return apiClient.get<any[]>(`/events/${eventId}/members`);
}

export async function processEventIntake(payload: {
  message: string;
  event_id?: string;
  force_plan?: boolean;
}): Promise<any> {
  return apiClient.post<any>("/events/intake", payload);
}

export async function modifyEventPlan(
  eventId: string,
  payload: { modification: string }
): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/modify-plan`, payload);
}

export async function startAutonomousOperations(eventId: string): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/start-operations`);
}

export async function getEventOperationsStatus(eventId: string): Promise<any> {
  return apiClient.get<any>(`/events/${eventId}/operations/status`);
}

export async function simulateCancellationIncident(eventId: string): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/incidents/simulate-cancellation`);
}

export async function approveRecoveryAction(eventId: string, approvalId: string): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/recovery/approve`, { approval_id: approvalId });
}

export async function pauseEvent(
  eventId: string,
  payload: { reason: string; plan_version?: number }
): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/pause`, payload);
}

export async function resumeEvent(
  eventId: string,
  payload?: { reason?: string; plan_version?: number }
): Promise<any> {
  return apiClient.post<any>(`/events/${eventId}/resume`, payload || {});
}

export async function getEventExecutionState(eventId: string): Promise<any> {
  return apiClient.get<any>(`/events/${eventId}/execution-state`);
}

export async function getEventPauseHistory(eventId: string): Promise<any[]> {
  return apiClient.get<any[]>(`/events/${eventId}/pause-history`);
}



