import { apiRequest } from "./client";
import type { DiscoveryRun, DiscoveryRunEvent, DiscoveryRunListResponse } from "@/types/discoveryRun";

export async function getDiscoveryRuns(eventId: string): Promise<DiscoveryRunListResponse> {
  return apiRequest<DiscoveryRunListResponse>(`/events/${eventId}/discovery-runs`);
}

export async function getDiscoveryRun(eventId: string, runId: string): Promise<DiscoveryRun> {
  return apiRequest<DiscoveryRun>(`/events/${eventId}/discovery-runs/${runId}`);
}

export async function getDiscoveryRunEvents(
  eventId: string,
  runId: string
): Promise<{ items: DiscoveryRunEvent[]; total: number }> {
  return apiRequest<{ items: DiscoveryRunEvent[]; total: number }>(
    `/events/${eventId}/discovery-runs/${runId}/events`
  );
}

export async function startOperations(
  eventId: string
): Promise<{ status: string; run_id?: string; message: string }> {
  return apiRequest<{ status: string; run_id?: string; message: string }>(
    `/events/${eventId}/start-operations`,
    {
      method: "POST",
    }
  );
}
