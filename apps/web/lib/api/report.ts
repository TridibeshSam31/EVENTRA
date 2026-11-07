/**
 * Event report — UX v3 contract §5 (`GET /events/{id}/report`).
 * Returns null when the backend doesn't provide a report yet (404), so the
 * page can show an honest "not available" state instead of an error.
 */
import { apiRequest, ApiError } from "./client";

export interface EventReport {
  event?: {
    id?: string;
    name?: string;
    type?: string | null;
    start?: string | null;
    end?: string | null;
    location?: string | null;
    guests?: number | null;
  } | null;
  budget?: {
    total?: number | null;
    committed?: number | null;
    currency?: string | null;
    spent_by_category?: Array<{ category: string; estimated?: number | null; committed?: number | null }>;
  } | null;
  vendors?: Array<{ name?: string | null; category?: string | null; status?: string | null; agreed_cost?: number | null }>;
  incidents?: {
    total?: number;
    resolved?: number;
    open?: number;
    by_type?: Record<string, number>;
    items?: Array<{ title?: string | null; severity?: string | null; status?: string | null; resolution?: string | null }>;
  } | null;
  approvals?: { total?: number; approved?: number; rejected?: number; expired?: number } | null;
  communication?: { messages_sent?: number; calls_made?: number; replies?: number } | null;
  timeline?: { tasks_total?: number; tasks_done?: number; on_time?: number; late?: number } | null;
}

export async function getEventReport(eventId: string): Promise<EventReport | null> {
  try {
    return await apiRequest<EventReport>(`/events/${eventId}/report`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}
