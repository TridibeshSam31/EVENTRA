import { apiClient } from "./client";
import type {
  PaginatedVendorsResponse,
  VendorResponse,
  VendorAssignmentResponse,
  VendorAssignmentCreate,
  ProviderAvailabilityResult,
  CategoryValidationResult,
} from "../../types/api";

export interface VendorSearchParams {
  [key: string]: string | number | boolean | null | undefined;
  category?: string;
  city?: string;
  max_base_cost?: number;
  limit?: number;
  offset?: number;
}

export async function searchVendors(
  params: VendorSearchParams = {}
): Promise<PaginatedVendorsResponse> {
  return apiClient.get<PaginatedVendorsResponse>("/vendors", { params });
}

export async function getVendor(vendorId: string): Promise<VendorResponse> {
  return apiClient.get<VendorResponse>(`/vendors/${vendorId}`);
}

export async function getAssignmentsForEvent(
  eventId: string
): Promise<VendorAssignmentResponse[]> {
  return apiClient.get<VendorAssignmentResponse[]>(
    `/vendors/assignments/event/${eventId}`
  );
}

export const getEventAssignments = getAssignmentsForEvent;

export async function createAssignment(
  payload: VendorAssignmentCreate
): Promise<VendorAssignmentResponse> {
  return apiClient.post<VendorAssignmentResponse>(
    "/vendors/assignments",
    payload
  );
}

export async function checkProviderAvailability(
  vendorId: string,
  startDatetime: string,
  endDatetime: string
): Promise<ProviderAvailabilityResult> {
  return apiClient.get<ProviderAvailabilityResult>(
    `/vendors/${vendorId}/availability`,
    {
      params: {
        start_datetime: startDatetime,
        end_datetime: endDatetime,
      },
    }
  );
}

export async function validateCategoryForDomain(
  domain: string,
  category: string
): Promise<CategoryValidationResult> {
  return apiClient.get<CategoryValidationResult>("/vendors/categories/validate", {
    params: { domain, category },
  });
}

export interface ProviderDiscoveryParams {
  category?: string;
  location?: string;
  query?: string;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  anchor_mode?: "NEAR_EVENT" | "NEAR_ME" | "REGION";
  limit?: number;
}

export interface ProviderDiscoveryResponse {
  event_id?: string;
  total_discovered: number;
  total_created: number;
  total_updated: number;
  source: string;
  query_used: string[];
  anchor_coordinates?: [number, number] | null;
  anchor_label?: string | null;
  anchor_mode?: "NEAR_EVENT" | "NEAR_ME" | "REGION" | string | null;
  items: VendorResponse[];
}

export async function discoverProviders(
  payload: ProviderDiscoveryParams = {}
): Promise<ProviderDiscoveryResponse> {
  return apiClient.post<ProviderDiscoveryResponse>("/vendors/discover", payload);
}

export async function discoverProvidersForEvent(
  eventId: string,
  payload: ProviderDiscoveryParams = {}
): Promise<ProviderDiscoveryResponse> {
  return apiClient.post<ProviderDiscoveryResponse>(`/events/${eventId}/providers/discover`, payload);
}

export interface VendorOutcomePayload {
  provider_id: string;
  task_id?: string | null;
  communication_channel?: string;
  outcome_status?: string;
  quoted_price?: number | null;
  currency?: string;
  reported_availability?: string;
  organizer_notes?: string | null;
  vendor_response?: Record<string, any> | null;
}

export interface VendorOutcomeItem {
  id: string;
  event_id: string;
  task_id?: string | null;
  provider_id: string;
  provider_name?: string | null;
  task_name?: string | null;
  communication_channel: string;
  outcome_status: string;
  quoted_price?: number | null;
  currency: string;
  reported_availability: string;
  organizer_notes?: string | null;
  vendor_response?: Record<string, any> | null;
  source: string;
  verification_status: string;
  submitted_by?: string | null;
  created_at: string;
  updated_at: string;
}

export async function recordVendorOutcome(
  eventId: string,
  payload: VendorOutcomePayload
): Promise<VendorOutcomeItem> {
  return apiClient.post<VendorOutcomeItem>(`/events/${eventId}/vendor-outcomes`, payload);
}

export async function getVendorOutcomes(
  eventId: string,
  params?: { provider_id?: string; task_id?: string }
): Promise<VendorOutcomeItem[]> {
  return apiClient.get<VendorOutcomeItem[]>(`/events/${eventId}/vendor-outcomes`, { params });
}



