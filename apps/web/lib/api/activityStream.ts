import { apiRequest } from "./client";
import type { ActivityStreamResponse } from "@/types/activityLog";

export async function getActivityStream(
  eventId: string,
  limit: number = 50
): Promise<ActivityStreamResponse> {
  return apiRequest<ActivityStreamResponse>(`/events/${eventId}/activity-stream?limit=${limit}`);
}
