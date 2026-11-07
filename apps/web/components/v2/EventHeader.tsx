"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { LifecycleStage } from "./LifecycleStepper";
import { ReadinessStrip } from "@/components/guide/Readiness";
import { useGuideStore } from "@/stores/guideStore";

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

const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNED: "Planning",
  PLANNING: "Planning",
  READY: "Ready",
  LIVE: "Happening now",
  COMPLETED: "Finished",
  CONCLUDED: "Finished",
  CANCELLED: "Cancelled",
};

function formatDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function MetaItem({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">{label}</dt>
      <dd className={`truncate text-[13px] font-semibold ${muted ? "text-ink-400" : "text-ink-800"}`}>{value}</dd>
    </div>
  );
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
  const isDegraded = state === "DEGRADED";
  const isDisrupted = state === "DISRUPTED";

  const currencySym = currency === "INR" ? "₹" : "$";
  const displayName = name || "Event overview";
  const date = formatDate(startDate);

  // Once the full header scrolls away, a slim sticky bar takes over.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const status = isDisrupted
    ? { label: "Urgent problem", cls: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600 animate-cue-blink" }
    : isDegraded
    ? { label: "Needs attention", cls: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500 animate-cue-blink" }
    : { label: "No problems", cls: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" };

  return (
    <>
    <header className="w-full border-b border-ink-200/80 bg-paper">
      <div className="mx-auto max-w-7xl px-4 pb-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href="/dashboard"
              className="mt-1 rounded-lg border border-ink-200 bg-[#FDFCFA] p-1.5 text-ink-500 shadow-sm transition hover:border-ink-300 hover:text-ink-900"
              title="Back to My Events"
              aria-label="Back to My Events"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`chip ${status.cls}`}>
                  <span className={`cue-light ${status.dot}`} />
                  {status.label}
                </span>
                <span className="chip border-ink-200 bg-[#FDFCFA] text-ink-600">
                  {LIFECYCLE_LABELS[(lifecycleState || "").toUpperCase()] || "Planning"}
                </span>
              </div>
              {name ? (
                <h1
                  className="truncate font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink-900 sm:text-[32px]"
                  style={{ fontStretch: "88%" }}
                >
                  {displayName}
                </h1>
              ) : (
                <h1 className="py-1">
                  <span className="sr-only">Loading event</span>
                  <span className="workspace-shimmer block h-7 w-64 max-w-full rounded-md sm:h-8" aria-hidden />
                </h1>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:flex lg:gap-8">
            <MetaItem label="Date" value={date || "Not scheduled"} muted={!date} />
            <MetaItem label="Location" value={location || "Unassigned"} muted={!location} />
            <MetaItem label="Guests" value={guestCount ? guestCount.toLocaleString() : "—"} muted={!guestCount} />
            <MetaItem
              label="Budget"
              value={totalBudget != null ? `${currencySym}${totalBudget.toLocaleString()}` : "—"}
              muted={totalBudget == null}
            />
          </dl>
        </div>

        {/* Honest progress: readiness gates from the backend (no stage guessing). */}
        <ReadinessStrip eventId={eventId} className="mt-4" />
      </div>
      <div ref={sentinelRef} aria-hidden className="h-px" />
    </header>

      {/* Sticky compact bar — a sibling of <header> so it can stick for the whole page */}
      <div className="sticky top-0 z-30 h-0">
        <AnimatePresence>
          {compact && (
            <motion.div
              initial={reduce ? { opacity: 0 } : { y: -56, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: -56, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="border-b border-ink-200/80 bg-paper/90 shadow-sm backdrop-blur-md"
            >
              <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
                <span className={`cue-light ${status.dot}`} title={status.label} />
                <span
                  className="min-w-0 truncate font-display text-[16px] font-extrabold tracking-[-0.02em] text-ink-900"
                  style={{ fontStretch: "88%" }}
                >
                  {displayName}
                </span>
                <span className="hidden truncate text-[12px] text-ink-600 md:inline">
                  {[date, location].filter(Boolean).join(" · ")}
                </span>
                <CompactReadiness eventId={eventId} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** Slim readiness summary for the sticky bar: "Readiness 3/7" + the next step link. */
function CompactReadiness({ eventId }: { eventId: string }) {
  const readiness = useGuideStore((s) => (s.eventId === eventId ? s.readiness : null));
  const nextStep = useGuideStore((s) => (s.eventId === eventId ? s.nextStep : null));
  const openCard = useGuideStore((s) => s.openCard);
  const gates = (readiness?.gates ?? []).filter((g) => g.status !== "not_applicable");
  const done = gates.filter((g) => g.status === "done").length;
  return (
    <div className="ml-auto hidden items-center gap-2 md:flex">
      {gates.length > 0 && (
        <span className="chip border-ink-200 bg-[#FDFCFA] text-ink-700">
          Readiness <span className="font-mono">{done}/{gates.length}</span>
        </span>
      )}
      {nextStep && nextStep.step_id !== "event_done" && (
        <button
          type="button"
          onClick={openCard}
          className={`chip transition hover:-translate-y-px ${
            nextStep.urgency === "critical" ? "border-cue-300 bg-cue-50 text-cue-800" : "border-ink-900 bg-ink-900 text-ink-50"
          }`}
        >
          <span className="cue-light bg-cue-500 animate-cue-blink" />
          <span className="max-w-[260px] truncate">Next: {nextStep.title}</span>
        </button>
      )}
    </div>
  );
}
