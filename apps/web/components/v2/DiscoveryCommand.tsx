"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Search,
  Filter,
  MapPin,
  Phone,
  Mail,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  RefreshCw,
  Zap,
  ArrowRight,
  Database,
  Building2,
  Users,
  Star,
  ExternalLink,
  ChevronDown,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import {
  getDiscoveryRuns,
  getDiscoveryRun,
  getDiscoveryRunEvents,
  startOperations,
} from "@/lib/api/discoveryRuns";
import {
  discoverProviders,
  getAssignmentsForEvent,
  createAssignment,
  runAgenticDiscovery,
  CandidateCardResponse,
} from "@/lib/api/vendors";
import { recommendVenues, selectEventVenue } from "@/lib/api/venues";
import type { DiscoveryRun, DiscoveryRunEvent } from "@/types/discoveryRun";
import type { DiscoveryMapEntity, EventResponse } from "@/types/api";

import { DiscoveryFunnel } from "./DiscoveryFunnel";
import { DiscoveryIterationStepper } from "./DiscoveryIterationStepper";
import {
  CandidateEvidenceDrawer,
  CandidateEvidenceData,
} from "./CandidateEvidenceDrawer";
import { ProvenanceBadge } from "./ProvenanceBadge";

// Dynamic import for Leaflet map to prevent SSR window reference error
const DiscoveryMap = dynamic(
  () => import("@/components/maps/DiscoveryMap"),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> }
);

function MapLoadingPlaceholder() {
  return (
    <div className="w-full h-full min-h-[350px] bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="text-xs">Initializing geospatial radar...</span>
      </div>
    </div>
  );
}

interface DiscoveryCommandProps {
  eventId: string;
  discoveryType: "VENUE" | "VENDOR";
  defaultCategory?: string;
  className?: string;
}

const VENDOR_CATEGORIES = [
  "CATERING",
  "AV_TECH",
  "PHOTOGRAPHY",
  "SECURITY",
  "TRANSPORT",
  "DECOR",
];

export function DiscoveryCommand({
  eventId,
  discoveryType,
  defaultCategory,
  className = "",
}: DiscoveryCommandProps) {
  // Event & run state
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<DiscoveryRun | null>(null);
  const [runEvents, setRunEvents] = useState<DiscoveryRunEvent[]>([]);
  const [showIterations, setShowIterations] = useState(false);

  // Search & filter state
  const [category, setCategory] = useState<string>(
    defaultCategory || (discoveryType === "VENUE" ? "VENUE" : "CATERING")
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [funnelStageFilter, setFunnelStageFilter] = useState<
    "DISCOVERED" | "UNIQUE" | "RELEVANT" | "MATCHING" | "SHORTLISTED" | null
  >(null);

  // Candidate items & drawer
  const [candidates, setCandidates] = useState<CandidateEvidenceData[]>([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<CandidateEvidenceData | null>(null);
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [overrideCandidateConfirm, setOverrideCandidateConfirm] =
    useState<CandidateEvidenceData | null>(null);

  // Operations execution state
  const [loading, setLoading] = useState(true);
  const [scouting, setScouting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // 1. Fetch Event and Discovery Runs
  const loadRunsAndEvent = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [evRes, runsRes] = await Promise.allSettled([
        getEvent(eventId),
        getDiscoveryRuns(eventId, discoveryType === "VENUE" ? "VENUE" : category),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }

      if (runsRes.status === "fulfilled" && runsRes.value.items) {
        setRuns(runsRes.value.items);
        if (runsRes.value.items.length > 0) {
          const running = runsRes.value.items.find((r) => r.status === "RUNNING");
          const targetRun = running || runsRes.value.items[0];
          setSelectedRun(targetRun);
          loadRunEvents(targetRun.run_id);
        } else {
          setSelectedRun(null);
          setRunEvents([]);
        }
      }
    } catch (err) {
      console.error("Failed to load discovery runs:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, discoveryType, category]);

  // 2. Fetch specific run events
  const loadRunEvents = useCallback(async (runId: string) => {
    try {
      const events = await getDiscoveryRunEvents(eventId, runId);
      setRunEvents(events);
      return events;
    } catch (err) {
      console.error("Failed to load run events:", err);
      return [];
    }
  }, [eventId]);

  // 3. Load candidates for current category / type
  const loadCandidates = useCallback(async () => {
    if (!eventId) return;
    try {
      setScouting(true);
      if (discoveryType === "VENUE") {
        const city = eventData?.location?.split(",")[0]?.trim() || "Delhi";
        const guests = eventData?.guest_count || 100;
        const res = await recommendVenues({
          city,
          guest_count: guests,
          event_type: eventData?.event_type || "CONFERENCE",
          event_id: eventId,
        });

        if (res && res.ranked_venues) {
          const mapped: CandidateEvidenceData[] = res.ranked_venues.map(
            (v, idx) => {
              const isVenueRejected =
                v.qualification === "rejected" ||
                v.capacity_status === "EXCEEDED" ||
                (v.suitability_score != null && v.suitability_score < 60);
              const qualStatus = isVenueRejected ? "rejected" : (v.qualification || "qualified");
              const qualReason =
                v.qualification_reason ||
                (isVenueRejected && v.cons && v.cons.length > 0 ? v.cons.join("; ") : null);
              const tier = isVenueRejected
                ? "rejected"
                : (v.tier || (v.suitability_score >= 80 ? "top_matches" : "other_available_options"));

              return {
                id: v.id || `venue-${idx}`,
                name: v.name || "Discovered Venue",
                entity_type: "VENUE",
                category: "VENUE",
                address: v.address || `${city}, India`,
                city: v.city || city,
                latitude: (v as any).latitude ?? 28.6139,
                longitude: (v as any).longitude ?? 77.209,
                rating: (v as any).rating ?? null,
                review_count: (v as any).review_count ?? null,
                capacity: v.capacity,
                hourly_rate: v.hourly_rate,
                score: v.suitability_score,
                score_breakdown: {},
                qualification_status: qualStatus,
                qualification_reason: qualReason,
                tier: tier,
                matching_reasons: v.match_reasons || v.pros || [],
                provenance: (v as any).source || "LIVE_SCRAPE",
                amenities: v.amenities || v.pros || [],
                raw: v,
              };
            }
          );
          setCandidates(mapped);

          // Auto-populate agent shortlist from top matches (Requirement 2)
          const topIds = mapped
            .filter((c) => c.tier === "top_matches" && c.qualification_status !== "rejected")
            .map((c) => c.id);
          if (topIds.length > 0) {
            setShortlistedIds((prev) => {
              const next = new Set(prev);
              topIds.forEach((id) => next.add(id));
              return next;
            });
          }
        }
      } else {
        const loc = eventData?.location || "Delhi";
        let mapped: CandidateEvidenceData[] = [];

        // 1. Try agentic discovery first to retrieve structured tiers & qualification
        try {
          const agenticRes = await runAgenticDiscovery(eventId, {
            category,
            location: loc,
            event_type: eventData?.event_type || "GENERIC",
            guest_count: eventData?.guest_count,
            max_budget: eventData?.total_budget ? Number(eventData.total_budget) : undefined,
            base_radius_km: selectedRun?.radius_km || 15,
            simulate_outreach: true,
          });

          if (agenticRes && (
            (agenticRes.top_matches && agenticRes.top_matches.length > 0) ||
            (agenticRes.other_available_options && agenticRes.other_available_options.length > 0) ||
            (agenticRes.rejected_candidates && agenticRes.rejected_candidates.length > 0)
          )) {
            const mapCard = (item: CandidateCardResponse, defaultTier: string): CandidateEvidenceData => ({
              id: item.id,
              name: item.name,
              entity_type: "VENDOR",
              category: item.category || category,
              address: item.address,
              city: item.city,
              latitude: item.latitude,
              longitude: item.longitude,
              rating: item.rating,
              review_count: item.review_count,
              distance_km: item.distance_km,
              phone: item.phone,
              email: item.email,
              website: item.website,
              maps_url: item.maps_url,
              provenance: "LIVE_SCRAPE",
              score: item.score != null ? (item.score <= 1.0 ? Math.round(item.score * 100) : Math.round(item.score)) : 85,
              qualification_status: item.qualification,
              qualification_reason:
                item.qualification_reason ||
                (item.qualification === "rejected"
                  ? (item.reasons?.[0] || "Institution/PSU — excluded by default")
                  : null),
              tier: item.qualification === "rejected" ? "rejected" : defaultTier,
              matching_reasons: item.reasons || [],
              is_assigned: false,
              raw: item,
            });

            const topCards = (agenticRes.top_matches || []).map((c) => mapCard(c, "top_matches"));
            const otherCards = (agenticRes.other_available_options || []).map((c) => mapCard(c, "other_available_options"));
            const waitlistCards = (agenticRes.backup_waitlist || []).map((c) => mapCard(c, "backup_waitlist"));
            const rejectedCards = (agenticRes.rejected_candidates || []).map((c) => mapCard(c, "rejected"));

            mapped = [...topCards, ...otherCards, ...waitlistCards, ...rejectedCards];
          }
        } catch (agenticErr) {
          console.warn("Direct agentic discovery endpoint fell back to discoverProviders:", agenticErr);
        }

        // 2. Fallback to discoverProviders if agentic discovery returned empty
        if (mapped.length === 0) {
          const res = await discoverProviders({
            category,
            location: loc,
            radius_km: selectedRun?.radius_km || 15,
          });

          if (res && res.items) {
            const nonRejected = res.items.filter((item) => item.qualification !== "rejected");
            mapped = res.items.map((item) => {
              const isItemRejected = item.qualification === "rejected";
              const isTop = !isItemRejected && nonRejected.slice(0, 3).some((top) => top.id === item.id);
              const tier = isItemRejected ? "rejected" : isTop ? "top_matches" : "other_available_options";

              return {
                id: item.id,
                name: item.name,
                entity_type: "VENDOR",
                category: item.category || category,
                address: item.address,
                city: item.city,
                latitude: item.latitude,
                longitude: item.longitude,
                rating: item.rating,
                review_count: item.review_count,
                distance_km: item.distance_km,
                phone: item.phone,
                maps_url: item.maps_url,
                provenance: (item as any).source_tag || "LIVE_SCRAPE",
                score: item.score ?? ((item as any).qualification_score || 85),
                qualification_status: item.qualification || "qualified",
                qualification_reason:
                  item.qualification_reason ||
                  (isItemRejected ? (item.reasons?.[0] || "Institution/PSU — excluded by default") : null),
                tier: tier,
                matching_reasons: item.reasons || [],
                is_assigned: item.is_assigned,
                raw: item,
              };
            });
          }
        }

        setCandidates(mapped);

        // Auto-populate agent shortlist from top matches (Requirement 2)
        const topIds = mapped
          .filter((c) => c.tier === "top_matches" && c.qualification_status !== "rejected")
          .map((c) => c.id);
        if (topIds.length > 0) {
          setShortlistedIds((prev) => {
            const next = new Set(prev);
            topIds.forEach((id) => next.add(id));
            return next;
          });
        }
      }
    } catch (err: any) {
      console.error("Failed to load candidate entities:", err);
    } finally {
      setScouting(false);
    }
  }, [eventId, discoveryType, category, eventData, selectedRun]);

  useEffect(() => {
    loadRunsAndEvent();
  }, [loadRunsAndEvent]);

  useEffect(() => {
    if (eventData) {
      loadCandidates();
    }
  }, [eventData, loadCandidates]);

  // 4. Live Polling Effect while DiscoveryRun status is RUNNING
  useEffect(() => {
    if (!eventId || !selectedRun?.run_id) return;
    if (selectedRun.status !== "RUNNING") return;

    let isMounted = true;
    const currentRunId = selectedRun.run_id;

    const pollInterval = setInterval(async () => {
      try {
        const [updatedRun, events] = await Promise.all([
          getDiscoveryRun(eventId, currentRunId),
          getDiscoveryRunEvents(eventId, currentRunId),
        ]);

        if (!isMounted) return;

        setSelectedRun(updatedRun);
        setRunEvents(events);

        // Update run in runs list
        setRuns((prevRuns) =>
          prevRuns.map((r) => (r.run_id === updatedRun.run_id ? updatedRun : r))
        );

        const terminalStatuses = ["TARGET_REACHED", "EXHAUSTED", "FAILED", "COMPLETED"];
        if (terminalStatuses.includes(updatedRun.status)) {
          clearInterval(pollInterval);
          setScouting(false);
          setStatusMessage(
            `Discovery run finished: ${updatedRun.status} (${updatedRun.discovered} discovered, ${updatedRun.shortlisted || updatedRun.matching || 0} matching).`
          );
          // Refresh candidates list now that background discovery has finished
          loadCandidates();
        }
      } catch (err) {
        console.error("Error polling discovery run:", err);
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [eventId, selectedRun?.run_id, selectedRun?.status, loadCandidates]);

  // Trigger autonomous operations / new discovery run
  const handleTriggerDiscovery = async () => {
    try {
      setScouting(true);
      setShowIterations(true);
      setStatusMessage("Dispatching live autonomous discovery run...");
      const res = await startOperations(eventId);
      setStatusMessage(res.message || "Autonomous operations & discovery run dispatched.");

      if (res.run_id) {
        try {
          const newRun = await getDiscoveryRun(eventId, res.run_id);
          setSelectedRun(newRun);
          setRuns((prev) => [newRun, ...prev.filter((r) => r.run_id !== newRun.run_id)]);
          const events = await getDiscoveryRunEvents(eventId, res.run_id);
          setRunEvents(events);
        } catch {
          await loadRunsAndEvent();
        }
      } else {
        await loadRunsAndEvent();
      }
    } catch (err: any) {
      console.error("Discovery run dispatch failed:", err);
      setStatusMessage(err.message || "Failed to start discovery run.");
      setScouting(false);
    }
  };

  // Shortlist toggle (local UI state with transparent feedback & confirmation for rejected entities)
  const handleToggleShortlist = (candidate: CandidateEvidenceData) => {
    // If candidate is rejected and not currently shortlisted, require explicit confirmation (Requirement 4)
    if (candidate.qualification_status === "rejected" && !shortlistedIds.has(candidate.id)) {
      setOverrideCandidateConfirm(candidate);
      return;
    }

    setShortlistedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) {
        next.delete(candidate.id);
        setStatusMessage(`Removed '${candidate.name}' from shortlist.`);
      } else {
        next.add(candidate.id);
        setStatusMessage(`Added '${candidate.name}' to shortlist.`);
      }
      return next;
    });
  };

  const handleConfirmOverride = () => {
    if (!overrideCandidateConfirm) return;
    setShortlistedIds((prev) => {
      const next = new Set(prev);
      next.add(overrideCandidateConfirm.id);
      return next;
    });
    setStatusMessage(
      `Manual override applied: '${overrideCandidateConfirm.name}' forced into shortlist despite qualification rejection.`
    );
    setOverrideCandidateConfirm(null);
  };

  // Primary contract / lock selection
  const handleSelectPrimary = async (candidate: CandidateEvidenceData) => {
    try {
      setActionInProgress(candidate.id);
      if (candidate.entity_type === "VENUE") {
        await selectEventVenue(eventId, candidate.id);
        setStatusMessage(`Venue '${candidate.name}' selected for event.`);
      } else {
        await createAssignment({
          event_id: eventId,
          vendor_id: candidate.id,
          category: candidate.category,
        });
        setStatusMessage(`Provider '${candidate.name}' added to shortlist — pending approval.`);
      }
      await loadCandidates();
    } catch (err: any) {
      console.error("Failed to select entity:", err);
      setStatusMessage(err.message || "Selection action failed.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Filter candidates by search & funnel stage
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const matchesSearch =
        searchQuery === "" ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.address && c.address.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.category && c.category.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (funnelStageFilter === "SHORTLISTED") {
        return shortlistedIds.has(c.id);
      }
      if (funnelStageFilter === "MATCHING" || funnelStageFilter === "RELEVANT") {
        return c.qualification_status !== "rejected";
      }
      return true;
    });
  }, [candidates, searchQuery, funnelStageFilter, shortlistedIds]);

  // Partition candidates into structured tiers (Requirements 2 & 4)
  const { topMatches, otherOptions, backupWaitlist, rejectedOptions } = useMemo(() => {
    const top: CandidateEvidenceData[] = [];
    const other: CandidateEvidenceData[] = [];
    const backup: CandidateEvidenceData[] = [];
    const rejected: CandidateEvidenceData[] = [];

    for (const c of filteredCandidates) {
      if (c.qualification_status === "rejected" || c.tier === "rejected") {
        rejected.push(c);
      } else if (c.tier === "top_matches") {
        top.push(c);
      } else if (c.tier === "backup_waitlist") {
        backup.push(c);
      } else {
        other.push(c);
      }
    }

    return {
      topMatches: top,
      otherOptions: other,
      backupWaitlist: backup,
      rejectedOptions: rejected,
    };
  }, [filteredCandidates]);

  // Map entities: Only candidates with valid coordinates
  const mapPlaces: DiscoveryMapEntity[] = useMemo(() => {
    return candidates
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        entity_type: c.entity_type === "VENUE" ? ("VENUE" as const) : ("PROVIDER" as const),
        category: c.category,
        latitude: c.latitude as number,
        longitude: c.longitude as number,
        address: c.address || "",
        city: c.city || "Delhi",
        rating: c.rating,
        review_count: c.review_count,
        distance_km: c.distance_km,
        phone: c.phone,
        maps_url: c.maps_url,
        is_assigned: c.is_assigned,
        capacity: c.capacity,
      }));
  }, [candidates]);

  // Selected place for map
  const selectedMapPlace = useMemo(() => {
    if (!selectedCandidate || selectedCandidate.latitude == null) return null;
    return (
      mapPlaces.find((p) => p.id === selectedCandidate.id) || null
    );
  }, [selectedCandidate, mapPlaces]);

  // Helper to render candidate card by tier (Requirement 2 & 4)
  const renderCandidateCard = (
    candidate: CandidateEvidenceData,
    tierType: "top" | "other" | "backup" | "rejected"
  ) => {
    const isShort = shortlistedIds.has(candidate.id);
    const isSelected = selectedCandidate?.id === candidate.id;
    const isRejected = tierType === "rejected" || candidate.qualification_status === "rejected";
    const isTop = tierType === "top";

    return (
      <div
        key={candidate.id}
        className={`p-4 rounded-xl border transition shadow-xs hover:border-slate-300 ${
          isRejected
            ? "border-rose-200 bg-rose-50/25"
            : isTop
            ? "border-purple-200/90 bg-gradient-to-r from-purple-50/20 to-white"
            : "border-slate-200 bg-white"
        } ${
          isSelected
            ? "ring-2 ring-[#D6003C]/40 border-[#D6003C]"
            : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                {candidate.category}
              </span>
              <ProvenanceBadge source={candidate.provenance} size="sm" />
              {isTop && (
                <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-purple-600" />
                  Agent Pick
                </span>
              )}
              {isRejected && (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-rose-600" />
                  Disqualified by Engine
                </span>
              )}
              {candidate.score != null && !isRejected && (
                <span className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  {Math.round(candidate.score)} pts
                </span>
              )}
            </div>

            <h3 className={`text-sm font-bold tracking-tight truncate ${
              isRejected ? "text-slate-700 line-through decoration-rose-400" : "text-slate-900"
            }`}>
              {candidate.name}
            </h3>

            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
              <span className="truncate">{candidate.address || candidate.city || "Location unknown"}</span>
            </p>

            {/* Rejection / Disqualification Reason Box */}
            {isRejected && (
              <div className="mt-2.5 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-900">
                <div className="font-semibold flex items-center gap-1.5 text-rose-700 mb-0.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  Disqualification Reason:
                </div>
                <div className="text-rose-800">
                  {candidate.qualification_reason ||
                    candidate.matching_reasons?.[0] ||
                    "Institution/PSU — excluded by default"}
                </div>
              </div>
            )}
          </div>

          {/* Rating block */}
          <div className="text-right flex-shrink-0">
            {candidate.rating != null ? (
              <div className="flex items-center gap-1 text-xs font-semibold text-slate-800">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>{candidate.rating.toFixed(1)}</span>
                {candidate.review_count != null && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({candidate.review_count})
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-slate-400 italic">No public rating</span>
            )}

            {candidate.capacity != null && (
              <div className="text-[10px] font-medium text-slate-600 mt-1">
                {candidate.capacity} capacity
              </div>
            )}
          </div>
        </div>

        {/* Bottom action row */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedCandidate(candidate)}
              className="font-semibold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
            >
              View Evidence <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleToggleShortlist(candidate)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition ${
                isRejected
                  ? isShort
                    ? "bg-amber-700 text-white border-amber-800 shadow-xs hover:bg-amber-800"
                    : "bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100"
                  : isShort
                  ? isTop
                    ? "bg-purple-900 text-white border-purple-900 hover:bg-purple-800"
                    : "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                  : isTop
                  ? "bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {isRejected
                ? isShort
                  ? "⚠️ Overridden (Shortlisted)"
                  : "Force Shortlist (Override)"
                : isShort
                ? isTop
                  ? "✓ In Agent Shortlist"
                  : "✓ Shortlisted"
                : isTop
                ? "+ Add to Shortlist"
                : "+ Promote to Shortlist"}
            </button>

            <button
              onClick={() => handleSelectPrimary(candidate)}
              disabled={actionInProgress === candidate.id || candidate.is_assigned}
              className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white shadow-xs transition disabled:opacity-50"
            >
              {candidate.is_assigned
                ? "Assigned"
                : actionInProgress === candidate.id
                ? "Locking..."
                : discoveryType === "VENUE"
                ? "Select Venue"
                : "Contract"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Header & Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {discoveryType === "VENUE" ? "Venue Discovery" : "Vendor Sourcing"}
              </span>

              {selectedRun && (
                <span
                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border inline-flex items-center gap-1.5 ${
                    selectedRun.status === "COMPLETED" || selectedRun.status === "TARGET_REACHED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : selectedRun.status === "RUNNING"
                      ? "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
                      : selectedRun.status === "EXHAUSTED"
                      ? "bg-amber-50 text-amber-800 border-amber-300"
                      : selectedRun.status === "FAILED"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-blue-50 text-blue-700 border-blue-200"
                  }`}
                >
                  {selectedRun.status === "RUNNING" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping inline-block" />
                  )}
                  Run: {selectedRun.status}
                </span>
              )}
            </div>

            <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
              {discoveryType === "VENUE"
                ? "Geospatial Venue Scouting & Suitability"
                : `Autonomous Provider Discovery — ${category}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live Google Maps & geospatial radar scouring verified candidates against event requirements.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Run Selector Dropdown */}
            {runs.length > 0 && (
              <div className="relative">
                <select
                  value={selectedRun?.run_id || ""}
                  onChange={(e) => {
                    const r = runs.find((item) => item.run_id === e.target.value);
                    if (r) {
                      setSelectedRun(r);
                      loadRunEvents(r.run_id);
                    }
                  }}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 font-medium text-slate-700 hover:border-slate-300 transition"
                >
                  {runs.map((r, i) => (
                    <option key={r.run_id} value={r.run_id}>
                      Run #{runs.length - i} • {r.status} ({r.discovered} found)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Start Discovery Button */}
            <button
              onClick={handleTriggerDiscovery}
              disabled={scouting}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white shadow-sm transition disabled:opacity-50"
            >
              {scouting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Scouring Live Web...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 fill-white" />
                  <span>Start Live Discovery</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Constraint Summary Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Target City</span>
            <span className="font-semibold text-slate-800 truncate block">
              {eventData?.location || "UNKNOWN"}
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Search Radius</span>
            <span className="font-semibold text-slate-800 truncate block">
              {selectedRun ? `${selectedRun.radius_km} km` : "15 km"}
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Capacity Target</span>
            <span className="font-semibold text-slate-800 truncate block">
              {eventData?.guest_count ? `${eventData.guest_count} attendees` : "UNSET"}
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Category</span>
            <span className="font-semibold text-slate-800 truncate block">{category}</span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Event Type</span>
            <span className="font-semibold text-slate-800 truncate block">
              {eventData?.event_type || "UNKNOWN"}
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Budget Ceiling</span>
            <span className="font-semibold text-slate-800 truncate block">
              {eventData?.total_budget ? `₹${Number(eventData.total_budget).toLocaleString()}` : "UNSET"}
            </span>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-blue-600" />
              {statusMessage}
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-semibold text-blue-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* 2. Dynamic Funnel Display */}
      {selectedRun ? (
        <DiscoveryFunnel
          discovered={selectedRun.discovered}
          unique={selectedRun.unique}
          relevant={selectedRun.relevant}
          matching={selectedRun.matching}
          shortlisted={selectedRun.shortlisted}
          activeStage={funnelStageFilter}
          onStageClick={(stage) =>
            setFunnelStageFilter((prev) => (prev === stage ? null : stage))
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-xs text-slate-500 shadow-sm">
          No discovery run selected yet. Click 'Start Live Discovery' to dispatch autonomous sourcing.
        </div>
      )}

      {/* 3. Adaptive Iterations Toggle & Stepper */}
      {selectedRun && (
        <div className="space-y-2">
          <button
            onClick={() => setShowIterations(!showIterations)}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
          >
            <span>{showIterations ? "Hide" : "Show"} Adaptive Search Iterations ({runEvents.length} events logged)</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showIterations ? "rotate-180" : ""}`} />
          </button>

          {showIterations && (
            <DiscoveryIterationStepper
              events={runEvents}
              currentIteration={selectedRun.current_iteration}
              maxIterations={selectedRun.max_iterations}
              radiusKm={selectedRun.radius_km}
              status={selectedRun.status}
            />
          )}
        </div>
      )}

      {/* 4. Split Workspace (Candidate List + Leaflet Map) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[550px]">
        {/* Left Column: Candidate Cards & Filters (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-3">
          {/* Controls Bar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidates by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
              />
            </div>

            {/* Vendor Category Pills (only in vendor mode) */}
            {discoveryType === "VENDOR" && (
              <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto no-scrollbar">
                {VENDOR_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold transition whitespace-nowrap ${
                      category === cat
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter Status Badge if Funnel Stage Selected */}
          {funnelStageFilter && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs border border-slate-200">
              <span>Filtering by stage: <strong>{funnelStageFilter}</strong></span>
              <button
                onClick={() => setFunnelStageFilter(null)}
                className="text-[11px] text-[#D6003C] hover:underline font-semibold"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Candidate Cards Scrollable Feed */}
          <div className="flex-1 overflow-y-auto max-h-[600px] space-y-2.5 pr-1">
            {scouting && candidates.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
                Scouring external sources and normalizing candidate models...
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                No candidates found matching current criteria.
              </div>
            ) : funnelStageFilter === "SHORTLISTED" ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-1 pb-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold text-slate-900 tracking-tight">
                      Active Event Shortlist ({filteredCandidates.length})
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">Agent picks & confirmed overrides</span>
                </div>
                {filteredCandidates.map((candidate) =>
                  renderCandidateCard(
                    candidate,
                    candidate.tier === "top_matches" ? "top" : candidate.qualification_status === "rejected" ? "rejected" : "other"
                  )
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Tier 1: Agent Shortlist (Pre-selected Top Matches) */}
                {topMatches.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1 pb-1">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        <span className="text-xs font-bold text-slate-900 tracking-tight">
                          Agent Shortlist ({topMatches.length} Top Recommendations)
                        </span>
                        <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full font-semibold">
                          Pre-selected
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">Autonomous Engine Picks</span>
                    </div>
                    {topMatches.map((candidate) => renderCandidateCard(candidate, "top"))}
                  </div>
                )}

                {/* Tier 2: Other Available Options (Secondary) */}
                {otherOptions.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between px-1 pb-1">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-500" />
                        <span className="text-xs font-bold text-slate-800 tracking-tight">
                          Other Available Options ({otherOptions.length})
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">Promote to shortlist as desired</span>
                    </div>
                    {otherOptions.map((candidate) => renderCandidateCard(candidate, "other"))}
                  </div>
                )}

                {/* Tier 3: Backup & Waitlist (Secondary) */}
                {backupWaitlist.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between px-1 pb-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-bold text-slate-800 tracking-tight">
                          Backup & Waitlist Candidates ({backupWaitlist.length})
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">Secondary availability</span>
                    </div>
                    {backupWaitlist.map((candidate) => renderCandidateCard(candidate, "backup"))}
                  </div>
                )}

                {/* Tier 4: Excluded / Disqualified Candidates (Behind Toggle) */}
                {rejectedOptions.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setShowRejected(!showRejected)}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-500" />
                        <span>Excluded Candidates ({rejectedOptions.length} rejected by engine)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{showRejected ? "Hide rejected" : "Review rejected candidates"}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showRejected ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {showRejected && (
                      <div className="mt-3 space-y-2.5 animate-in fade-in duration-150">
                        <div className="text-[11px] text-slate-600 bg-rose-50/50 p-2.5 rounded-lg border border-rose-200 leading-relaxed">
                          These entities were automatically disqualified by the qualification engine (e.g. Non-commercial, PSU/institutional, or failed event constraints). Shortlisting any of these requires explicit manual confirmation.
                        </div>
                        {rejectedOptions.map((candidate) => renderCandidateCard(candidate, "rejected"))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Interactive Leaflet Map (5 cols) */}
        <div className="lg:col-span-5 h-[400px] lg:h-auto min-h-[400px] flex flex-col">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm h-full flex flex-col overflow-hidden p-1.5">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#D6003C]" />
                <span>Geospatial Radar ({mapPlaces.length} mapped)</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {eventData?.location || "Delhi"}
              </span>
            </div>

            <div className="flex-1 w-full relative min-h-[350px]">
              <DiscoveryMap
                places={mapPlaces}
                selectedPlace={selectedMapPlace}
                onSelectPlace={(place) => {
                  const match = candidates.find((c) => c.id === place.id);
                  if (match) {
                    setSelectedCandidate(match);
                  }
                }}
                eventCity={eventData?.location?.split(",")[0] || "Delhi"}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 5. Evidence Drawer */}
      <CandidateEvidenceDrawer
        candidate={selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
        isShortlisted={selectedCandidate ? shortlistedIds.has(selectedCandidate.id) : false}
        onToggleShortlist={handleToggleShortlist}
        onSelectPrimary={handleSelectPrimary}
        isSelecting={actionInProgress === selectedCandidate?.id}
      />

      {/* 6. Manual Override Confirmation Modal (Requirement 4) */}
      {overrideCandidateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Confirm Manual Shortlist Override
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  This entity was disqualified by the agent's automated qualification engine.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1.5">
              <div className="font-semibold text-rose-800">
                Candidate: {overrideCandidateConfirm.name}
              </div>
              <div>
                <span className="font-bold">Reason for Rejection:</span>{" "}
                <span className="font-mono text-[11px] block mt-0.5">
                  {overrideCandidateConfirm.qualification_reason ||
                    overrideCandidateConfirm.matching_reasons?.[0] ||
                    "Institution/PSU — excluded by default"}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to force this candidate into your shortlist? This will bypass the agent's automated suitability and legitimacy gates.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setOverrideCandidateConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOverride}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition"
              >
                Yes, Force Shortlist (Override)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
