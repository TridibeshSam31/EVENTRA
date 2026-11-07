"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Search,
  MapPin,
  CheckCircle2,
  Clock,
  Loader2,
  Zap,
  ArrowRight,
  Building2,
  Users,
  Star,
  ChevronDown,
  ShieldAlert,
  AlertTriangle,
  Globe,
  UtensilsCrossed,
  Speaker,
  Camera,
  Shield,
  Bus,
  Flower2,
  Bookmark,
  BookmarkCheck,
  CalendarCheck2,
  Phone,
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import {
  getDiscoveryRuns,
  getDiscoveryRun,
  getDiscoveryRunEvents,
  startCategoryDiscovery,
} from "@/lib/api/discoveryRuns";
import {
  searchVendors,
  getAssignmentsForEvent,
  createAssignment,
} from "@/lib/api/vendors";
import { searchVenues, recommendVenues, selectEventVenue } from "@/lib/api/venues";
import {
  getEventShortlist,
  addShortlistEntry,
  removeShortlistEntry,
} from "@/lib/api/shortlist";
import type { DiscoveryRun, DiscoveryRunEvent } from "@/types/discoveryRun";
import type { DiscoveryMapEntity, EventResponse } from "@/types/api";

import { DiscoveryFunnel } from "./DiscoveryFunnel";
import { DiscoveryIterationStepper } from "./DiscoveryIterationStepper";
import {
  CandidateEvidenceDrawer,
  CandidateEvidenceData,
  humanizeCategory,
} from "./CandidateEvidenceDrawer";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { describeQualificationReason, EXCLUSION_FALLBACK } from "./CandidateEvidenceDrawer";
import { AgentDiscoveryLive } from "@/components/agent/AgentDiscoveryLive";
import { PopCard, Celebrate, Toast, type ToastTone } from "@/components/ds/motion";
import { JOURNEY_HELP } from "@/lib/journey";

// Dynamic import for Leaflet map to prevent SSR window reference error
const DiscoveryMap = dynamic(
  () => import("@/components/maps/DiscoveryMap"),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> }
);

function MapLoadingPlaceholder() {
  return (
    <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-ink-100 bg-grid-pattern">
      <div className="flex flex-col items-center gap-2 text-ink-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-mono text-[11px]">Loading map…</span>
      </div>
    </div>
  );
}

interface DiscoveryCommandProps {
  eventId: string;
  discoveryType: "VENUE" | "VENDOR";
  defaultCategory?: string;
  className?: string;
  /** show the live agent-run log for this workflow inside the page (one discovery experience) */
  agentRunKind?: "VENUE" | "PROVIDER";
}

type QuickFilter = "saved" | "phone" | "rated";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CATERING: UtensilsCrossed,
  AV_TECH: Speaker,
  PHOTOGRAPHY: Camera,
  SECURITY: Shield,
  TRANSPORT: Bus,
  DECOR: Flower2,
};

export const VENDOR_CATEGORIES = [
  "CATERING",
  "AV_TECH",
  "PHOTOGRAPHY",
  "SECURITY",
  "TRANSPORT",
  "DECOR",
];

const CATEGORY_ALIASES: Record<string, string> = {
  AV: "AV_TECH",
  AUDIO_VISUAL: "AV_TECH",
  AUDIO: "AV_TECH",
  DECORATION: "DECOR",
  FLORIST: "DECOR",
  PHOTO: "PHOTOGRAPHY",
};

/**
 * Turn a `?category=` value (from deep links such as Plan's "Find a vendor")
 * into one of the vendor tabs. Case-insensitive; unknown values return null so
 * the caller keeps its default.
 */
export function resolveVendorCategory(value?: string | null): string | null {
  if (!value) return null;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const resolved = CATEGORY_ALIASES[key] ?? key;
  return VENDOR_CATEGORIES.includes(resolved) ? resolved : null;
}

export function DiscoveryCommand({
  eventId,
  discoveryType,
  defaultCategory,
  className = "",
  agentRunKind,
}: DiscoveryCommandProps) {
  // Canonical workspace integration
  const { opsStatus, shortlist: workspaceShortlist, sseConnected } = useEventWorkspace(eventId);

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

  // Journey + list↔map interaction state (presentation only)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [hotId, setHotId] = useState<string | null>(null); // card/pin under the cursor
  const [focusedId, setFocusedId] = useState<string | null>(null); // pin clicked → card pulses
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());

  // 1. Fetch Event and Discovery Runs
  // 1. Fetch Event, Discovery Runs, and Authoritative Shortlist
  const loadRunsAndEvent = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [evRes, runsRes, shortlistRes] = await Promise.allSettled([
        getEvent(eventId),
        getDiscoveryRuns(eventId, discoveryType === "VENUE" ? "VENUE" : category),
        getEventShortlist(eventId),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }

      if (shortlistRes.status === "fulfilled" && shortlistRes.value?.items) {
        setShortlistedIds(new Set(shortlistRes.value.items.map((i) => i.candidate_id)));
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
      console.error("Failed to load discovery runs or shortlist:", err);
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

  // 3. Load candidates deterministically from database (0 POST requests on page load)
  const loadCandidates = useCallback(async () => {
    if (!eventId) return;
    try {
      setScouting(true);
      const city = eventData?.location?.split(",")[0]?.trim() || "Delhi";

      if (discoveryType === "VENUE") {
        const res = await searchVenues({ city, limit: 30 });
        if (res && res.items) {
          const mapped: CandidateEvidenceData[] = res.items.map((v, idx) => {
            const isVenueRejected =
              v.status === "INACTIVE" ||
              (eventData?.guest_count && v.capacity && v.capacity < eventData.guest_count * 0.8);
            const qualStatus = isVenueRejected ? "rejected" : "qualified";
            const tier = isVenueRejected
              ? "rejected"
              : idx < 3
              ? "top_matches"
              : "other_available_options";

            return {
              id: v.id || `venue-${idx}`,
              name: v.name || "Discovered Venue",
              entity_type: "VENUE",
              category: "VENUE",
              address: v.address || `${city}, India`,
              city: v.city || city,
              latitude: (v as any).latitude ?? null,
              longitude: (v as any).longitude ?? null,
              rating: (v as any).rating ?? null,
              review_count: (v as any).review_count ?? null,
              capacity: v.capacity,
              hourly_rate: v.hourly_rate,
              // Only show a score the backend actually computed; never derive one from list order.
              score: (v as any).score ?? null,
              score_breakdown: {},
              qualification_status: qualStatus,
              qualification_reason: isVenueRejected
                ? "Capacity below event requirements"
                : "Listed venue in the search city",
              tier: tier,
              matching_reasons: v.amenities || [],
              provenance: (v as any).source || "VENUE_NETWORK",
              amenities: v.amenities || [],
              raw: v,
            };
          });
          setCandidates(mapped);
        }
      } else {
        const res = await searchVendors({ category: category.toLowerCase(), city, limit: 30 });
        if (res && res.items) {
          const mapped: CandidateEvidenceData[] = res.items.map((item, idx) => {
            const isItemRejected = item.status === "INACTIVE";
            const tier = isItemRejected ? "rejected" : idx < 3 ? "top_matches" : "other_available_options";

            return {
              id: item.id,
              name: item.name,
              entity_type: "VENDOR",
              category: item.category || category,
              address: item.address,
              city: item.city || city,
              latitude: item.latitude ?? null,
              longitude: item.longitude ?? null,
              rating: item.rating ?? null,
              review_count: item.review_count ?? null,
              distance_km: item.distance_km ?? null,
              phone: item.contact_phone,
              email: item.contact_email,
              website: item.website,
              maps_url: item.maps_url,
              provenance: (item as any).source || "PROVIDER_NETWORK",
              score: (item as any).score ?? null,
              qualification_status: isItemRejected ? "rejected" : "qualified",
              qualification_reason: isItemRejected ? "Provider inactive" : "Listed in this category within the search city",
              tier: tier,
              matching_reasons: [item.category].filter(Boolean) as string[],
              is_assigned: false,
              raw: item,
            };
          });
          setCandidates(mapped);
        }
      }
    } catch (err: any) {
      console.error("Failed to load candidate entities:", err);
    } finally {
      setScouting(false);
    }
  }, [eventId, discoveryType, category, eventData?.location, eventData?.guest_count]);

  useEffect(() => {
    loadRunsAndEvent();
  }, [loadRunsAndEvent]);

  useEffect(() => {
    if (eventData) {
      loadCandidates();
    }
  }, [eventData?.id, category, discoveryType, loadCandidates]);

  // Synchronize shortlisted IDs from canonical workspace store
  useEffect(() => {
    if (workspaceShortlist && workspaceShortlist.length > 0) {
      setShortlistedIds(new Set(workspaceShortlist.map((i) => i.candidate_id)));
    }
  }, [workspaceShortlist]);

  // Synchronize discovery runs from canonical workspace status
  useEffect(() => {
    if (opsStatus?.discovery?.runs && opsStatus.discovery.runs.length > 0) {
      const relevantRuns = opsStatus.discovery.runs.filter((r: any) =>
        discoveryType === "VENUE" ? r.category === "VENUE" : r.category === category
      );
      if (relevantRuns.length > 0) {
        setRuns(relevantRuns);
        const running = relevantRuns.find((r: any) => r.status === "RUNNING");
        if (running) {
          setSelectedRun(running);
        } else if (!selectedRun) {
          setSelectedRun(relevantRuns[0]);
        }
      }
    }
  }, [opsStatus?.discovery, discoveryType, category]);

  // 4. Live Polling Effect while a run is RUNNING. The workspace live stream doesn't carry
  // discovery-run progress for this view, so keep polling — slower while it's connected —
  // instead of stopping (which froze the run at its first state).
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
            `Discovery run finished: ${updatedRun.status} (${updatedRun.discovered} discovered, ${updatedRun.matching || updatedRun.shortlisted || 0} matching).`
          );
          // Refresh candidates list now that background discovery has finished
          loadCandidates();
        }
      } catch (err) {
        console.error("Error polling discovery run:", err);
      }
    }, sseConnected ? 8000 : 4000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [eventId, selectedRun?.run_id, selectedRun?.status, sseConnected, loadCandidates]);

  // Explicit Trigger: ONLY explicit click on Start Discovery creates 1 run
  const handleTriggerDiscovery = async () => {
    if (scouting || selectedRun?.status === "RUNNING") {
      setStatusMessage("Discovery is already in progress.");
      return;
    }

    try {
      setScouting(true);
      setShowIterations(true);
      setStatusMessage(`Initiating discovery for ${category}...`);

      if (discoveryType === "VENUE") {
        const city = eventData?.location?.split(",")[0]?.trim() || "Delhi";
        const guests = eventData?.guest_count || 100;
        const res = await recommendVenues({
          city,
          guest_count: guests,
          event_type: eventData?.event_type || "CONFERENCE",
          event_id: eventId,
        });
        setStatusMessage("Geospatial venue recommendation completed.");
        if (res && res.ranked_venues) {
          await loadCandidates();
          await loadRunsAndEvent();
        }
      } else {
        const res = await startCategoryDiscovery(eventId, {
          category,
          radius_km: selectedRun?.radius_km || 10,
          target_count: 5,
        });
        setStatusMessage(res.message || `Discovery run started for ${category}.`);

        if (res.run_id) {
          const newRun = await getDiscoveryRun(eventId, res.run_id);
          setSelectedRun(newRun);
          setRuns((prev) => [newRun, ...prev.filter((r) => r.run_id !== newRun.run_id)]);
          const events = await getDiscoveryRunEvents(eventId, res.run_id);
          setRunEvents(events);
        } else {
          await loadRunsAndEvent();
        }
      }
    } catch (err: any) {
      console.error("Discovery run dispatch failed:", err);
      setStatusMessage(err.message || "Failed to start discovery run.");
    } finally {
      setScouting(false);
    }
  };

  // Persistent Shortlist Toggle: Persists to backend database via POST/DELETE
  const handleToggleShortlist = async (candidate: CandidateEvidenceData) => {
    // If candidate is rejected and not currently shortlisted, require explicit confirmation
    if (candidate.qualification_status === "rejected" && !shortlistedIds.has(candidate.id)) {
      setOverrideCandidateConfirm(candidate);
      return;
    }

    const isCurrentlyShortlisted = shortlistedIds.has(candidate.id);
    if (isCurrentlyShortlisted) {
      try {
        await removeShortlistEntry(eventId, candidate.id);
        setShortlistedIds((prev) => {
          const next = new Set(prev);
          next.delete(candidate.id);
          return next;
        });
        setStatusMessage(`Removed ${candidate.name} from saved.`);
      } catch (err: any) {
        console.error("Failed to remove candidate from shortlist:", err);
        setStatusMessage("Couldn't remove it from saved. Please try again.");
      }
    } else {
      try {
        await addShortlistEntry(eventId, {
          candidate_id: candidate.id,
          provider_id: candidate.id.startsWith("venue-") ? undefined : candidate.id,
          category: candidate.category,
          candidate_name: candidate.name,
          candidate_data: {
            address: candidate.address,
            city: candidate.city,
            rating: candidate.rating,
            score: candidate.score,
            provenance: candidate.provenance,
          },
        });
        setShortlistedIds((prev) => {
          const next = new Set(prev);
          next.add(candidate.id);
          return next;
        });
        setStatusMessage(`Saved ${candidate.name}.`);
      } catch (err: any) {
        console.error("Failed to add candidate to shortlist:", err);
        setStatusMessage("Couldn't save it. Please try again.");
      }
    }
  };

  const handleConfirmOverride = async () => {
    if (!overrideCandidateConfirm) return;
    try {
      await addShortlistEntry(eventId, {
        candidate_id: overrideCandidateConfirm.id,
        category: overrideCandidateConfirm.category,
        candidate_name: overrideCandidateConfirm.name,
        notes: "Organizer explicit manual override",
        candidate_data: {
          address: overrideCandidateConfirm.address,
          rating: overrideCandidateConfirm.rating,
          score: overrideCandidateConfirm.score,
        },
      });
      setShortlistedIds((prev) => {
        const next = new Set(prev);
        next.add(overrideCandidateConfirm.id);
        return next;
      });
      setStatusMessage(
        `Saved ${overrideCandidateConfirm.name} as a manual override.`
      );
    } catch (err) {
      console.error("Failed to persist override shortlist:", err);
    }
    setOverrideCandidateConfirm(null);
  };

  // Primary contract / lock selection
  const handleSelectPrimary = async (candidate: CandidateEvidenceData) => {
    try {
      setActionInProgress(candidate.id);
      if (candidate.entity_type === "VENUE") {
        await selectEventVenue(eventId, candidate.id);
        setStatusMessage(`${candidate.name} is now booked as the venue.`);
      } else {
        await createAssignment({
          event_id: eventId,
          vendor_id: candidate.id,
          category: candidate.category,
        });
        setStatusMessage(`Booking requested for ${candidate.name} — it's waiting in Approvals.`);
      }
      setRequestedIds((prev) => new Set(prev).add(candidate.id));
      setCelebrateId(candidate.id);
      setTimeout(() => setCelebrateId((cur) => (cur === candidate.id ? null : cur)), 1800);
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
      if (quickFilters.has("saved") && !shortlistedIds.has(c.id)) return false;
      if (quickFilters.has("phone") && !c.phone) return false;
      if (quickFilters.has("rated") && !(c.rating != null && c.rating >= 4)) return false;

      if (funnelStageFilter === "SHORTLISTED") {
        return shortlistedIds.has(c.id);
      }
      if (funnelStageFilter === "MATCHING" || funnelStageFilter === "RELEVANT") {
        return c.qualification_status !== "rejected";
      }
      return true;
    });
  }, [candidates, searchQuery, funnelStageFilter, shortlistedIds, quickFilters]);

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

  // One number per candidate, shared by its card and its map pin.
  const positions = useMemo(() => {
    const ordered =
      funnelStageFilter === "SHORTLISTED"
        ? filteredCandidates
        : [...topMatches, ...otherOptions, ...backupWaitlist, ...rejectedOptions];
    const out: Record<string, string> = {};
    ordered.forEach((c, i) => {
      out[c.id] = String(i + 1);
    });
    return out;
  }, [funnelStageFilter, filteredCandidates, topMatches, otherOptions, backupWaitlist, rejectedOptions]);

  // Pin click → bring its card into view and pulse it (the drawer opens from the card).
  const focusCard = useCallback((id: string) => {
    setFocusedId(id);
    if (typeof document !== "undefined") {
      document.getElementById(`cand-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setTimeout(() => setFocusedId((cur) => (cur === id ? null : cur)), 2400);
  }, []);

  const toggleQuickFilter = (f: QuickFilter) =>
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

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
    const id = selectedCandidate?.id ?? focusedId;
    if (!id) return null;
    return mapPlaces.find((p) => p.id === id) || null;
  }, [selectedCandidate, focusedId, mapPlaces]);

  // ── Presentation helpers ───────────────────────────────────────────
  const categoryLabel = humanizeCategory(category);
  const runMeta = runStatusMeta(selectedRun?.status);
  const isRunActive = scouting || selectedRun?.status === "RUNNING";
  const unmappedCount = candidates.length - mapPlaces.length;
  const eventCityLabel = eventData?.location?.split(",")[0]?.trim();

  const briefRows: { label: string; value: string | null; hint?: string }[] = [
    { label: "Location", value: eventData?.location || null },
    {
      label: "Search radius",
      value: selectedRun ? `${selectedRun.radius_km} km` : "10 km",
      hint: selectedRun ? undefined : "default",
    },
    { label: "Guests", value: eventData?.guest_count ? eventData.guest_count.toLocaleString() : null },
    { label: "Looking for", value: categoryLabel },
    { label: "Event type", value: eventData?.event_type ? humanizeCategory(eventData.event_type) : null },
    {
      label: "Budget ceiling",
      value: eventData?.total_budget ? `₹${Number(eventData.total_budget).toLocaleString()}` : null,
    },
  ];

  // Helper to render candidate card by tier
  const renderCandidateCard = (
    candidate: CandidateEvidenceData,
    tierType: "top" | "other" | "backup" | "rejected",
    position: number
  ) => {
    const isShort = shortlistedIds.has(candidate.id);
    const isSelected = selectedCandidate?.id === candidate.id;
    const isRejected = tierType === "rejected" || candidate.qualification_status === "rejected";
    const isTop = tierType === "top";
    const isRequested = candidate.is_assigned || requestedIds.has(candidate.id);
    const isVenue = candidate.entity_type === "VENUE";
    const score = candidate.score != null ? Math.round(candidate.score) : null;
    const isHot = hotId === candidate.id;
    const number = positions[candidate.id] ?? String(position);
    const busy = actionInProgress === candidate.id;

    return (
      <PopCard
        key={candidate.id}
        id={`cand-${candidate.id}`}
        index={position - 1}
        attention={focusedId === candidate.id}
        onMouseEnter={() => setHotId(candidate.id)}
        onMouseLeave={() => setHotId((cur) => (cur === candidate.id ? null : cur))}
        className={`group overflow-hidden rounded-xl border bg-[#FDFCFA] ${
          isSelected || isHot
            ? "border-cue-400 shadow-md"
            : isRejected
            ? "border-ink-200 bg-ink-50/60"
            : "border-ink-200 shadow-sm"
        }`}
      >
        {/* left rule communicates state at a glance */}
        <span
          className={`absolute inset-y-0 left-0 w-[3px] transition-colors ${
            isRejected ? "bg-cue-400" : isRequested ? "bg-go-500" : isShort ? "bg-ink-900" : isTop ? "bg-agent-500" : "bg-transparent"
          }`}
          aria-hidden
        />

        <button
          type="button"
          onClick={() => setSelectedCandidate(candidate)}
          className="flex w-full items-start gap-3.5 px-4 pb-3 pt-3.5 text-left"
          aria-label={`View evidence for ${candidate.name}`}
        >
          <span
            className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold transition-colors ${
              isHot ? "bg-cue-600 text-white" : isTop ? "bg-ink-900 text-ink-50" : "border border-ink-200 bg-paper text-ink-500"
            }`}
            title="Matches the number on the map"
          >
            {number}
          </span>

          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[14.5px] font-semibold tracking-[-0.01em] ${
                isRejected ? "text-ink-500 line-through decoration-cue-400/70" : "text-ink-900"
              }`}
            >
              {candidate.name}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-500">
              <MapPin className="h-3 w-3 shrink-0 text-ink-400" />
              <span className="truncate">{candidate.address || candidate.city || "Location unknown"}</span>
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <ProvenanceBadge source={candidate.provenance} size="sm" />
              {isTop && !isRejected && (
                <span className="chip border-agent-200 bg-agent-50 px-1.5 py-px text-[10px] text-agent-700">
                  <span aria-hidden>✦</span> Agent pick
                </span>
              )}
              {candidate.rating != null ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-700">
                  <Star className="h-3 w-3 fill-standby-400 text-standby-400" />
                  {candidate.rating.toFixed(1)}
                  {candidate.review_count != null && (
                    <span className="font-normal text-ink-400">({candidate.review_count.toLocaleString()})</span>
                  )}
                </span>
              ) : (
                <span className="text-[11px] italic text-ink-400">No public rating</span>
              )}
              {candidate.phone && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-600">
                  <Phone className="h-3 w-3 text-ink-400" /> Phone listed
                </span>
              )}
              {candidate.capacity != null && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-600">
                  <Users className="h-3 w-3 text-ink-400" />
                  {candidate.capacity.toLocaleString()}
                </span>
              )}
              {candidate.distance_km != null && (
                <span className="font-mono text-[11px] text-ink-500">{candidate.distance_km.toFixed(1)} km</span>
              )}
            </span>
          </span>

          {/* Only show a score when the engine actually returned one */}
          {!isRejected && score != null && (
            <span className="shrink-0 text-right">
              <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Score</span>
              <span
                className="block font-display text-[24px] font-extrabold leading-none tabular-nums text-ink-900"
                style={{ fontStretch: "85%" }}
              >
                {score}
              </span>
              <span className="mt-1.5 block h-1 w-12 overflow-hidden rounded-full bg-ink-200/70" aria-hidden>
                <span
                  className={`block h-full rounded-full ${isTop ? "bg-agent-500" : "bg-ink-700"}`}
                  style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
              </span>
            </span>
          )}
        </button>

        {isRejected && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-cue-200 bg-cue-50/70 px-3 py-2 text-[12px] text-cue-900">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-cue-600" />
            <span>
              <span className="font-semibold">Excluded by engine: </span>
              {describeQualificationReason(candidate.qualification_reason || candidate.matching_reasons?.[0]) ||
                EXCLUSION_FALLBACK}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-dashed border-ink-200 px-4 py-2">
          <button
            onClick={() => setSelectedCandidate(candidate)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-600 transition hover:text-ink-900"
          >
            Evidence <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* One primary action: the vendor's next step on the journey */}
          <div className="relative flex items-center gap-1.5">
            <span className="pointer-events-none absolute -top-9 right-0">
              <Celebrate show={celebrateId === candidate.id} label={isVenue ? "Booked" : "Requested"} />
            </span>

            {isRejected ? (
              <button
                onClick={() => handleToggleShortlist(candidate)}
                className={`btn h-7 px-2.5 text-[12px] ${
                  isShort
                    ? "bg-standby-600 text-white hover:bg-standby-700"
                    : "border border-cue-200 bg-[#FDFCFA] text-cue-700 hover:bg-cue-50"
                }`}
              >
                {isShort ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                {isShort ? "Saved (override)" : "Save anyway"}
              </button>
            ) : isRequested ? (
              isVenue ? (
                <span className="chip border-go-200 bg-go-50 text-go-700">
                  <CalendarCheck2 className="h-3 w-3" /> Venue booked
                </span>
              ) : (
                <Link
                  href={`/events/${eventId}/approvals`}
                  className="chip border-go-200 bg-go-50 text-go-700 transition hover:bg-go-100"
                  title="Open Approvals"
                >
                  <CalendarCheck2 className="h-3 w-3" /> Booking requested <ArrowRight className="h-3 w-3" />
                </Link>
              )
            ) : isShort ? (
              <>
                <button
                  onClick={() => handleToggleShortlist(candidate)}
                  className="btn-ghost h-7 px-2 text-[12px] text-ink-700"
                  title="Saved — click to remove"
                  aria-pressed
                >
                  <BookmarkCheck className="h-3.5 w-3.5 text-ink-900" /> Saved
                </button>
                <button
                  onClick={() => handleSelectPrimary(candidate)}
                  disabled={busy}
                  className="btn-primary h-7 px-2.5 text-[12px]"
                  title={isVenue ? "Locks this venue to the event right away." : JOURNEY_HELP.book}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck2 className="h-3.5 w-3.5" />}
                  {busy ? "Sending…" : isVenue ? "Book venue" : "Request booking"}
                </button>
              </>
            ) : (
              <button
                onClick={() => handleToggleShortlist(candidate)}
                className="btn-primary h-7 px-2.5 text-[12px]"
                title={JOURNEY_HELP.save}
              >
                <Bookmark className="h-3.5 w-3.5" /> Save
              </button>
            )}
          </div>
        </div>
      </PopCard>
    );
  };

  let positionCounter = 0;
  const nextPos = () => ++positionCounter;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Brief & controls */}
      <section className="surface overflow-hidden">
        <div className="flex flex-col gap-5 px-5 pb-4 pt-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">{discoveryType === "VENUE" ? "Discover · Venues" : "Discover · Vendors"}</span>
              {selectedRun && (
                <span className={`chip ${runMeta.chip}`}>
                  <span className={`cue-light ${runMeta.dot}`} />
                  {runMeta.label}
                </span>
              )}
            </div>
            <h2
              className="mt-2 font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink-900 sm:text-[30px]"
              style={{ fontStretch: "88%" }}
            >
              {discoveryType === "VENUE" ? "Find the right venue" : `Find ${categoryLabel.toLowerCase()} vendors`}
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-600">
              The agent searches live map data, removes duplicates and checks every result against this event&apos;s
              requirements before anything reaches your shortlist.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {runs.length > 0 && (
              <label className="relative">
                <span className="sr-only">Discovery run</span>
                <select
                  value={selectedRun?.run_id || ""}
                  onChange={(e) => {
                    const r = runs.find((item) => item.run_id === e.target.value);
                    if (r) {
                      setSelectedRun(r);
                      loadRunEvents(r.run_id);
                    }
                  }}
                  className="h-9 appearance-none rounded-lg border border-ink-200 bg-[#FDFCFA] pl-3 pr-8 font-mono text-[12px] text-ink-700 shadow-sm transition hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-cue-500/20"
                >
                  {runs.map((r, i) => (
                    <option key={r.run_id} value={r.run_id}>
                      Run {runs.length - i} · {runStatusMeta(r.status).label} · {r.discovered} found
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              </label>
            )}

            <Link
              href={`/browser-runtime?eventId=${encodeURIComponent(eventId)}&category=${encodeURIComponent(category)}`}
              className="btn-secondary"
              title="Launch the browser agent on your Windows companion to search the web live"
            >
              <Globe className="h-3.5 w-3.5 text-ink-500" />
              Browser agent
            </Link>

            <button onClick={handleTriggerDiscovery} disabled={scouting} className="btn-cue" data-guide-step="start_discovery">
              {scouting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5 fill-white" />
                  {runs.length > 0 ? "Run discovery again" : "Start discovery"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Category tabs (vendor mode) */}
        {discoveryType === "VENDOR" && (
          <div className="border-t border-ink-200 px-3">
            <div role="tablist" aria-label="Vendor category" className="-mb-px flex gap-1 overflow-x-auto">
              {VENDOR_CATEGORIES.map((cat) => {
                const active = category === cat;
                const Icon = CATEGORY_ICONS[cat] || Building2;
                return (
                  <button
                    key={cat}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCategory(cat)}
                    className={`relative inline-flex shrink-0 items-center gap-2 px-3 py-3 text-[13px] font-semibold transition ${
                      active ? "text-ink-900" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-cue-600" : "text-ink-400"}`} />
                    {humanizeCategory(cat)}
                    <span
                      className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full transition ${
                        active ? "bg-cue-600" : "bg-transparent"
                      }`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search brief — what the agent is working from */}
        <dl className="grid grid-cols-2 gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-3 lg:grid-cols-6">
          {briefRows.map((row) => (
            <div key={row.label} className="min-w-0 bg-ink-50 px-5 py-3">
              <dt className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">{row.label}</dt>
              <dd className="mt-1 truncate text-[13.5px]">
                {row.value ? (
                  <span className="font-semibold text-ink-900">
                    {row.value}
                    {row.hint && <span className="ml-1 font-normal text-ink-400">({row.hint})</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 italic text-ink-400">
                    <span className="grid h-4 w-4 place-items-center rounded-full border border-dashed border-ink-300 font-mono text-[9px] not-italic">
                      ?
                    </span>
                    Not set
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

      </section>

      {/* 2. Funnel */}
      {selectedRun ? (
        <DiscoveryFunnel
          discovered={selectedRun.discovered}
          unique={selectedRun.unique}
          relevant={selectedRun.relevant}
          matching={selectedRun.matching}
          shortlisted={selectedRun.shortlisted}
          activeStage={funnelStageFilter}
          onStageClick={(stage) => setFunnelStageFilter((prev) => (prev === stage ? null : stage))}
        />
      ) : (
        !loading && (
          <section className="relative overflow-hidden rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/70 px-5 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="cue-light mt-1.5 bg-standby-500" />
                <div>
                  <div className="text-[14px] font-semibold text-ink-900">No discovery run yet</div>
                  <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-500">
                    Start a run and the funnel fills in live — discovered, unique, relevant, matching and shortlisted —
                    with every count coming from the engine.
                  </p>
                </div>
              </div>
              <ol className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-label text-ink-400">
                {["Search", "Dedupe", "Qualify", "Match", "Rank"].map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 && (
                      <li aria-hidden className="text-ink-300">
                        →
                      </li>
                    )}
                    <li>{s}</li>
                  </React.Fragment>
                ))}
              </ol>
            </div>
          </section>
        )
      )}

      {/* 3. Agent discovery log */}
      {selectedRun && (
        <div className="space-y-3">
          <button
            onClick={() => setShowIterations(!showIterations)}
            aria-expanded={showIterations}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 bg-[#FDFCFA] px-4 py-2.5 text-left shadow-sm transition hover:border-ink-300"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="text-agent-500" aria-hidden>
                ✦
              </span>
              <span className="text-[13px] font-semibold text-ink-900">Agent discovery log</span>
              <span className="truncate font-mono text-[11px] text-ink-400">
                {runEvents.length} {runEvents.length === 1 ? "entry" : "entries"} · iteration{" "}
                {selectedRun.current_iteration ?? 1} of {selectedRun.max_iterations ?? "?"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-ink-500">
              {showIterations ? "Hide" : "Show"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showIterations ? "rotate-180" : ""}`} />
            </span>
          </button>

          {showIterations && (
            <DiscoveryIterationStepper
              events={runEvents}
              currentIteration={selectedRun.current_iteration}
              maxIterations={selectedRun.max_iterations}
              radiusKm={selectedRun.radius_km}
              status={selectedRun.status}
              className="animate-rise-in"
            />
          )}
        </div>
      )}

      {agentRunKind && (
        <AgentDiscoveryLive eventId={eventId} kind={agentRunKind} activeCategory={category} embedded />
      )}

      {/* 4. Candidates + map */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
          {/* Search + summary */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="Search by name, area or category"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search candidates"
                className="h-9 w-full rounded-lg border border-ink-200 bg-[#FDFCFA] pl-9 pr-3 text-[13px] text-ink-900 shadow-sm transition placeholder:text-ink-400 focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-cue-500/15"
              />
            </div>
            <div className="font-mono text-[11px] text-ink-500">
              {filteredCandidates.length} of {candidates.length} candidates
              {shortlistedIds.size > 0 && <span className="text-ink-900"> · {shortlistedIds.size} saved</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
            {(
              [
                ["saved", "Saved only", BookmarkCheck],
                ["phone", "Has phone", Phone],
                ["rated", "Rating 4+", Star],
              ] as Array<[QuickFilter, string, React.ComponentType<{ className?: string }>]>
            ).map(([key, label, Icon]) => {
              const on = quickFilters.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleQuickFilter(key)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition active:scale-95 ${
                    on
                      ? "border-ink-900 bg-ink-900 text-ink-50 shadow-sm"
                      : "border-ink-200 bg-[#FDFCFA] text-ink-600 hover:border-ink-300 hover:text-ink-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
            {quickFilters.size > 0 && (
              <button
                type="button"
                onClick={() => setQuickFilters(new Set())}
                className="px-1.5 text-[12px] font-semibold text-ink-500 hover:text-ink-900"
              >
                Clear
              </button>
            )}
          </div>

          {funnelStageFilter && (
            <div className="flex items-center justify-between rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] text-ink-100">
              <span>
                Showing stage <span className="font-semibold text-white">{funnelStageFilter.toLowerCase()}</span>
              </span>
              <button
                onClick={() => setFunnelStageFilter(null)}
                className="text-[12px] font-semibold text-cue-300 hover:text-cue-200"
              >
                Clear filter
              </button>
            </div>
          )}

          <div className="space-y-6">
            {scouting && candidates.length === 0 ? (
              <div className="space-y-2.5" aria-busy="true" aria-label="Loading candidates">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border border-ink-200 bg-[#FDFCFA] p-4">
                    <div className="flex gap-3">
                      <div className="workspace-shimmer h-7 w-7 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <div className="workspace-shimmer h-3.5 w-1/2 rounded" />
                        <div className="workspace-shimmer h-3 w-3/4 rounded" />
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-center font-mono text-[11px] text-ink-400">Normalising candidates from sources…</p>
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-6 py-14 text-center">
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-400 shadow-sm">
                  <Search className="h-5 w-5" />
                </div>
                <div className="text-[15px] font-semibold text-ink-900">
                  {candidates.length === 0 ? "No candidates yet" : "Nothing matches this filter"}
                </div>
                <p className="mt-1.5 max-w-[44ch] text-[13px] leading-relaxed text-ink-500">
                  {candidates.length === 0
                    ? `Run discovery to search for ${
                        discoveryType === "VENUE" ? "venues" : categoryLabel.toLowerCase() + " vendors"
                      } near ${eventCityLabel || "the event"}. Results appear here and on the map.`
                    : "Try a different search, or clear the filters."}
                </p>
                {candidates.length === 0 && (
                  <button onClick={handleTriggerDiscovery} disabled={scouting} className="btn-primary mt-5">
                    <Zap className="h-3.5 w-3.5" /> Start discovery
                  </button>
                )}
              </div>
            ) : funnelStageFilter === "SHORTLISTED" ? (
              <div className="space-y-2.5">
                <TierHeading
                  icon={<CheckCircle2 className="h-4 w-4 text-go-600" />}
                  title="Saved"
                  count={filteredCandidates.length}
                  caption="Your saved options, including overrides"
                />
                {filteredCandidates.map((candidate) =>
                  renderCandidateCard(
                    candidate,
                    candidate.tier === "top_matches"
                      ? "top"
                      : candidate.qualification_status === "rejected"
                      ? "rejected"
                      : "other",
                    nextPos()
                  )
                )}
              </div>
            ) : (
              <>
                {topMatches.length > 0 && (
                  <div className="space-y-2.5">
                    <TierHeading
                      icon={<span className="text-[15px] leading-none text-agent-500">✦</span>}
                      title="Agent recommendations"
                      count={topMatches.length}
                      caption="Pre-selected top matches"
                    />
                    {topMatches.map((c) => renderCandidateCard(c, "top", nextPos()))}
                  </div>
                )}

                {otherOptions.length > 0 && (
                  <div className="space-y-2.5">
                    <TierHeading
                      icon={<Users className="h-4 w-4 text-ink-400" />}
                      title="Other qualified options"
                      count={otherOptions.length}
                      caption="Save the ones you like"
                    />
                    {otherOptions.map((c) => renderCandidateCard(c, "other", nextPos()))}
                  </div>
                )}

                {backupWaitlist.length > 0 && (
                  <div className="space-y-2.5">
                    <TierHeading
                      icon={<Clock className="h-4 w-4 text-standby-500" />}
                      title="Backup & waitlist"
                      count={backupWaitlist.length}
                      caption="Secondary availability"
                    />
                    {backupWaitlist.map((c) => renderCandidateCard(c, "backup", nextPos()))}
                  </div>
                )}

                {rejectedOptions.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRejected(!showRejected)}
                      aria-expanded={showRejected}
                      className="flex w-full items-center justify-between rounded-xl border border-dashed border-ink-300 px-4 py-3 text-left transition hover:bg-[#FDFCFA]"
                    >
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
                        <ShieldAlert className="h-4 w-4 text-cue-500" />
                        Excluded by the engine
                        <span className="font-mono text-[11px] font-normal text-ink-400">{rejectedOptions.length}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[12px] text-ink-500">
                        {showRejected ? "Hide" : "Review"}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRejected ? "rotate-180" : ""}`} />
                      </span>
                    </button>

                    {showRejected && (
                      <div className="mt-3 space-y-2.5 animate-rise-in">
                        <p className="rounded-lg bg-ink-100/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-600">
                          These were automatically excluded (for example non-commercial, PSU/institutional, or failing
                          event constraints). Saving one anyway needs an explicit manual confirmation.
                        </p>
                        {rejectedOptions.map((c) => renderCandidateCard(c, "rejected", nextPos()))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-5">
          <section className="surface flex h-[420px] flex-col overflow-hidden lg:sticky lg:top-4 lg:h-[calc(100dvh-140px)] lg:max-h-[720px]">
            <header className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cue-600" />
                <span className="text-[13px] font-semibold text-ink-900">Map</span>
                <span className="font-mono text-[11px] text-ink-400">{mapPlaces.length} plotted</span>
              </div>
              <span className="truncate font-mono text-[11px] text-ink-500">
                {eventData?.location || "Location not set"}
              </span>
            </header>
            <div className="relative min-h-[320px] flex-1 border-y border-ink-200">
              <DiscoveryMap
                places={mapPlaces}
                selectedPlace={selectedMapPlace}
                onSelectPlace={(place) => {
                  const match = candidates.find((c) => c.id === place.id);
                  if (match) {
                    focusCard(match.id);
                  }
                }}
                highlightedId={hotId}
                onHoverPlace={(place) => setHotId(place ? place.id : null)}
                labels={positions}
                eventCity={eventData?.location?.split(",")[0] || "Delhi"}
              />
            </div>
            <footer className="flex items-center justify-between gap-2 px-4 py-2 text-[11.5px] text-ink-500">
              <span>Pin numbers match the list. Markers use each source&apos;s real coordinates.</span>
              {unmappedCount > 0 && (
                <span className="font-mono text-standby-700">{unmappedCount} without coordinates</span>
              )}
            </footer>
          </section>
        </div>
      </div>

      {/* Friendly, auto-dismissing feedback for every action */}
      <Toast
        message={statusMessage}
        tone={toastTone(statusMessage, isRunActive)}
        onDone={() => setStatusMessage(null)}
        ms={isRunActive ? 5000 : 3600}
      />

      {/* 5. Evidence drawer */}
      <CandidateEvidenceDrawer
        candidate={selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
        isShortlisted={selectedCandidate ? shortlistedIds.has(selectedCandidate.id) : false}
        onToggleShortlist={handleToggleShortlist}
        onSelectPrimary={handleSelectPrimary}
        isSelecting={actionInProgress === selectedCandidate?.id}
        isRequested={selectedCandidate ? requestedIds.has(selectedCandidate.id) : false}
        approvalsHref={`/events/${eventId}/approvals`}
      />

      {/* 6. Manual override confirmation */}
      {overrideCandidateConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm saving an excluded option"
        >
          <div className="w-full max-w-md animate-rise-in overflow-hidden rounded-2xl bg-paper shadow-2xl">
            <div className="flex items-start gap-3 px-6 pb-4 pt-6">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cue-50 ring-1 ring-cue-200">
                <AlertTriangle className="h-5 w-5 text-cue-600" />
              </div>
              <div>
                <h3 className="text-[16px] font-bold text-ink-900">Override the engine?</h3>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {overrideCandidateConfirm.name} was excluded by automated qualification.
                </p>
              </div>
            </div>

            <div className="mx-6 rounded-xl border border-cue-200 bg-cue-50 px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-cue-800">
                <ProvenanceBadge provenance="ENGINE" size="sm" /> Reason for exclusion
              </div>
              <p className="mt-1.5 font-mono text-[12px] text-cue-900">
                {describeQualificationReason(
                  overrideCandidateConfirm.qualification_reason || overrideCandidateConfirm.matching_reasons?.[0]
                ) || EXCLUSION_FALLBACK}
              </p>
            </div>

            <p className="px-6 pt-4 text-[13px] leading-relaxed text-ink-600">
              Saving it skips the suitability and legitimacy checks and is recorded as a manual override.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink-200 bg-[#FDFCFA] px-6 py-4">
              <button type="button" onClick={() => setOverrideCandidateConfirm(null)} className="btn-ghost">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmOverride} className="btn bg-cue-600 text-white hover:bg-cue-700">
                Yes, save anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TierHeading({
  icon,
  title,
  count,
  caption,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  caption?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-2 px-0.5 pb-1">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[13px] font-semibold text-ink-900">{title}</span>
        <span className="font-mono text-[11px] text-ink-400">{count}</span>
      </div>
      {caption && <span className="hidden text-[11.5px] text-ink-400 sm:inline">{caption}</span>}
    </div>
  );
}

function runStatusMeta(status?: string | null): { label: string; chip: string; dot: string } {
  switch (status) {
    case "RUNNING":
      return {
        label: "Searching",
        chip: "border-standby-200 bg-standby-50 text-standby-800",
        dot: "bg-standby-500 animate-cue-blink",
      };
    case "COMPLETED":
      return { label: "Completed", chip: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" };
    case "TARGET_REACHED":
      return { label: "Target reached", chip: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" };
    case "EXHAUSTED":
      return { label: "Search exhausted", chip: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500" };
    case "FAILED":
      return { label: "Failed", chip: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600" };
    default:
      return {
        label: status ? humanizeCategory(status) : "No run",
        chip: "border-ink-200 bg-ink-100/70 text-ink-600",
        dot: "bg-ink-400",
      };
  }
}

/** Pick a toast colour from the message: errors red, successes green, progress ink. */
function toastTone(message: string | null, running: boolean): ToastTone {
  if (!message) return "ink";
  if (/fail|couldn|error|did not/i.test(message)) return "cue";
  if (running) return "ink";
  if (/saved|booked|requested|finished|completed/i.test(message)) return "go";
  return "ink";
}
