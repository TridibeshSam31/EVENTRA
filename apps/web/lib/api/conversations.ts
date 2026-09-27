import { apiRequest } from "./client";
import type { ConversationListResponse, Conversation, Message } from "@/types/communication";

export async function getConversations(eventId: string): Promise<ConversationListResponse> {
  return apiRequest<ConversationListResponse>(`/events/${eventId}/conversations`);
}

export async function getMessages(
  eventId: string,
  conversationId: string
): Promise<{ items: Message[]; total: number }> {
  return apiRequest<{ items: Message[]; total: number }>(
    `/events/${eventId}/conversations/${conversationId}/messages`
  );
}

export async function sendMessage(
  eventId: string,
  conversationId: string,
  payload: { raw_text: string; channel?: string; direction?: string }
): Promise<Message> {
  return apiRequest<Message>(
    `/events/${eventId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
