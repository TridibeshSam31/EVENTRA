"use client";

import React from "react";

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

type Config = {
  label: string;
  detail: string;
  glyph: string;
  cls: string;
};

/*
 * Provenance is EVENTRA's core trust signal. Each origin has one glyph and one
 * colour family, used identically everywhere:
 *   ✦ agent   — AI proposal / interpretation        (agent / iris)
 *   ✓ engine  — deterministic calculation/verify    (engine / teal)
 *   ◎ source  — external data (maps, scrape, DB)    (info / cobalt)
 *   ● human   — organizer statement / authorization (ink)
 *   ▲ executed— action confirmed by backend         (go / green)
 *   ? unknown — not provided / simulated            (ink, dashed)
 */
const STYLES = {
  agent: "border-agent-200 bg-agent-50 text-agent-700",
  engine: "border-engine-200 bg-engine-50 text-engine-700",
  source: "border-info-200 bg-info-50 text-info-700",
  human: "border-ink-300 bg-ink-100 text-ink-800",
  executed: "border-go-200 bg-go-50 text-go-700",
  unknown: "border-dashed border-ink-300 bg-transparent text-ink-500",
  standby: "border-standby-200 bg-standby-50 text-standby-800",
};

function resolve(normSource: string): Config {
  if (normSource === "STATED")
    return { label: "Stated", detail: "Directly stated by the organizer", glyph: "●", cls: STYLES.human };
  if (normSource === "INFERRED")
    return { label: "Inferred", detail: "Inferred by the agent from context", glyph: "✦", cls: STYLES.agent };
  if (normSource === "DEFAULT")
    return { label: "Default", detail: "Standard platform default", glyph: "○", cls: STYLES.unknown };
  if (normSource.includes("AGENT"))
    return { label: "Agent", detail: "Proposed or carried out by the EVENTRA agent", glyph: "✦", cls: STYLES.agent };
  if (normSource.includes("ENGINE"))
    return { label: "Engine", detail: "Deterministic calculation / verification engine", glyph: "✓", cls: STYLES.engine };
  if (normSource.includes("SOURCE"))
    return { label: "Source", detail: "From the intake specification or an external data source", glyph: "◎", cls: STYLES.source };
  if (normSource.includes("HUMAN") || normSource.includes("OPERATOR") || normSource.includes("ORGANIZER"))
    return { label: "Human", detail: "Human operator action or authorization", glyph: "●", cls: STYLES.human };
  if (normSource.includes("EXECUTED"))
    return { label: "Executed", detail: "Action confirmed by the backend", glyph: "▲", cls: STYLES.executed };
  if (normSource.includes("UNKNOWN"))
    return { label: "Unknown", detail: "Provenance not provided by the backend record", glyph: "?", cls: STYLES.unknown };
  if (normSource.includes("VERIFIED") || normSource.includes("OUTREACH"))
    return { label: "Verified outreach", detail: "Confirmed directly via WhatsApp / voice call", glyph: "✓", cls: STYLES.executed };
  if (normSource.includes("CACHE") || normSource.includes("DB"))
    return { label: "Directory", detail: "Known provider from the local directory within the search radius", glyph: "◎", cls: STYLES.source };
  if (normSource.includes("OSM") || normSource.includes("OPENSTREETMAP"))
    return { label: "OpenStreetMap", detail: "Discovered via OpenStreetMap", glyph: "◎", cls: STYLES.standby };
  if (normSource.includes("SIMULATED") || normSource.includes("DEMO") || normSource.includes("MOCK"))
    return { label: "Simulated", detail: "Synthetic sandbox data used for demonstration", glyph: "?", cls: STYLES.unknown };
  return { label: "Live scrape", detail: "Fetched live from Google Maps", glyph: "◎", cls: STYLES.source };
}

export function ProvenanceBadge({ source, provenance, size = "md", showLabel = true, className = "" }: ProvenanceBadgeProps) {
  const normSource = (provenance || source || "UNKNOWN").toUpperCase();
  const config = resolve(normSource);

  const sizeClasses =
    size === "sm"
      ? "text-[10px] px-1.5 py-px gap-1"
      : size === "lg"
      ? "text-[12px] px-2.5 py-1 gap-1.5"
      : "text-[11px] px-2 py-0.5 gap-1";

  return (
    <span
      title={config.detail}
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold leading-4 ${config.cls} ${sizeClasses} ${className}`}
    >
      <span aria-hidden className="text-[0.95em] leading-none">
        {config.glyph}
      </span>
      {showLabel ? <span>{config.label}</span> : <span className="sr-only">{config.label}</span>}
    </span>
  );
}
