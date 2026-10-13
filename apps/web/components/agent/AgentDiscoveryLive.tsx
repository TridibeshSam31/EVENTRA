"use client";

import React, { useMemo } from "react";
import { AlertCircle, Bot, CheckCircle2, Loader2, SearchX } from "lucide-react";
import { useAgentRunStore } from "@/stores/agentRunStore";
import {
  deriveRunView,
  type DiscoveryStatus,
  type ProviderCandidate,
  type ProviderProgress,
  type VenueProgress,
} from "@/lib/agentRun/view";

const NOT_AVAILABLE = <span className="text-slate-400 italic">Not available</span>;

function titleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusLine({ status, searching, empty, failed, error }: {
  status: DiscoveryStatus;
  searching: string;
  empty: string;
  failed: string;
  error?: string;
}) {
  if (status === "searching") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-blue-700">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> {searching}
      </p>
    );
  }
  if (status === "empty") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-slate-600">
        <SearchX className="w-3.5 h-3.5" aria-hidden="true" /> {empty}
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p role="alert" className="flex items-center gap-2 text-xs text-rose-700">
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> {failed}
        {error ? <span className="text-rose-500">({error})</span> : null}
      </p>
    );
  }
  return null;
}

function VenueResults({ venue }: { venue: VenueProgress }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">
        Query: venues in <strong>{venue.location ?? "unknown location"}</strong> with capacity ≥{" "}
        <strong>{venue.minCapacity ?? "?"}</strong> ({venue.guestCount ?? "?"} guests) · Source:{" "}
        {venue.source ? titleCase(venue.source) : "Unknown"}
      </p>
      <StatusLine
        status={venue.status}
        searching="Agent is searching venues…"
        empty="No suitable venues were found for this query."
        failed="Venue discovery did not finish."
        error={venue.error}
      />
      {venue.capacityFilterRelaxed && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md p-2">
          No venue met the capacity requirement, so these results ignore capacity. Check capacity before selecting.
        </p>
      )}
      {venue.candidates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-1.5 pr-3 font-semibold">#</th>
                <th className="py-1.5 pr-3 font-semibold">Venue</th>
                <th className="py-1.5 pr-3 font-semibold">Capacity</th>
                <th className="py-1.5 pr-3 font-semibold">Hourly rate</th>
                <th className="py-1.5 pr-3 font-semibold">Phone on file</th>
                <th className="py-1.5 pr-3 font-semibold">Score</th>
                <th className="py-1.5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {venue.candidates.map((c) => (
                <tr key={c.shortlist_entry_id ?? c.name} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 text-slate-400">{c.rank ?? "–"}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="block text-[11px] text-slate-500">{c.address || c.city || NOT_AVAILABLE}</span>
                  </td>
                  <td className="py-1.5 pr-3">{c.capacity ?? NOT_AVAILABLE}</td>
                  <td className="py-1.5 pr-3">{c.hourly_rate != null ? c.hourly_rate.toLocaleString() : NOT_AVAILABLE}</td>
                  <td className="py-1.5 pr-3">{c.has_contact_phone ? "Yes" : NOT_AVAILABLE}</td>
                  <td className="py-1.5 pr-3">{c.score ?? NOT_AVAILABLE}</td>
                  <td className="py-1.5 text-slate-500">{c.source ? titleCase(c.source) : NOT_AVAILABLE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const QUALIFICATION_BADGE: Record<string, { label: string; tone: string }> = {
  qualified: { label: "Qualified", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pending_verification: { label: "Pending verification", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

function QualificationBadge({ candidate }: { candidate: ProviderCandidate }) {
  if (candidate.from_cache) {
    return (
      <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-50 text-slate-600 border-slate-200">
        Previously discovered · not re-verified
      </span>
    );
  }
  const badge = candidate.qualification ? QUALIFICATION_BADGE[candidate.qualification] : undefined;
  if (!badge) {
    return <span className="px-1.5 py-0.5 rounded border text-[10px] text-slate-500 border-slate-200">Unverified</span>;
  }
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${badge.tone}`}>{badge.label}</span>;
}

function ProviderSection({ progress }: { progress: ProviderProgress }) {
  const recentMilestones = progress.milestones.slice(-4);
  const counts = progress.counts;
  const categoryLabel = titleCase(progress.category);
  return (
    <div className="space-y-2 border border-slate-100 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{categoryLabel}</p>
        {progress.status === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Done" />}
      </div>
      <StatusLine
        status={progress.status}
        searching={`Agent is discovering ${categoryLabel.toLowerCase()} providers in ${progress.location ?? "the event city"}…`}
        empty={`No suitable ${categoryLabel.toLowerCase()} providers were found.`}
        failed={`${categoryLabel} discovery did not finish.`}
        error={progress.error}
      />
      {recentMilestones.length > 0 && (
        <ol className="text-[11px] text-slate-600 space-y-0.5" aria-label={`${categoryLabel} discovery milestones`}>
          {recentMilestones.map((m) => (
            <li key={m.sequence}>
              <span className="text-slate-400">Iteration {m.iteration}:</span> {m.message}
            </li>
          ))}
        </ol>
      )}
      {counts && (
        <dl className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-[11px]">
          {[
            ["Discovered", counts.discovered],
            ["Unique", counts.unique],
            ["Qualified", counts.qualified],
            ["Pending verification", counts.pending_verification],
            ["Rejected", counts.rejected],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md bg-slate-50 border border-slate-100 py-1">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-bold text-slate-800">{value ?? "–"}</dd>
            </div>
          ))}
        </dl>
      )}
      {progress.usedCachedProviders && (
        <p className="text-[11px] text-amber-800">
          Live discovery found no providers; showing previously discovered providers that were not re-verified for this event.
        </p>
      )}
      {progress.candidates.length > 0 && (
        <ul className="divide-y divide-slate-50">
          {progress.candidates.map((c) => (
            <li key={c.shortlist_entry_id ?? c.name} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-semibold text-slate-800">{c.name}</span>
                <span className="block text-[11px] text-slate-500">
                  Rating: {c.rating != null ? c.rating : "not reported"} · Phone: {c.has_contact_phone ? "on file" : "not available"} ·
                  Source: {c.source ? titleCase(c.source) : "unknown"}
                </span>
                {c.qualification_reason && <span className="block text-[11px] text-slate-400">{c.qualification_reason}</span>}
              </div>
              <QualificationBadge candidate={c} />
            </li>
          ))}
        </ul>
      )}
      {progress.status === "completed" && (counts?.rejected ?? 0) > 0 && (
        <p className="text-[11px] text-slate-400">Rejected candidates are counted but not saved as recommendations.</p>
      )}
    </div>
  );
}

/**
 * Live view of the current agent run's discovery work, shown on the Venue and
 * Vendors pages. Renders nothing when the event has no run with this workflow.
 */
export function AgentDiscoveryLive({ eventId, kind }: { eventId: string; kind: "VENUE" | "PROVIDER" }) {
  const storeEventId = useAgentRunStore((s) => s.eventId);
  const run = useAgentRunStore((s) => s.run);
  const events = useAgentRunStore((s) => s.events);
  const view = useMemo(() => (run ? deriveRunView(run, events) : null), [run, events]);

  if (!view || storeEventId !== eventId) return null;
  if (kind === "VENUE" && view.venue.status === "idle") return null;
  if (kind === "PROVIDER" && view.providers.length === 0) return null;

  return (
    <section
      aria-label="Agent discovery progress"
      className="mx-auto max-w-7xl px-4 sm:px-6 pt-4"
    >
      <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-[#D6003C]" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-800">
            Agent run {run?.run_id} · {kind === "VENUE" ? "Venue discovery" : "Provider discovery"}
          </h2>
        </div>
        {kind === "VENUE" ? (
          <VenueResults venue={view.venue} />
        ) : (
          <div className="space-y-3">
            {view.providers.map((p) => (
              <ProviderSection key={p.category} progress={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
