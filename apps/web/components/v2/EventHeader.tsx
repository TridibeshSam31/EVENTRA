"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  MapPin,
  Users,
  CreditCard,
  ShieldAlert,
  Radio,
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
  name = "Corporate Summit 2026",
  startDate,
  location = "Delhi, India",
  guestCount = 100,
  totalBudget = 1000000,
  currency = "INR",
  lifecycleState = "PLANNED",
  state = "NORMAL",
  currentStage = "DISCOVER",
}: EventHeaderProps) {
  const pathname = usePathname();

  const isDegraded = state === "DEGRADED";
  const isDisrupted = state === "DISRUPTED";

  const currencySym = currency === "INR" ? "₹" : "$";

  return (
    <header className="w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl sticky top-0 z-30">
      {/* Top Banner / Event Metadata */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/events"
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border border-zinc-800/80 transition"
            title="All Events"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-zinc-100 tracking-tight">
                {name}
              </h1>

              {/* Status Pill */}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                  isDisrupted
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    : isDegraded
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isDisrupted
                      ? "bg-rose-400 animate-ping"
                      : isDegraded
                      ? "bg-amber-400 animate-pulse"
                      : "bg-emerald-400"
                  }`}
                />
                {state}
              </span>
            </div>

            {/* Quick Specs */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 mt-1">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                {location}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-zinc-500" />
                {guestCount} pax
              </span>
              <span className="flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
                {currencySym}
                {totalBudget.toLocaleString()}
              </span>
              {startDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                  {new Date(startDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-medium">
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
                className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-zinc-800 text-white font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Lifecycle Progress Stepper */}
      <LifecycleStepper eventId={eventId} currentStage={currentStage} />
    </header>
  );
}
