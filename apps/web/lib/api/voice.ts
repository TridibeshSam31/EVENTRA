import { apiClient } from "./client";

export interface InitiateVoiceCallRequest {
  recipient_phone: string;
  vendor_name?: string;
  event_id?: string;
  task_id?: string;
  provider_id?: string;
}

export interface VoiceCallResponse {
  success: boolean;
  source: string;
  data?: any;
  error?: string | null;
}

export async function initiateVoiceCall(
  payload: InitiateVoiceCallRequest
): Promise<VoiceCallResponse> {
  return apiClient.post<VoiceCallResponse>("/voice/call", payload);
}
