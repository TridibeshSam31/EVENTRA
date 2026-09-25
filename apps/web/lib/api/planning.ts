import { apiClient } from "./client";
import type { EventPlan, FinalExecutionPlan } from "../../types/api";

export async function generatePlan(eventId: string): Promise<EventPlan> {
  return apiClient.post<EventPlan>(`/events/${eventId}/plan`);
}

export async function getPlan(eventId: string): Promise<EventPlan> {
  return apiClient.get<EventPlan>(`/events/${eventId}/plan`);
}

export async function getFinalExecutionPlan(eventId: string): Promise<FinalExecutionPlan> {
  return apiClient.get<FinalExecutionPlan>(`/events/${eventId}/execution-plan`);
}

export async function generateFinalExecutionPlan(eventId: string): Promise<FinalExecutionPlan> {
  return apiClient.post<FinalExecutionPlan>(`/events/${eventId}/execution-plan/generate`);
}
