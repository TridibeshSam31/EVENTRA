"use client";

import React from "react";
import Link from "next/link";
import {
  FileText,
  Calendar,
  Clock,
  MapPin,
  Users,
  DollarSign,
  Layers,
  ShieldCheck,
  Tag,
  AlertCircle,
  Building2,
  ExternalLink,
} from "lucide-react";
import type { EventResponse, EventSummary } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface EventBlueprintProps {
  event: EventResponse | null;
  summary?: EventSummary | null;
  className?: string;
}

export function EventBlueprint({
  event,
  summary,
  className = "",
}: EventBlueprintProps) {
  if (!event && !summary) {
    return (
      <div className={`p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500 ${className}`}>
        <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700">Event Blueprint Not Available</p>
        <p className="text-xs text-slate-400 mt-1">Authoritative event specification could not be retrieved from backend.</p>
      </div>
    );
  }

  const name = event?.name || summary?.event_name || "UNKNOWN";
  const type = event?.event_type || summary?.event_type || "UNKNOWN";
  const location = event?.location || summary?.location || null;
  const startDatetime = event?.start_datetime || summary?.start_datetime || null;
  const endDatetime = event?.end_datetime || summary?.end_datetime || null;
  const guestCount = event?.guest_count ?? summary?.guest_count ?? null;
  const totalBudget = event?.total_budget ?? summary?.total_budget ?? null;
  const currency = event?.currency || summary?.currency || "INR";
  const currSym = currency === "INR" ? "₹" : `${currency} `;
  const state = event?.lifecycle_state || event?.state || summary?.lifecycle_state || "UNKNOWN";
  const description = event?.description || null;

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-[#D6003C]" />
              Event Specification Blueprint
            </span>
            <ProvenanceBadge provenance="SOURCE" size="sm" />
            <span className="text-[10px] font-mono text-slate-400">
              ID: {event?.id || summary?.event_id || "UNKNOWN"}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">{name}</h2>
          {description && (
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">{description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>State: <strong className="font-mono">{state}</strong></span>
          </div>
        </div>
      </div>

      {/* Primary Spec Grid */}
      <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Event Type */}
        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5 mb-1">
            <Tag className="w-3 h-3 text-slate-400" /> Event Type
          </span>
          <span className="text-sm font-semibold text-slate-900 font-mono">
            {type}
          </span>
        </div>

        {/* Expected Attendees */}
        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5 mb-1">
            <Users className="w-3 h-3 text-slate-400" /> Attendees
          </span>
          <span className="text-sm font-semibold text-slate-900 font-mono">
            {guestCount != null ? Number(guestCount).toLocaleString() : "NOT AVAILABLE"}
          </span>
        </div>

        {/* Budget Allocation Ceiling */}
        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-slate-400" /> Target Budget
          </span>
          <span className="text-sm font-semibold text-slate-900 font-mono">
            {totalBudget != null ? `${currSym}${Number(totalBudget).toLocaleString()}` : "UNSET"}
          </span>
        </div>

        {/* Location & Venue */}
        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5 mb-1">
            <MapPin className="w-3 h-3 text-slate-400" /> Location / Venue
          </span>
          {location ? (
            <div className="text-xs font-semibold text-slate-900 truncate" title={location}>
              {location}
            </div>
          ) : (
            <span className="text-xs text-amber-600 font-medium">VENUE UNASSIGNED</span>
          )}
        </div>
      </div>

      {/* Operational Timing & Metadata Bar */}
      <div className="px-5 pb-5">
        <div className="p-3.5 rounded-lg border border-slate-200/70 bg-white grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Start Datetime
            </span>
            <span className="font-mono text-slate-700">
              {startDatetime ? new Date(startDatetime).toLocaleString() : "NOT AVAILABLE"}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              End Datetime
            </span>
            <span className="font-mono text-slate-700">
              {endDatetime ? new Date(endDatetime).toLocaleString() : "NOT AVAILABLE"}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Venue Navigation
            </span>
            {event?.id ? (
              <Link
                href={`/events/${event.id}/venue`}
                className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1"
              >
                <Building2 className="w-3.5 h-3.5" />
                Inspect Venue Selection
                <ExternalLink className="w-3 h-3" />
              </Link>
            ) : (
              <span className="text-slate-400">N/A</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
