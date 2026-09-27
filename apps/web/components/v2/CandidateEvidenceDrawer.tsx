"use client";

import React from "react";
import {
  X,
  MapPin,
  Phone,
  Mail,
  Globe,
  Star,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building2,
  Users,
  DollarSign,
  Info,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface CandidateEvidenceData {
  id: string;
  name: string;
  entity_type: "VENUE" | "VENDOR";
  category: string;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  review_count?: number | null;
  distance_km?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  maps_url?: string | null;
  source?: string | null;
  provenance: string;
  // Specific & Qualification details
  capacity?: number | null;
  hourly_rate?: number | null;
  amenities?: string[];
  capabilities?: string[];
  score?: number | null;
  score_breakdown?: Record<string, number | string>;
  qualification_status?: string;
  matching_reasons?: string[];
  is_shortlisted?: boolean;
  is_assigned?: boolean;
  raw?: any;
}

interface CandidateEvidenceDrawerProps {
  candidate: CandidateEvidenceData | null;
  onClose: () => void;
  onToggleShortlist?: (candidate: CandidateEvidenceData) => void;
  onSelectPrimary?: (candidate: CandidateEvidenceData) => void;
  isShortlisted?: boolean;
  isSelecting?: boolean;
}

export function CandidateEvidenceDrawer({
  candidate,
  onClose,
  onToggleShortlist,
  onSelectPrimary,
  isShortlisted = false,
  isSelecting = false,
}: CandidateEvidenceDrawerProps) {
  if (!candidate) return null;

  const phoneDisplay = candidate.phone || "UNKNOWN";
  const emailDisplay = candidate.email || "UNKNOWN";
  const websiteDisplay = candidate.website || null;
  const ratingDisplay =
    candidate.rating != null ? `${candidate.rating.toFixed(1)} / 5.0` : "UNKNOWN";
  const reviewsDisplay =
    candidate.review_count != null ? `${candidate.review_count} reviews` : "UNKNOWN";
  const capacityDisplay =
    candidate.capacity != null ? `${candidate.capacity} attendees` : "UNKNOWN";
  const priceDisplay =
    candidate.hourly_rate != null ? `₹${candidate.hourly_rate.toLocaleString()}/hr` : "UNKNOWN";
  const distanceDisplay =
    candidate.distance_km != null ? `${candidate.distance_km.toFixed(1)} km from event` : "UNKNOWN";
  const scoreDisplay =
    candidate.score != null ? `${Math.round(candidate.score)} / 100` : "CALCULATING";

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-2xl h-full flex flex-col z-50 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50/60">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {candidate.category}
              </span>
              <ProvenanceBadge source={candidate.provenance} size="sm" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight truncate">
              {candidate.name}
            </h3>
            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
              <span className="truncate">{candidate.address || candidate.city || "Location unknown"}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-slate-700 divide-y divide-slate-100">
          {/* Section: Match & Suitability Score */}
          <div className="pt-1">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Qualification & Match Score
            </h4>
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">{scoreDisplay}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {candidate.qualification_status || "Constraint Satisfied"}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Qualified Fit
                </span>
              </div>
            </div>

            {/* Score Breakdown if provided */}
            {candidate.score_breakdown && Object.keys(candidate.score_breakdown).length > 0 && (
              <div className="mt-2.5 p-3 rounded-lg bg-white border border-slate-200 space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Component Scoring Breakdown
                </span>
                {Object.entries(candidate.score_breakdown).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="font-semibold text-slate-900">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: Identity & Location */}
          <div className="pt-4">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Identity & Coordinates
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Provider ID</div>
                <div className="font-mono font-medium text-slate-800 text-[11px] truncate">
                  {candidate.id}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Distance</div>
                <div className="font-medium text-slate-800 text-[11px]">{distanceDisplay}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 col-span-2">
                <div className="text-[10px] text-slate-400 uppercase">Geographic Coordinates</div>
                <div className="font-mono text-slate-700 text-[11px]">
                  {candidate.latitude != null && candidate.longitude != null ? (
                    `${candidate.latitude.toFixed(5)}, ${candidate.longitude.toFixed(5)}`
                  ) : (
                    <span className="text-amber-600 font-semibold">UNKNOWN (Coordinates missing)</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Verified Contact Information */}
          <div className="pt-4">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Contact & Web Evidence
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> Phone
                </span>
                <span className={`font-mono text-xs ${candidate.phone ? "text-slate-900 font-medium" : "text-slate-400 italic"}`}>
                  {phoneDisplay}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="flex items-center gap-2 text-slate-600">
                  <Mail className="w-3.5 h-3.5 text-slate-400" /> Email
                </span>
                <span className={`font-mono text-xs ${candidate.email ? "text-slate-900 font-medium" : "text-slate-400 italic"}`}>
                  {emailDisplay}
                </span>
              </div>

              {websiteDisplay && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="flex items-center gap-2 text-slate-600">
                    <Globe className="w-3.5 h-3.5 text-slate-400" /> Website
                  </span>
                  <a
                    href={websiteDisplay}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1 font-medium truncate max-w-[200px]"
                  >
                    <span>Visit site</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {candidate.maps_url && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="flex items-center gap-2 text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" /> Maps Link
                  </span>
                  <a
                    href={candidate.maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>View on Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Section: Operational Specifications & Capacity */}
          <div className="pt-4">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Operational Specs & Capacity
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Capacity</div>
                <div className={`font-semibold text-xs mt-0.5 ${candidate.capacity ? "text-slate-900" : "text-slate-400 italic"}`}>
                  {capacityDisplay}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Rate / Cost Tier</div>
                <div className={`font-semibold text-xs mt-0.5 ${candidate.hourly_rate ? "text-slate-900" : "text-slate-400 italic"}`}>
                  {priceDisplay}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Public Rating</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  <span className="font-semibold text-slate-900 text-xs">{ratingDisplay}</span>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase">Review Volume</div>
                <div className="font-semibold text-slate-900 text-xs mt-0.5">{reviewsDisplay}</div>
              </div>
            </div>

            {/* Amenities / Capabilities */}
            {((candidate.amenities && candidate.amenities.length > 0) ||
              (candidate.capabilities && candidate.capabilities.length > 0)) && (
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                  Verified Amenities & Capabilities
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[...(candidate.amenities || []), ...(candidate.capabilities || [])].map((am, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200"
                    >
                      ✓ {am}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          {onToggleShortlist && (
            <button
              onClick={() => onToggleShortlist(candidate)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                isShortlisted
                  ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
            >
              {isShortlisted ? "✓ Shortlisted" : "+ Add to Shortlist"}
            </button>
          )}

          {onSelectPrimary && (
            <button
              onClick={() => onSelectPrimary(candidate)}
              disabled={isSelecting || candidate.is_assigned}
              className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white shadow-sm transition disabled:opacity-50"
            >
              {candidate.is_assigned
                ? "Assigned to Event"
                : isSelecting
                ? "Locking Selection..."
                : candidate.entity_type === "VENUE"
                ? "Select as Venue"
                : "Request Provider (Pending Approval)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
