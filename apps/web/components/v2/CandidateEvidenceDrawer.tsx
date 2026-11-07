"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, CalendarCheck2 } from "lucide-react";
import {
  X,
  MapPin,
  Phone,
  Mail,
  Globe,
  Star,
  ExternalLink,
  Users,
  IndianRupee,
  Navigation,
  MessageSquareText,
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
  qualification_reason?: string | null;
  matching_reasons?: string[];
  tier?: "top_matches" | "other_available_options" | "backup_waitlist" | "rejected" | string;
  is_shortlisted?: boolean;
  is_assigned?: boolean;
  is_manual_override?: boolean;
  raw?: any;
}

interface CandidateEvidenceDrawerProps {
  candidate: CandidateEvidenceData | null;
  onClose: () => void;
  onToggleShortlist?: (candidate: CandidateEvidenceData) => void;
  onSelectPrimary?: (candidate: CandidateEvidenceData) => void;
  isShortlisted?: boolean;
  isSelecting?: boolean;
  /** a booking request for this candidate was already sent (shows status instead of the button) */
  isRequested?: boolean;
  /** where "Booking requested" links to */
  approvalsHref?: string;
}

/**
 * The qualification engine phrases presence checks as "Verified …". Having a
 * phone number or a web link is not verification, so we say what it actually is.
 * A Google search URL is only a search link, never "web presence".
 */
export function describeQualificationReason(reason?: string | null): string {
  if (!reason) return "";
  const text = reason.trim();
  const phone = text.match(/^Verified contact phone:\s*(.+)$/i);
  if (phone) return `Phone listed: ${phone[1]}`;
  const web = text.match(/^Verified web presence:\s*(\S+)/i);
  if (web) {
    return isSearchLink(web[1]) ? "Search link only — no website on record" : `Website listed: ${web[1]}`;
  }
  if (/^Verified Google Maps listing$/i.test(text)) return "Google Maps listing on record";
  return text;
}

/** True when a URL is just a Google search, not the vendor's own site. */
export function isSearchLink(url?: string | null): boolean {
  return !!url && /google\.[a-z.]+\/search/i.test(url);
}

export const EXCLUSION_FALLBACK = "The engine did not give a reason";

export function humanizeCategory(cat?: string | null) {
  if (!cat) return "Uncategorized";
  const map: Record<string, string> = {
    AV_TECH: "AV & tech",
    DECOR: "Décor",
    VENUE: "Venue",
  };
  const up = cat.toUpperCase();
  if (map[up]) return map[up];
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One evidence fact: label, value, and whether it is known. Unknowns are never guessed. */
function Fact({
  icon,
  label,
  value,
  known,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  known: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 text-ink-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-ink-500">{label}</div>
        <div
          className={`truncate text-[13.5px] ${
            known ? `font-semibold text-ink-900 ${mono ? "font-mono text-[12.5px]" : ""}` : "italic text-ink-400"
          }`}
        >
          {known ? value : "Not provided by source"}
        </div>
      </div>
      <span
        className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
          known ? "bg-go-50 text-go-600 ring-1 ring-go-200" : "border border-dashed border-ink-300 bg-ink-100 text-ink-400"
        }`}
        title={known ? "Present in source data" : "Unknown — not verified"}
      >
        {known ? "✓" : "?"}
      </span>
    </div>
  );
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="eyebrow">{children}</h4>
      {right}
    </div>
  );
}

export function CandidateEvidenceDrawer({
  candidate,
  onClose,
  onToggleShortlist,
  onSelectPrimary,
  isShortlisted = false,
  isSelecting = false,
  isRequested = false,
  approvalsHref,
}: CandidateEvidenceDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!candidate) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [candidate, onClose]);

  if (!candidate) return null;

  const isRejected = candidate.qualification_status === "rejected";
  const isUncertain = candidate.qualification_status === "uncertain";
  const score = candidate.score != null ? Math.round(candidate.score) : null;
  const breakdown = candidate.score_breakdown ? Object.entries(candidate.score_breakdown) : [];
  const reasons = (candidate.matching_reasons || []).filter(Boolean);
  const extras = [...(candidate.amenities || []), ...(candidate.capabilities || [])];

  const verdict = isRejected
    ? { label: "Disqualified by engine", cls: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600" }
    : isUncertain
    ? { label: "Uncertain match", cls: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500" }
    : { label: "Qualified fit", cls: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden" role="dialog" aria-modal="true" aria-label={`Evidence for ${candidate.name}`}>
      <div
        className="fixed inset-0 bg-ink-950/45 backdrop-blur-[2px] animate-[workspace-fade-in_200ms_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-50 flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-paper shadow-2xl outline-none animate-rise-in sm:rounded-l-2xl"
      >
        {/* Header — ink band with the verdict and score */}
        <div className="relative overflow-hidden bg-ink-950 px-6 pb-5 pt-5 text-ink-50">
          <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip border-white/10 bg-white/5 text-ink-200">{humanizeCategory(candidate.category)}</span>
              <ProvenanceBadge source={candidate.provenance} size="sm" />
            </div>
            <button
              onClick={onClose}
              className="-mr-2 -mt-1 rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h3
            className="relative mt-3 font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white"
            style={{ fontStretch: "88%" }}
          >
            {candidate.name}
          </h3>
          <p className="relative mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{candidate.address || candidate.city || "Location unknown"}</span>
          </p>

          <div className="relative mt-5 flex items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-label text-ink-500">Match score</div>
              <div className="mt-1 flex items-baseline gap-1 font-display tabular-nums" style={{ fontStretch: "85%" }}>
                <span className={`text-[44px] font-extrabold leading-none ${score == null ? "text-ink-600" : "text-white"}`}>
                  {score ?? "—"}
                </span>
                <span className="text-[16px] font-bold text-ink-500">/100</span>
              </div>
            </div>
            <span className={`chip ${verdict.cls}`}>
              <span className={`cue-light ${verdict.dot}`} />
              {verdict.label}
            </span>
          </div>
          {score != null && (
            <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div
                className={`h-full rounded-full ${isRejected ? "bg-cue-500" : "bg-go-400"}`}
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {isRejected && (
            <div className="rounded-xl border border-cue-200 bg-cue-50 p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-cue-800">
                <ProvenanceBadge provenance="ENGINE" size="sm" />
                Why it was excluded
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-cue-900">
                {describeQualificationReason(candidate.qualification_reason || candidate.matching_reasons?.[0]) || EXCLUSION_FALLBACK}
              </p>
              <p className="mt-2 text-[11.5px] text-cue-700/80">
                Filtered out during automated qualification. Saving it anyway needs an explicit manual override.
              </p>
            </div>
          )}

          {/* Why it matches */}
          {!isRejected && (reasons.length > 0 || candidate.qualification_reason) && (
            <section>
              <SectionLabel right={<ProvenanceBadge provenance="ENGINE" size="sm" />}>Why it matches</SectionLabel>
              <ul className="space-y-1.5">
                {candidate.qualification_reason && (
                  <li className="flex items-start gap-2 text-[13px] text-ink-800">
                    <span className="mt-0.5 font-bold text-engine-600">✓</span>
                    {describeQualificationReason(candidate.qualification_reason)}
                  </li>
                )}
                {reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-ink-800">
                    <span className="mt-0.5 font-bold text-engine-600">✓</span>
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Component reasoning */}
          <section>
            <SectionLabel>Score components</SectionLabel>
            {breakdown.length > 0 ? (
              <div className="surface divide-y divide-dashed divide-ink-200 px-4">
                {breakdown.map(([k, v]) => {
                  const num = typeof v === "number" ? v : Number(v);
                  const isNum = !Number.isNaN(num);
                  const pct = isNum ? (num <= 1 ? num * 100 : num) : 0;
                  return (
                    <div key={k} className="py-2.5">
                      <div className="flex items-center justify-between text-[12.5px]">
                        <span className="capitalize text-ink-600">{k.replace(/_/g, " ")}</span>
                        <span className="font-mono font-semibold tabular-nums text-ink-900">{String(v)}</span>
                      </div>
                      {isNum && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-200/70">
                          <div className="h-full rounded-full bg-engine-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-ink-300 px-3 py-2.5 text-[12.5px] italic text-ink-500">
                {score == null
                  ? "The engine did not return a score for this candidate."
                  : "No component breakdown was returned for this score."}
              </p>
            )}
          </section>

          {/* Facts */}
          <section>
            <SectionLabel>Facts on record</SectionLabel>
            <div className="surface divide-y divide-dashed divide-ink-200 px-4">
              <Fact
                icon={<Users className="h-4 w-4" />}
                label="Capacity"
                known={candidate.capacity != null}
                value={`${candidate.capacity?.toLocaleString()} guests`}
              />
              <Fact
                icon={<IndianRupee className="h-4 w-4" />}
                label="Rate"
                known={candidate.hourly_rate != null}
                value={`₹${candidate.hourly_rate?.toLocaleString()} / hr`}
              />
              <Fact
                icon={<Navigation className="h-4 w-4" />}
                label="Distance from event"
                known={candidate.distance_km != null}
                value={`${candidate.distance_km?.toFixed(1)} km`}
              />
              <Fact
                icon={<Star className="h-4 w-4" />}
                label="Public rating"
                known={candidate.rating != null}
                value={
                  <>
                    {candidate.rating?.toFixed(1)} ★
                    {candidate.review_count != null && (
                      <span className="font-normal text-ink-500"> · {candidate.review_count.toLocaleString()} reviews</span>
                    )}
                  </>
                }
              />
            </div>
          </section>

          {/* Contact */}
          <section>
            <SectionLabel>Contact</SectionLabel>
            <div className="surface divide-y divide-dashed divide-ink-200 px-4">
              <Fact icon={<Phone className="h-4 w-4" />} label="Phone" known={!!candidate.phone} value={candidate.phone} mono />
              <Fact icon={<Mail className="h-4 w-4" />} label="Email" known={!!candidate.email} value={candidate.email} mono />
            </div>
            {(candidate.website || candidate.maps_url) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {candidate.website && (
                  <a
                    href={candidate.website}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary h-8 text-[12px]"
                    title={isSearchLink(candidate.website) ? "A Google search for this name — not the vendor's own website" : undefined}
                  >
                    <Globe className="h-3.5 w-3.5" /> {isSearchLink(candidate.website) ? "Search link" : "Website"}{" "}
                    <ExternalLink className="h-3 w-3 text-ink-400" />
                  </a>
                )}
                {candidate.maps_url && (
                  <a href={candidate.maps_url} target="_blank" rel="noreferrer" className="btn-secondary h-8 text-[12px]">
                    <MapPin className="h-3.5 w-3.5" /> Google Maps <ExternalLink className="h-3 w-3 text-ink-400" />
                  </a>
                )}
              </div>
            )}
            {!candidate.phone && !candidate.email && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-standby-800">
                <MessageSquareText className="h-3.5 w-3.5" />
                No contact channel yet — outreach can&apos;t start until one is found.
              </p>
            )}
          </section>

          {extras.length > 0 && (
            <section>
              <SectionLabel>Listed amenities & capabilities</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {extras.map((am, i) => (
                  <span key={i} className="chip border-ink-200 bg-[#FDFCFA] font-medium text-ink-700">
                    {am}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Source */}
          <section>
            <SectionLabel>Source</SectionLabel>
            <div className="surface-sunk space-y-1.5 px-4 py-3 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Origin</span>
                <ProvenanceBadge source={candidate.provenance} size="sm" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Record ID</span>
                <span className="truncate font-mono text-[11.5px] text-ink-700">{candidate.id}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Coordinates</span>
                {candidate.latitude != null && candidate.longitude != null ? (
                  <span className="font-mono text-[11.5px] text-ink-700">
                    {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
                  </span>
                ) : (
                  <span className="italic text-standby-700">Missing — not shown on map</span>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Footer actions — the journey: Save → Request booking */}
        <div className="border-t border-ink-200 bg-[#FDFCFA] px-6 py-4">
          <div className="flex items-center gap-2.5">
            {onToggleShortlist && (
              <button
                onClick={() => onToggleShortlist(candidate)}
                aria-pressed={isShortlisted}
                className={`flex-1 ${
                  isRejected
                    ? isShortlisted
                      ? "btn bg-standby-600 text-white hover:bg-standby-700"
                      : "btn border border-cue-300 bg-cue-50 text-cue-800 hover:bg-cue-100"
                    : isShortlisted
                    ? "btn-secondary"
                    : "btn-primary"
                }`}
              >
                {isShortlisted ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {isRejected ? (isShortlisted ? "Saved (override)" : "Save anyway (override)") : isShortlisted ? "Saved" : "Save"}
              </button>
            )}

            {onSelectPrimary &&
              (candidate.is_assigned || isRequested ? (
                approvalsHref && candidate.entity_type !== "VENUE" ? (
                  <Link href={approvalsHref} className="btn flex-1 border border-go-200 bg-go-50 text-go-800 hover:bg-go-100">
                    <CalendarCheck2 className="h-4 w-4" /> Booking requested · view
                  </Link>
                ) : (
                  <span className="btn flex-1 cursor-default border border-go-200 bg-go-50 text-go-800">
                    <CalendarCheck2 className="h-4 w-4" />
                    {candidate.entity_type === "VENUE" ? "Venue booked" : "Booking requested"}
                  </span>
                )
              ) : (
                <button
                  onClick={() => onSelectPrimary(candidate)}
                  disabled={isSelecting}
                  className={`flex-1 ${isShortlisted && !isRejected ? "btn-primary" : "btn-secondary"}`}
                  title={
                    candidate.entity_type === "VENUE"
                      ? "Locks this venue to the event right away."
                      : "Sends a booking proposal to Approvals. Nothing is booked until it's approved."
                  }
                >
                  <CalendarCheck2 className="h-4 w-4" />
                  {isSelecting ? "Sending…" : candidate.entity_type === "VENUE" ? "Book this venue" : "Request booking"}
                </button>
              ))}
          </div>
          {onSelectPrimary && !candidate.is_assigned && !isRequested && (
            <p className="mt-2 text-center text-[11.5px] text-ink-500">
              {candidate.entity_type === "VENUE"
                ? "Booking a venue locks it to this event."
                : "Request booking sends a proposal to Approvals — nothing is booked until it's approved."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
