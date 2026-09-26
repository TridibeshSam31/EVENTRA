import { apiClient } from "./client";
import type {
  PaginatedVenuesResponse,
  VenueResponse,
  VenueAvailabilityResult,
  VenueSuitabilityCheck,
  VenueSuitabilityResult,
} from "../../types/api";

export interface VenueSearchParams {
  [key: string]: string | number | boolean | null | undefined;
  city?: string;
  min_capacity?: number;
  max_capacity?: number;
  venue_type?: string;
  max_hourly_rate?: number;
  limit?: number;
  offset?: number;
}

export async function searchVenues(
  params: VenueSearchParams = {}
): Promise<PaginatedVenuesResponse> {
  return apiClient.get<PaginatedVenuesResponse>("/venues", { params });
}

export async function getVenue(venueId: string): Promise<VenueResponse> {
  return apiClient.get<VenueResponse>(`/venues/${venueId}`);
}

export async function checkVenueAvailability(
  venueId: string,
  startDatetime: string,
  endDatetime: string
): Promise<VenueAvailabilityResult> {
  return apiClient.get<VenueAvailabilityResult>(`/venues/${venueId}/availability`, {
    params: {
      start_datetime: startDatetime,
      end_datetime: endDatetime,
    },
  });
}

export async function checkVenueSuitability(
  venueId: string,
  payload: VenueSuitabilityCheck
): Promise<VenueSuitabilityResult> {
  return apiClient.post<VenueSuitabilityResult>(
    `/venues/${venueId}/suitability`,
    payload
  );
}

export interface VenueDiscoveryParams {
  city?: string;
  query?: string;
  latitude?: number;
  longitude?: number;
  limit?: number;
  save_to_db?: boolean;
}

export async function discoverVenues(
  payload: VenueDiscoveryParams = {}
): Promise<{ total_discovered: number; total_created: number; city: string; source: string; items: VenueResponse[] }> {
  return apiClient.post("/venues/discover", payload);
}

export async function discoverVenuesForEvent(
  eventId: string,
  payload: VenueDiscoveryParams = {}
): Promise<{ total_discovered: number; total_created: number; city: string; source: string; items: VenueResponse[] }> {
  return apiClient.post(`/events/${eventId}/venues/discover`, payload);
}

export interface VenueRecommendationParams {
  city: string;
  guest_count?: number;
  event_type?: string;
  budget?: number;
  required_amenities?: string[];
  description?: string;
  event_id?: string;
}

export interface RankedVenue {
  id: string;
  name: string;
  address?: string;
  city: string;
  capacity: number;
  venue_type: string;
  hourly_rate?: number;
  amenities: string[];
  suitability_score: number;
  is_best_match: boolean;
  badge: string;
  match_reasons: string[];
  pros: string[];
  cons: string[];
  capacity_status: string;
}

export interface VenueRecommendationResult {
  city: string;
  total_scouted: number;
  agent_summary: string;
  best_venue?: RankedVenue;
  ranked_venues: RankedVenue[];
}

export async function recommendVenues(
  payload: VenueRecommendationParams
): Promise<VenueRecommendationResult> {
  return apiClient.post("/venues/recommend", payload);
}

export async function selectEventVenue(
  eventId: string,
  venueId: string
): Promise<{ success: boolean; message: string; venue: any }> {
  return apiClient.post("/venues/select", {
    event_id: eventId,
    venue_id: venueId,
  });
}


