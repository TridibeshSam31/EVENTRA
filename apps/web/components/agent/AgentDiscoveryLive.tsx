"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Phone, SearchX } from "lucide-react";
import { useAgentRunStore } from "@/stores/agentRunStore";
import {
  deriveRunView,
  type DiscoveryStatus,
  type ProviderCandidate,
  type ProviderProgress,
  type VenueProgress,
} from "@/lib/agentRun/view";
import { describeQualificationReason } from "@/components/v2/CandidateEvidenceDrawer";

const NOT_AVAILABLE = <span className="italic text-ink-400">Not available</span>;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 30 };

function titleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Source codes, said plainly. Simulated stays visibly labelled as such. */
function sourceLabel(source?: string | null): string {
  if (!source) return "unknown";
  const s = source.toUpperCase();
  if (s.includes("SIMULATED") || s.includes("DEMO") || s.includes("MOCK")) return "Simulated (demo data)";
  if (s.includes("OSM")) return "OpenStreetMap";
  return titleCase(source);
}

function StatusLine({
  status,
  searching,
  empty,
  failed,
  error,
}: {
  status: DiscoveryStatus;
  searching: string;
  empty: string;
  failed: string;
  error?: string;
}) {
  if (status === "searching") {
    return (
      <p role="status" className="flex items-center gap-2 text-[12.5px] font-medium text-agent-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {searching}
      </p>
    );
  }
  if (status === "empty") {
    return (
      <p role="status" className="flex items-center gap-2 text-[12.5px] text-ink-600">
        <SearchX className="h-3.5 w-3.5" aria-hidden="true" /> {empty}
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p role="alert" className="flex items-center gap-2 text-[12.5px] text-cue-700">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {failed}
        {error ? <span className="text-cue-500">({error})</span> : null}
      </p>
    );
  }
  return null;
}

function StatusDot({ status }: { status: DiscoveryStatus }) {
  const cls =
    status === "searching"
      ? "bg-agent-500 animate-cue-blink"
      : status === "completed"
      ? "bg-go-500"
      : status === "failed"
      ? "bg-cue-600"
      : status === "empty"
      ? "bg-standby-500"
      : "bg-ink-300";
  return <span className={`cue-light ${cls}`} aria-hidden />;
}

/* ── Venue run ─────────────────────────────────────────────── */
function VenueResults({ venue }: { venue: VenueProgress }) {
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed text-ink-600">
        Looking for venues in <strong className="text-ink-900">{venue.location ?? "an unknown location"}</strong> that hold
        at least <strong className="text-ink-900">{venue.minCapacity ?? "?"}</strong> ({venue.guestCount ?? "?"} guests) ·
        Source: {venue.source ? titleCase(venue.source) : "Unknown"}
      </p>
      <StatusLine
        status={venue.status}
        searching="Agent is searching venues…"
        empty="No suitable venues were found for this query."
        failed="Venue discovery did not finish."
        error={venue.error}
      />
      {venue.capacityFilterRelaxed && (
        <p className="rounded-lg border border-standby-200 bg-standby-50 p-2.5 text-[12px] text-standby-800">
          No venue met the capacity requirement, so these results ignore capacity. Check capacity before booking.
        </p>
      )}
      {venue.candidates.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-ink-200">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left font-mono text-[10px] uppercase tracking-label text-ink-500">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Venue</th>
                <th className="px-3 py-2 font-medium">Capacity</th>
                <th className="px-3 py-2 font-medium">Hourly rate</th>
                <th className="px-3 py-2 font-medium">Phone on file</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-ink-200">
              {venue.candidates.map((c, i) => (
                <motion.tr
                  key={c.shortlist_entry_id ?? c.name}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: Math.min(i, 10) * 0.04 }}
                  className="bg-[#FDFCFA]"
                >
                  <td className="px-3 py-2 font-mono text-ink-400">{c.rank ?? "–"}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-ink-900">{c.name}</span>
                    <span className="block text-[11.5px] text-ink-500">{c.address || c.city || NOT_AVAILABLE}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{c.capacity ?? NOT_AVAILABLE}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.hourly_rate != null ? c.hourly_rate.toLocaleString() : NOT_AVAILABLE}
                  </td>
                  <td className="px-3 py-2">{c.has_contact_phone ? "Yes" : NOT_AVAILABLE}</td>
                  <td className="px-3 py-2 tabular-nums">{c.score ?? NOT_AVAILABLE}</td>
                  <td className="px-3 py-2 text-ink-500">{c.source ? titleCase(c.source) : NOT_AVAILABLE}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Provider run ──────────────────────────────────────────── */
const QUALIFICATION_BADGE: Record<string, { label: string; tone: string }> = {
  qualified: { label: "Qualified", tone: "border-go-200 bg-go-50 text-go-700" },
  pending_verification: { label: "Pending verification", tone: "border-standby-200 bg-standby-50 text-standby-800" },
  rejected: { label: "Rejected", tone: "border-cue-200 bg-cue-50 text-cue-700" },
};

function QualificationBadge({ candidate }: { candidate: ProviderCandidate }) {
  if (candidate.from_cache) {
    return <span className="chip border-ink-200 bg-ink-50 text-ink-600">Previously discovered · not re-verified</span>;
  }
  const badge = candidate.qualification ? QUALIFICATION_BADGE[candidate.qualification] : undefined;
  if (!badge) {
    return <span className="chip border-dashed border-ink-300 text-ink-500">Unverified</span>;
  }
  return <span className={`chip ${badge.tone}`}>{badge.label}</span>;
}

function ProviderSection({ progress, defaultOpen }: { progress: ProviderProgress; defaultOpen: boolean }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const [showCandidates, setShowCandidates] = useState(false);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);

  const recentMilestones = progress.milestones.slice(-6);
  const counts = progress.counts;
  const categoryLabel = titleCase(progress.category);
  const lowerLabel = categoryLabel.toLowerCase();

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-[#FDFCFA]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-ink-50"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={progress.status} />
          <span className="text-[14px] font-semibold text-ink-900">{categoryLabel}</span>
          {counts && (
            <span className="truncate font-mono text-[11px] text-ink-500">
              {counts.qualified ?? 0} qualified · {progress.candidates.length} kept
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {progress.status === "completed" && <CheckCircle2 className="h-4 w-4 text-go-600" aria-label="Done" />}
          <ChevronDown className={`h-4 w-4 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {/* Collapsed sections stay in the DOM (hidden) so the record is still searchable. */}
      <div className={open ? "space-y-3 border-t border-ink-200 px-4 pb-4 pt-3" : "hidden"}>
        <StatusLine
          status={progress.status}
          searching={`Agent is discovering ${lowerLabel} providers in ${progress.location ?? "the event city"}…`}
          empty={`No suitable ${lowerLabel} providers were found.`}
          failed={`${categoryLabel} discovery did not finish.`}
          error={progress.error}
        />

        {recentMilestones.length > 0 && (
          <ol
            className="space-y-0.5 rounded-lg bg-ink-950 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-200"
            aria-label={`${categoryLabel} discovery milestones`}
          >
            <AnimatePresence initial={false}>
              {recentMilestones.map((m) => (
                <motion.li
                  key={m.sequence}
                  initial={reduce ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={SPRING}
                  className="grid grid-cols-[52px_1fr] gap-2"
                >
                  <span className="text-ink-500">#{String(m.sequence).padStart(3, "0")}</span>
                  <span>
                    <span className="text-agent-300">✦ it.{m.iteration}</span> {m.message}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}

        {counts && (
          <dl className="grid grid-cols-3 gap-1.5 text-center sm:grid-cols-5">
            {[
              ["Discovered", counts.discovered],
              ["Unique", counts.unique],
              ["Qualified", counts.qualified],
              ["Pending verification", counts.pending_verification],
              ["Rejected", counts.rejected],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-ink-200 bg-ink-50 px-1 py-1.5">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-500">{label}</dt>
                <motion.dd
                  key={String(value)}
                  initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={SPRING}
                  className="font-display text-[18px] font-bold leading-tight tabular-nums text-ink-900"
                >
                  {value ?? "–"}
                </motion.dd>
              </div>
            ))}
          </dl>
        )}

        {progress.usedCachedProviders && (
          <p className="rounded-lg border border-standby-200 bg-standby-50 px-3 py-2 text-[12px] text-standby-800">
            Live discovery found no providers; showing previously discovered providers that were not re-verified for this
            event.
          </p>
        )}

        {progress.candidates.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowCandidates((v) => !v)}
              aria-expanded={showCandidates}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-700 hover:text-ink-900"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCandidates ? "rotate-180" : ""}`} />
              {showCandidates ? "Hide" : "Show"} the {progress.candidates.length} providers this run kept
            </button>
            <ul
              className={
                showCandidates ? "mt-2 divide-y divide-dashed divide-ink-200 rounded-lg border border-ink-200" : "hidden"
              }
            >
              {progress.candidates.map((c, i) => (
                <motion.li
                  key={c.shortlist_entry_id ?? c.name}
                  initial={reduce || !showCandidates ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: Math.min(i, 10) * 0.035 }}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-ink-900">{c.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-500">
                      <span>Rating: {c.rating != null ? c.rating : "not reported"}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> Phone: {c.has_contact_phone ? "on file" : "not available"}
                      </span>
                      <span aria-hidden>·</span>
                      <span>Source: {sourceLabel(c.source)}</span>
                    </span>
                    {c.qualification_reason && (
                      <span className="block text-[11.5px] text-ink-400">
                        {describeQualificationReason(c.qualification_reason)}
                      </span>
                    )}
                  </div>
                  <QualificationBadge candidate={c} />
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        {progress.status === "completed" && (counts?.rejected ?? 0) > 0 && (
          <p className="text-[11.5px] text-ink-400">Rejected candidates are counted but not saved as recommendations.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Live view of the current agent run's discovery work. Rendered inside the
 * discovery page (not as a separate block) so the run, the funnel and the
 * candidate list read as one experience. Renders nothing when the event has no
 * run with this workflow.
 */
export function AgentDiscoveryLive({
  eventId,
  kind,
  activeCategory,
  embedded = false,
}: {
  eventId: string;
  kind: "VENUE" | "PROVIDER";
  /** opens the section for the category tab the user is looking at */
  activeCategory?: string;
  /** when rendered inside DiscoveryCommand: no page-level padding */
  embedded?: boolean;
}) {
  const storeEventId = useAgentRunStore((s) => s.eventId);
  const run = useAgentRunStore((s) => s.run);
  const events = useAgentRunStore((s) => s.events);
  const view = useMemo(() => (run ? deriveRunView(run, events) : null), [run, events]);

  if (!view || storeEventId !== eventId) return null;
  if (kind === "VENUE" && view.venue.status === "idle") return null;
  if (kind === "PROVIDER" && view.providers.length === 0) return null;

  const anySearching =
    kind === "VENUE" ? view.venue.status === "searching" : view.providers.some((p) => p.status === "searching");
  const active = (activeCategory || "").toUpperCase();
  const hasActiveMatch = view.providers.some((p) => p.category.toUpperCase() === active);

  return (
    <section aria-label="Agent discovery progress" className={embedded ? "" : "mx-auto max-w-7xl px-4 pt-4 sm:px-6"}>
      <div className="surface overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-[15px] leading-none text-agent-500" aria-hidden>
              ✦
            </span>
            <h2 className="text-[14px] font-semibold text-ink-900">
              Agent run · {kind === "VENUE" ? "Venue discovery" : "Provider discovery"}
            </h2>
            <span className="truncate font-mono text-[11px] text-ink-400">{run?.run_id}</span>
          </div>
          <span
            className={`chip ${
              anySearching ? "border-agent-200 bg-agent-50 text-agent-700" : "border-ink-200 bg-ink-50 text-ink-600"
            }`}
          >
            <span className={`cue-light ${anySearching ? "bg-agent-500 animate-cue-blink" : "bg-ink-400"}`} />
            {anySearching ? "Working…" : "Run finished"}
          </span>
        </header>
        <div className="p-4">
          {kind === "VENUE" ? (
            <VenueResults venue={view.venue} />
          ) : (
            <div className="space-y-2.5">
              {view.providers.map((p, i) => (
                <ProviderSection
                  key={p.category}
                  progress={p}
                  defaultOpen={hasActiveMatch ? p.category.toUpperCase() === active : i === 0}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
