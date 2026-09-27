"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  MapPin,
  Users,
  CreditCard,
  ArrowLeft,
} from "lucide-react";
import { LifecycleStepper, LifecycleStage } from "./LifecycleStepper";

interface EventHeaderProps {
  eventId: string;
  name?: string;
  startDate?: string;
  location?: string;
  guestCount?: number;
  totalBudget?: number;
  currency?: string;
  lifecycleState?: string;
  state?: "NORMAL" | "DEGRADED" | "DISRUPTED" | string;
  currentStage?: LifecycleStage;
}

export function EventHeader({
  eventId,
  name,
  startDate,
  location,
  guestCount,
  totalBudget,
  currency = "INR",
  lifecycleState = "PLANNED",
  state = "NORMAL",
  currentStage = "DISCOVER",
}: EventHeaderProps) {
  const pathname = usePathname();

  const isDegraded = state === "DEGRADED";
  const isDisrupted = state === "DISRUPTED";

  const currencySym = currency === "INR" ? "₹" : "$";
  const displayName = name || "Event Overview";
  const displayLocation = location || "Location unassigned";
  const displayCapacity = guestCount ? `${guestCount} pax` : "Capacity unassigned";
  const displayBudget =
    totalBudget != null ? `${currencySym}${totalBudget.toLocaleString()}` : "Budget unassigned";

  return (
    <div className="w-full bg-white border-b border-slate-200 sticky top-0 z-30">
      {/* Top Banner / Event Metadata */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 transition"
            title="Back to Fleet Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
                {displayName}
              </h1>

              {/* Operational State Pill */}
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  isDisrupted
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : isDegraded
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isDisrupted
                      ? "bg-rose-500 animate-ping"
                      : isDegraded
                      ? "bg-amber-500 animate-pulse"
                      : "bg-emerald-500"
                  }`}
                />
                {state}
              </span>

              {/* Lifecycle State Pill */}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold uppercase">
                {lifecycleState}
              </span>
            </div>

            {/* Quick Specs */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mt-1">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                {displayLocation}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                {displayCapacity}
              </span>
              <span className="flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                {displayBudget}
              </span>
              {startDate ? (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {new Date(startDate).toLocaleDateString()}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-400">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Date not scheduled
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-medium no-scrollbar py-0.5">
          {[
            { label: "Overview", path: `/events/${eventId}` },
            { label: "Sourcing", path: `/events/${eventId}/vendors` },
            { label: "Conversations", path: `/events/${eventId}/conversations` },
            { label: "Plan & Schedule", path: `/events/${eventId}/plan` },
            { label: "Approvals", path: `/events/${eventId}/approvals` },
            { label: "Command Center", path: `/events/${eventId}/live` },
            { label: "Recovery", path: `/events/${eventId}/recovery` },
          ].map((tab) => {
            const isActive = pathname === tab.path;
            return (
              <Link
                key={tab.path}
                href={tab.path}
                className={`px-2.5 py-1.5 rounded-md transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Embedded Lifecycle Stepper */}
      <LifecycleStepper eventId={eventId} currentStage={currentStage} />
    </div>
  );
}
