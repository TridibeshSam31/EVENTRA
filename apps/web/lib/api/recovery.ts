import { apiClient } from "./client";
import type {
  RecoveryOptionListResponse,
  RecoveryOptionResponse,
} from "../../types/api";

export async function generateRecoveryOptions(
  eventId: string,
  incidentId: string
): Promise<RecoveryOptionListResponse> {
  return apiClient.post<RecoveryOptionListResponse>(
    `/events/${eventId}/incidents/${incidentId}/recovery/options`
  );
}

export async function listRecoveryOptions(
  eventId: string,
  incidentId: string
): Promise<RecoveryOptionListResponse> {
  return apiClient.get<RecoveryOptionListResponse>(
    `/events/${eventId}/incidents/${incidentId}/recovery/options`
  );
}

export async function recalculateRecoveryOptions(
  eventId: string,
  incidentId: string
): Promise<RecoveryOptionListResponse> {
  return apiClient.post<RecoveryOptionListResponse>(
    `/events/${eventId}/incidents/${incidentId}/recovery/recalculate`
  );
}

export async function getRecoveryOption(
  eventId: string,
  incidentId: string,
  optionId: string
): Promise<RecoveryOptionResponse> {
  return apiClient.get<RecoveryOptionResponse>(
    `/events/${eventId}/incidents/${incidentId}/recovery/options/${optionId}`
  );
}

export async function getRecoveryDecisionTrace(
  eventId: string,
  incidentId: string
): Promise<any> {
  return apiClient.get<any>(
    `/events/${eventId}/incidents/${incidentId}/recovery/trace`
  );
}
