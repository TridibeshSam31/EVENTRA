"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, Pencil } from "lucide-react";
import type { EventResponse, EventSummary } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { EmptyState } from "@/components/ds";
import { humanizeCode } from "@/lib/humanize";
import { isMidnight } from "./planningFormat";

interface EventBlueprintProps {
  event: EventResponse | null;
  summary?: EventSummary | null;
  className?: string;
}

/** Date always; clock time only when it's a real time (not a date-only midnight). */
function fmtWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: isMidnight(iso) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

/** The event spec as a compact production spec sheet. */
export function EventBlueprint({ event, summary, className = "" }: EventBlueprintProps) {
  if (!event && !summary) {
    return (
      <EmptyState
        className={className}
        icon={<FileText className="h-5 w-5" />}
        title="Event details not available"
        description="The event specification could not be loaded from the server."
      />
    );
  }

  const name = event?.name || summary?.event_name || "Untitled event";
  const type = event?.event_type || summary?.event_type || null;
  const location = event?.location || summary?.location || null;
  const startDatetime = event?.start_datetime || summary?.start_datetime || null;
  const endDatetime = event?.end_datetime || summary?.end_datetime || null;
  const guestCount = event?.guest_count ?? summary?.guest_count ?? null;
  const totalBudget = event?.total_budget ?? summary?.total_budget ?? null;
  const currency = event?.currency || summary?.currency || "INR";
  const currSym = currency === "INR" ? "₹" : `${currency} `;
  const state = event?.lifecycle_state || event?.state || summary?.lifecycle_state || null;
  const description = event?.description || null;
  const start = fmtWhen(startDatetime);
  const end = fmtWhen(endDatetime);
  const eventId = event?.id || summary?.event_id || null;

  const specs: Array<{ label: string; value: string; missing?: boolean }> = [
    { label: "Type", value: type ? humanizeCode(type) : "Not set", missing: !type },
    {
      label: "Guests",
      value: guestCount != null ? Number(guestCount).toLocaleString() : "Not set",
      missing: guestCount == null,
    },
    {
      label: "Budget",
      value: totalBudget != null ? `${currSym}${Number(totalBudget).toLocaleString()}` : "Not set",
      missing: totalBudget == null,
    },
    { label: "Location", value: location || "Not set", missing: !location },
  ];

  const whenRows = [
    { label: "Starts", v: start },
    { label: "Ends", v: end },
  ];

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="eyebrow">The brief</span>
            <ProvenanceBadge provenance="SOURCE" size="sm" />
            {state && (
              <span className="chip border-ink-200 bg-ink-50 text-ink-700">
                <span className="cue-light bg-go-500" />
                {humanizeCode(state)}
              </span>
            )}
          </div>
          <h3
            className="font-display text-[20px] font-bold leading-tight tracking-[-0.02em] text-ink-900"
            style={{ fontStretch: "90%" }}
          >
            {name}
          </h3>
          {description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-600">{description}</p>}
        </div>
        {eventId && (
          <Link
            href={`/events/${eventId}/setup`}
            className="btn-ghost h-8 shrink-0 px-2.5 text-[12px]"
            title="Edit event details"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-px bg-ink-200">
        {specs.map((s) => (
          <div key={s.label} className="min-w-0 bg-[#FDFCFA] px-5 py-3">
            <dt className="eyebrow">{s.label}</dt>
            <dd
              className={`mt-1 truncate text-[14px] font-semibold ${s.missing ? "text-standby-700" : "text-ink-900"}`}
              title={s.value}
            >
              {s.value}
            </dd>
          </div>
        ))}
        {whenRows.map((row) => (
          <div key={row.label} className="min-w-0 bg-[#FDFCFA] px-5 py-3">
            <dt className="eyebrow">{row.label}</dt>
            {row.v ? (
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-[14px] font-semibold text-ink-900">{row.v.date}</span>
                {row.v.time && <span className="timecode text-[13px] text-ink-500">{row.v.time}</span>}
              </dd>
            ) : (
              <dd className="mt-1 text-[14px] font-semibold text-standby-700">Not scheduled</dd>
            )}
          </div>
        ))}
      </dl>

      {eventId && (
        <div className="border-t border-ink-200 px-5 py-3">
          <Link
            href={`/events/${eventId}/venue`}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-700 hover:text-cue-700"
          >
            Venue selection <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
