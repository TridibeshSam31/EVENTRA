import { apiRequest } from "./client";

export interface ShortlistEntry {
  id: string;
  event_id: string;
  candidate_id: string;
  provider_id?: string | null;
  category?: string | null;
  candidate_name?: string | null;
  status: string;
  ranking?: number | null;
  notes?: string | null;
  candidate_data?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface ShortlistListResponse {
  items: ShortlistEntry[];
  total: number;
}

export async function getEventShortlist(
  eventId: string,
  category?: string
): Promise<ShortlistListResponse> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  return apiRequest<ShortlistListResponse>(`/events/${eventId}/shortlist${query}`);
}

export async function addShortlistEntry(
  eventId: string,
  payload: {
    candidate_id: string;
    provider_id?: string | null;
    category?: string | null;
    candidate_name?: string | null;
    status?: string;
    ranking?: number | null;
    notes?: string | null;
    candidate_data?: Record<string, any>;
  }
): Promise<ShortlistEntry> {
  return apiRequest<ShortlistEntry>(`/events/${eventId}/shortlist`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function removeShortlistEntry(
  eventId: string,
  candidateId: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}`,
    {
      method: "DELETE",
    }
  );
}
