"use client";

import React from "react";
import Link from "next/link";
import { Check } from "lucide-react";

export type LifecycleStage =
  | "DEFINE"
  | "DISCOVER"
  | "PLAN"
  | "READY"
  | "LIVE"
  | "RECOVER";

interface LifecycleStepperProps {
  eventId: string;
  currentStage: LifecycleStage;
  className?: string;
  /** slim single-line rail, used in the sticky header once the page scrolls */
  compact?: boolean;
}

const STAGES: {
  id: LifecycleStage;
  label: string;
  sublabel: string;
  path: (id: string) => string;
}[] = [
  { id: "DEFINE", label: "Define", sublabel: "Event details", path: (id) => `/events/${id}/setup` },
  { id: "DISCOVER", label: "Discover", sublabel: "Find vendors", path: (id) => `/events/${id}/vendors` },
  { id: "PLAN", label: "Plan", sublabel: "Pick & plan", path: (id) => `/events/${id}/plan` },
  { id: "READY", label: "Ready", sublabel: "Approve & book", path: (id) => `/events/${id}/approvals` },
  { id: "LIVE", label: "Live", sublabel: "Event day", path: (id) => `/events/${id}/live` },
  { id: "RECOVER", label: "Recover", sublabel: "Fix problems", path: (id) => `/events/${id}/recovery` },
];

/**
 * The cue rail: the event lifecycle rendered like a run-of-show strip, used as
 * stage navigation. `currentStage` is the stage of the page being viewed — it
 * is NOT backend progress, so we never tick stages as "done" here; we only
 * light the stage you're on.
 */
export function LifecycleStepper({ eventId, currentStage = "DISCOVER", className = "", compact = false }: LifecycleStepperProps) {
  const currentIndex = Math.max(0, STAGES.findIndex((s) => s.id === currentStage));

  if (compact) {
    return (
      <nav aria-label="Event progress" className={`overflow-x-auto ${className}`}>
        <ol className="flex items-center gap-0.5 rounded-lg bg-ink-100/80 p-0.5">
          {STAGES.map((stage, idx) => {
            const isCurrent = idx === currentIndex;
            return (
              <li key={stage.id}>
                <Link
                  href={stage.path(eventId)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${
                    isCurrent ? "bg-ink-900 text-ink-50 shadow-sm" : "text-ink-500 hover:bg-[#FDFCFA] hover:text-ink-900"
                  }`}
                >
                  <span className={`font-mono text-[9.5px] ${isCurrent ? "text-cue-300" : "text-ink-400"}`}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {stage.label}
                  {isCurrent && <span className="cue-light bg-cue-500 animate-cue-blink" />}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="Event progress" className={`w-full overflow-x-auto ${className}`}>
      <ol className="grid min-w-[640px] grid-cols-6 gap-1">
        {STAGES.map((stage, idx) => {
          const isPassed = false as boolean; // see note above: page stage is not progress
          const isCurrent = idx === currentIndex;
          return (
            <li key={stage.id} className="min-w-0">
              <Link
                href={stage.path(eventId)}
                aria-current={isCurrent ? "step" : undefined}
                className={`group relative flex h-full flex-col gap-1 overflow-hidden rounded-lg px-3 pb-2 pt-1.5 transition-all hover:-translate-y-px ${
                  isCurrent
                    ? "border border-ink-900 bg-ink-900 text-ink-50 shadow-md"
                    : isPassed
                    ? "border border-ink-200 bg-[#FDFCFA] text-ink-800 hover:border-ink-300"
                    : "border border-ink-200 bg-[#FDFCFA]/60 text-ink-500 hover:border-ink-300 hover:bg-[#FDFCFA] hover:text-ink-800"
                }`}
              >
                {/* progress bar along the bottom edge */}
                <span
                  className={`absolute inset-x-0 bottom-0 h-[3px] ${
                    isCurrent ? "bg-cue-500" : isPassed ? "bg-go-500" : "bg-transparent"
                  }`}
                  aria-hidden
                />
                <span className="flex items-center justify-between">
                  <span className={`font-mono text-[10px] font-medium tracking-label ${isCurrent ? "text-ink-400" : ""}`}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {isPassed ? (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-go-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                  ) : isCurrent ? (
                    <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-label text-cue-300">
                      Here
                      <span className="cue-light bg-cue-500 animate-cue-blink" />
                    </span>
                  ) : null}
                </span>
                <span className="font-display text-[15px] font-bold uppercase leading-none tracking-[0.02em]" style={{ fontStretch: "85%" }}>
                  {stage.label}
                </span>
                <span
                  className={`truncate text-[11px] ${
                    isCurrent ? "text-ink-400" : isPassed ? "text-ink-500" : "text-ink-400"
                  }`}
                >
                  {stage.sublabel}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
