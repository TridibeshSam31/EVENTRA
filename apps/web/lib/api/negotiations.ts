import { apiRequest } from "./client";

export interface NegotiationMessage {
  id: string;
  sender_type: "AGENT" | "VENDOR" | "ORGANIZER" | "SYSTEM";
  text: string;
  amount_extracted?: number | null;
  timestamp: number;
  channel: string; // whatsapp | voice | system
}

export interface LiveNegotiationTimeline {
  assignment_id: string;
  event_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_type: string;
  status: string;
  round_number: number;
  control: "AGENT" | "HUMAN";
  cap?: number | null; // max_approved_amount
  target?: number | null; // target_amount
  latest_vendor_quote?: number | null;
  latest_agent_counter?: number | null;
  budget_validation?: {
    valid: boolean;
    allocated_limit: number;
    proposed_cost: number;
    remaining_after: number;
    overage: number;
    threshold_pct: number;
  } | null;
  approval_id?: string | null;
  conversation_id?: string | null;
  messages: NegotiationMessage[];
}

export interface NegotiationSummary {
  assignment_id: string;
  event_id: string;
  vendor_id: string;
  vendor_name: string;
  category: string;
  status: string;
  control: "AGENT" | "HUMAN";
  round_number: number;
  target_amount?: number | null;
  max_approved_amount?: number | null;
  quoted_amount?: number | null;
  currency: string;
  approval_id?: string | null;
  updated_at?: string | null;
}

export interface NegotiationActionResponse {
  assignment_id: string;
  negotiation_control: string;
  control_changed_by?: string | null;
  control_changed_at?: string | null;
  status: string;
  message: string;
}

export async function getLiveNegotiation(
  eventId: string,
  assignmentId: string
): Promise<LiveNegotiationTimeline> {
  return apiRequest<LiveNegotiationTimeline>(
    `/events/${eventId}/negotiations/${assignmentId}/live`
  );
}

export async function listNegotiations(
  eventId: string
): Promise<NegotiationSummary[]> {
  return apiRequest<NegotiationSummary[]>(`/events/${eventId}/negotiations`);
}

export async function takeOverNegotiation(
  eventId: string,
  assignmentId: string
): Promise<NegotiationActionResponse> {
  return apiRequest<NegotiationActionResponse>(
    `/events/${eventId}/negotiations/${assignmentId}/take-over`,
    { method: "POST" }
  );
}

export async function resumeNegotiation(
  eventId: string,
  assignmentId: string
): Promise<NegotiationActionResponse> {
  return apiRequest<NegotiationActionResponse>(
    `/events/${eventId}/negotiations/${assignmentId}/resume`,
    { method: "POST" }
  );
}

export async function cancelNegotiation(
  eventId: string,
  assignmentId: string,
  reason?: string
): Promise<NegotiationActionResponse> {
  return apiRequest<NegotiationActionResponse>(
    `/events/${eventId}/negotiations/${assignmentId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
}

export async function sendOrganizerMessage(
  eventId: string,
  assignmentId: string,
  text: string,
  channel: string = "whatsapp"
): Promise<NegotiationMessage> {
  return apiRequest<NegotiationMessage>(
    `/events/${eventId}/negotiations/${assignmentId}/message`,
    {
      method: "POST",
      body: JSON.stringify({ text, channel }),
    }
  );
}

export async function runDemoSimulation(
  eventId: string,
  assignmentId: string
): Promise<any> {
  return apiRequest<any>(
    `/events/${eventId}/negotiations/${assignmentId}/demo-simulation`,
    { method: "POST" }
  );
}
