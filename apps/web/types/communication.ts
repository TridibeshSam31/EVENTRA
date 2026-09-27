export interface ExtractedFacts {
  available?: boolean | null;
  quoted_amount?: number | null;
  currency?: string;
  notes?: string | null;
  confidence?: number;
  field_sources?: Record<string, string>;
}

export interface Message {
  id: string;
  conversation_id: string;
  event_id: string;
  vendor_id?: string | null;
  direction: "inbound" | "outbound";
  channel: "whatsapp" | "call" | "email";
  sender?: string | null;
  recipient?: string | null;
  raw_text: string;
  status: string;
  extracted_facts: ExtractedFacts;
  timestamp: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  event_id: string;
  vendor_id?: string | null;
  vendor_name?: string | null;
  channel: string;
  status: string;
  recipient_contact?: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  latest_message?: Message | null;
}

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
}
