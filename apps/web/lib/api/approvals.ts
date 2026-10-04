import { apiClient } from "./client";
import type {
  ApprovalRequestListResponse,
  ApprovalRequestResponse,
} from "../../types/api";

export async function listApprovals(
  eventId: string,
  params: { status?: string; requester_id?: string; limit?: number; offset?: number } = {}
): Promise<ApprovalRequestListResponse> {
  return apiClient.get<ApprovalRequestListResponse>(
    `/events/${eventId}/approvals`,
    { params }
  );
}

export async function getApproval(
  eventId: string,
  approvalId: string,
  token?: string
): Promise<ApprovalRequestResponse> {
  return apiClient.get<ApprovalRequestResponse>(
    `/events/${eventId}/approvals/${approvalId}`,
    { params: token ? { token } : undefined }
  );
}

export async function approveRequest(
  eventId: string,
  approvalId: string,
  decisionNotes?: string
): Promise<ApprovalRequestResponse> {
  return apiClient.post<ApprovalRequestResponse>(
    `/events/${eventId}/approvals/${approvalId}/approve`,
    { decision_notes: decisionNotes }
  );
}

export async function rejectRequest(
  eventId: string,
  approvalId: string,
  reason: string
): Promise<ApprovalRequestResponse> {
  return apiClient.post<ApprovalRequestResponse>(
    `/events/${eventId}/approvals/${approvalId}/reject`,
    { reason }
  );
}

export async function cancelRequest(
  eventId: string,
  approvalId: string,
  reason: string = "Cancelled by requester"
): Promise<ApprovalRequestResponse> {
  return apiClient.post<ApprovalRequestResponse>(
    `/events/${eventId}/approvals/${approvalId}/cancel`,
    { reason }
  );
}
