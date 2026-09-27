"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader2, MapPin, Building2, Users } from "lucide-react";
import type { DiscoveryMapEntity } from "@/types/api";

const DiscoveryMap = dynamic(
  () => import("@/components/maps/DiscoveryMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[350px] bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <span className="text-xs">Initializing recovery geospatial radar...</span>
        </div>
      </div>
    ),
  }
);

export interface RecoveryCandidateLocation {
  id: string;
  name: string;
  category: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  city?: string | null;
  rating?: number | null;
  review_count?: number | null;
  phone?: string | null;
  score?: number | null;
  provenance?: string | null;
}

interface RecoveryDiscoveryMapProps {
  candidates: RecoveryCandidateLocation[];
  selectedId?: string | null;
  onSelectCandidate?: (candidate: RecoveryCandidateLocation) => void;
  eventCity?: string;
  className?: string;
}

export function RecoveryDiscoveryMap({
  candidates,
  selectedId,
  onSelectCandidate,
  eventCity = "Delhi",
  className = "",
}: RecoveryDiscoveryMapProps) {
  // Only candidates with verified numerical coordinates
  const mapPlaces: DiscoveryMapEntity[] = useMemo(() => {
    return candidates
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        entity_type: c.category === "VENUE" ? ("VENUE" as const) : ("PROVIDER" as const),
        category: c.category,
        latitude: c.latitude as number,
        longitude: c.longitude as number,
        address: c.address || "",
        city: c.city || eventCity,
        rating: c.rating,
        review_count: c.review_count,
        phone: c.phone,
      }));
  }, [candidates, eventCity]);

  const selectedPlace = useMemo(() => {
    if (!selectedId) return null;
    return mapPlaces.find((p) => p.id === selectedId) || null;
  }, [selectedId, mapPlaces]);

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between text-xs bg-slate-50/50">
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-[#D6003C]" />
          <span>Backup Provider Radar ({mapPlaces.length} mapped)</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          Anchored: {eventCity}
        </span>
      </div>

      <div className="flex-1 w-full min-h-[360px] relative p-1.5">
        <DiscoveryMap
          places={mapPlaces}
          selectedPlace={selectedPlace}
          onSelectPlace={(place) => {
            const match = candidates.find((c) => c.id === place.id);
            if (match && onSelectCandidate) {
              onSelectCandidate(match);
            }
          }}
          eventCity={eventCity}
        />
      </div>
    </div>
  );
}
