"use client";

import React from "react";
import { ShieldCheck, Database, Radio, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";

export type ProvenanceType =
  | "LIVE_SCRAPE"
  | "CACHED_DB"
  | "OSM_FALLBACK"
  | "VERIFIED_OUTREACH"
  | "SIMULATED"
  | "DEMO_FALLBACK"
  | string;

interface ProvenanceBadgeProps {
  source?: ProvenanceType;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ProvenanceBadge({
  source = "LIVE_SCRAPE",
  size = "md",
  showLabel = true,
  className = "",
}: ProvenanceBadgeProps) {
  const normSource = (source || "LIVE_SCRAPE").toUpperCase();

  let config = {
    label: "Live Scrape",
    detail: "Fetched via live Google Maps scraper",
    icon: Radio,
    bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-400",
  };

  if (normSource.includes("VERIFIED") || normSource.includes("OUTREACH")) {
    config = {
      label: "Verified Outreach",
      detail: "Directly confirmed via WhatsApp / Voice Call",
      icon: ShieldCheck,
      bg: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      dot: "bg-purple-400",
    };
  } else if (normSource.includes("CACHE") || normSource.includes("DB")) {
    config = {
      label: "Cached DB",
      detail: "Verified provider from local directory within search radius",
      icon: Database,
      bg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      dot: "bg-blue-400",
    };
  } else if (normSource.includes("OSM") || normSource.includes("OPENSTREETMAP")) {
    config = {
      label: "OSM Network",
      detail: "Discovered via OpenStreetMap live geospatial radar",
      icon: MapPin,
      bg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      dot: "bg-amber-400",
    };
  } else if (normSource.includes("SIMULATED") || normSource.includes("DEMO") || normSource.includes("MOCK")) {
    config = {
      label: "Simulated",
      detail: "Synthetic sandbox fixture for fallback demonstration",
      icon: AlertCircle,
      bg: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      dot: "bg-zinc-400",
    };
  }

  const Icon = config.icon;
  const sizeClasses =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5 gap-1"
      : size === "lg"
      ? "text-xs px-2.5 py-1 gap-1.5"
      : "text-[11px] px-2 py-0.5 gap-1.5";

  return (
    <span
      title={config.detail}
      className={`inline-flex items-center font-medium rounded-full border transition-all duration-150 ${config.bg} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${config.dot}`} />
      <Icon className="w-3 h-3" />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
