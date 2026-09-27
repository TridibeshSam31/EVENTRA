import { apiRequest } from "./client";
import type { DiscoveryRun, DiscoveryRunEvent, DiscoveryRunListResponse } from "@/types/discoveryRun";

export async function getDiscoveryRuns(
  eventId: string,
  category?: string
): Promise<DiscoveryRunListResponse> {
  const query = category ? `?category=${encodeURIComponent(category.toLowerCase())}` : "";
  return apiRequest<DiscoveryRunListResponse>(`/events/${eventId}/discovery-runs${query}`);
}

export async function getDiscoveryRun(eventId: string, runId: string): Promise<DiscoveryRun> {
  return apiRequest<DiscoveryRun>(`/events/${eventId}/discovery-runs/${runId}`);
}

export async function getDiscoveryRunEvents(
  eventId: string,
  runId: string
): Promise<DiscoveryRunEvent[]> {
  const res = await apiRequest<any>(
    `/events/${eventId}/discovery-runs/${runId}/events`
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
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
