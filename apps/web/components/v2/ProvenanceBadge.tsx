"use client";

import React from "react";
import { ShieldCheck, Database, Radio, MapPin, AlertCircle, Mic, Sparkles, SlidersHorizontal } from "lucide-react";

export type ProvenanceType =
  | "AGENT"
  | "ENGINE"
  | "SOURCE"
  | "HUMAN"
  | "EXECUTED"
  | "UNKNOWN"
  | "LIVE_SCRAPE"
  | "CACHED_DB"
  | "OSM_FALLBACK"
  | "VERIFIED_OUTREACH"
  | "SIMULATED"
  | "DEMO_FALLBACK"
  | "STATED"
  | "INFERRED"
  | "DEFAULT"
  | string;

interface ProvenanceBadgeProps {
  source?: ProvenanceType;
  provenance?: ProvenanceType;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ProvenanceBadge({
  source,
  provenance,
  size = "md",
  showLabel = true,
  className = "",
}: ProvenanceBadgeProps) {
  const normSource = (provenance || source || "UNKNOWN").toUpperCase();

  let config = {
    label: "Live Scrape",
    detail: "Fetched via live Google Maps scraper",
    icon: Radio,
    bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  };

  if (normSource === "STATED") {
    config = {
      label: "Stated",
      detail: "Directly spoken by organizer",
      icon: Mic,
      bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
    };
  } else if (normSource === "INFERRED") {
    config = {
      label: "Inferred",
      detail: "Inferred by AI from context",
      icon: Sparkles,
      bg: "bg-violet-50 text-violet-700 border-violet-200",
      dot: "bg-violet-500",
    };
  } else if (normSource === "DEFAULT") {
    config = {
      label: "Default",
      detail: "Standard platform default",
      icon: SlidersHorizontal,
      bg: "bg-slate-100 text-slate-700 border-slate-200",
      dot: "bg-slate-400",
    };
  } else if (normSource === "AGENT" || normSource.includes("AGENT")) {
    config = {
      label: "Agent",
      detail: "Autonomous agent execution record",
      icon: ShieldCheck,
      bg: "bg-blue-50 text-blue-700 border-blue-200",
      dot: "bg-blue-500",
    };
  } else if (normSource === "ENGINE" || normSource.includes("ENGINE")) {
    config = {
      label: "Engine",
      detail: "Deterministic calculation / verification engine",
      icon: Database,
      bg: "bg-indigo-50 text-indigo-700 border-indigo-200",
      dot: "bg-indigo-500",
    };
  } else if (normSource === "SOURCE" || normSource.includes("SOURCE")) {
    config = {
      label: "Source",
      detail: "Origin intake specification or external data source",
      icon: Database,
      bg: "bg-cyan-50 text-cyan-700 border-cyan-200",
      dot: "bg-cyan-500",
    };
  } else if (normSource === "HUMAN" || normSource.includes("HUMAN") || normSource.includes("OPERATOR") || normSource.includes("ORGANIZER")) {
    config = {
      label: "Human",
      detail: "Human operator action or authorization",
      icon: ShieldCheck,
      bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
    };
  } else if (normSource === "EXECUTED" || normSource.includes("EXECUTED")) {
    config = {
      label: "Executed",
      detail: "Executed operational action confirmed by backend",
      icon: ShieldCheck,
      bg: "bg-teal-50 text-teal-700 border-teal-200",
      dot: "bg-teal-500",
    };
  } else if (normSource === "UNKNOWN" || normSource.includes("UNKNOWN")) {
    config = {
      label: "Unknown",
      detail: "Provenance not provided by backend record",
      icon: AlertCircle,
      bg: "bg-slate-100 text-slate-600 border-slate-200",
      dot: "bg-slate-400",
    };
  } else if (normSource.includes("VERIFIED") || normSource.includes("OUTREACH")) {
    config = {
      label: "Verified Outreach",
      detail: "Directly confirmed via WhatsApp / Voice Call",
      icon: ShieldCheck,
      bg: "bg-purple-50 text-purple-700 border-purple-200",
      dot: "bg-purple-500",
    };
  } else if (normSource.includes("CACHE") || normSource.includes("DB")) {
    config = {
      label: "Cached DB",
      detail: "Verified provider from local directory within search radius",
      icon: Database,
      bg: "bg-blue-50 text-blue-700 border-blue-200",
      dot: "bg-blue-500",
    };
  } else if (normSource.includes("OSM") || normSource.includes("OPENSTREETMAP")) {
    config = {
      label: "OSM Network",
      detail: "Discovered via OpenStreetMap live geospatial radar",
      icon: MapPin,
      bg: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
    };
  } else if (normSource.includes("SIMULATED") || normSource.includes("DEMO") || normSource.includes("MOCK")) {
    config = {
      label: "Simulated",
      detail: "Synthetic sandbox fixture for fallback demonstration",
      icon: AlertCircle,
      bg: "bg-slate-100 text-slate-600 border-slate-200",
      dot: "bg-slate-400",
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
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      <Icon className="w-3 h-3" />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
