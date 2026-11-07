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
  selection_source?: string | null;
  selected_by?: string | null;
  selected_at?: string | null;
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
    selection_source?: string | null;
    selected_by?: string | null;
    selected_at?: string | null;
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

export async function selectShortlistCandidate(
  eventId: string,
  candidateId: string
): Promise<ShortlistEntry> {
  return apiRequest<ShortlistEntry>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/select`,
    {
      method: "POST",
    }
  );
}

export async function approveShortlistCommunication(
  eventId: string,
  candidateId: string
): Promise<ShortlistEntry> {
  return apiRequest<ShortlistEntry>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/approve-communication`,
    {
      method: "POST",
    }
  );
}

export type CommunicationChannel = "whatsapp" | "call";

export interface ChannelCommunicationState {
  status: string;
  provider?: string | null;
  provider_ref?: string | null;
  error?: string | null;
  attempt_count: number;
  retryable: boolean;
  last_attempt_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  message_text?: string | null;
  duration_seconds?: number | null;
  ai_voice?: boolean;
  transcript?: { speaker: string; text: string; timestamp?: number }[];
  conversation_outcome?: Record<string, any> | null;
  negotiation?: {
    limits_source?: string | null;
    final_decision?: string | null;
    rounds: { vendor_price: number; counter_offer?: number | null; decision: string; includes?: string | null }[];
  } | null;
  // Final result of a finished call (never left "pending" after hang-up).
  verdict?: CallVerdict | null;
  can_call_again?: boolean;
  history?: {
    status: string;
    completed_at?: string | null;
    duration_seconds?: number | null;
    verdict?: CallVerdict | null;
    transcript?: { speaker: string; text: string }[];
  }[];
  // WhatsApp: what the vendor wrote back and what it means.
  replies?: { id: string; text: string; t?: number | null }[];
  reply_analysis?: VendorReplyAnalysis | null;
  followups?: { text: string; message_id: string; t?: number | null; sent_by?: string }[];
  can_follow_up?: boolean;
}

export interface WhatsAppFollowupDraft {
  text: string;
  goal: string;
  method: "AI" | "TEMPLATE";
}

export interface CallVerdict {
  code: string;
  label: string;
  detail: string;
}

export interface VendorReplyAnalysis {
  decision: "YES" | "NO" | "MAYBE" | "QUESTION" | "UNCLEAR";
  available?: boolean | null;
  quoted_price?: number | null;
  summary?: string;
  language?: string | null;
  method?: "AI" | "KEYWORDS";
  price_check?: string;
  suggested_counter?: number;
  next_step?: string;
}

export interface CandidateCommunicationSummary {
  contact_name: string | null;
  destination_masked: string | null;
  whatsapp: ChannelCommunicationState;
  call: ChannelCommunicationState;
  overall_status: string;
}

export async function getCandidateCommunication(
  eventId: string,
  candidateId: string,
  refresh = false
): Promise<CandidateCommunicationSummary> {
  return apiRequest<CandidateCommunicationSummary>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/communication`,
    { params: { refresh } }
  );
}

export async function retryShortlistCommunication(
  eventId: string,
  candidateId: string,
  channel: CommunicationChannel
): Promise<ShortlistEntry> {
  return apiRequest<ShortlistEntry>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/communication/${channel}/retry`,
    {
      method: "POST",
    }
  );
}

/** Drafts the next WhatsApp message for review. Nothing is sent. */
export async function draftWhatsAppFollowup(eventId: string, candidateId: string): Promise<WhatsAppFollowupDraft> {
  return apiRequest<WhatsAppFollowupDraft>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/communication/whatsapp/draft`
  );
}

/** Sends the organizer-reviewed text to the vendor on WhatsApp. */
export async function sendWhatsAppFollowup(
  eventId: string,
  candidateId: string,
  text: string
): Promise<CandidateCommunicationSummary> {
  return apiRequest<CandidateCommunicationSummary>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/communication/whatsapp/send`,
    { method: "POST", body: JSON.stringify({ text }) }
  );
}

export async function dismissShortlistCommunication(
  eventId: string,
  candidateId: string
): Promise<ShortlistEntry> {
  return apiRequest<ShortlistEntry>(
    `/events/${eventId}/shortlist/${encodeURIComponent(candidateId)}/dismiss-communication`,
    {
      method: "POST",
    }
  );
}

