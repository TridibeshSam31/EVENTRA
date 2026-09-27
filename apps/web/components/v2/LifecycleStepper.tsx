"use client";

import React from "react";
import Link from "next/link";
import {
  Compass,
  Search,
  CalendarCheck,
  ShieldCheck,
  Radio,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";

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
}

const STAGES: {
  id: LifecycleStage;
  label: string;
  sublabel: string;
  path: (id: string) => string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: "DEFINE",
    label: "Define",
    sublabel: "Intake & Spec",
    path: (id) => `/events/${id}/setup`,
    icon: Compass,
  },
  {
    id: "DISCOVER",
    label: "Discover",
    sublabel: "Live Sourcing",
    path: (id) => `/events/${id}/vendors`,
    icon: Search,
  },
  {
    id: "PLAN",
    label: "Plan",
    sublabel: "DAG Schedule",
    path: (id) => `/events/${id}/plan`,
    icon: CalendarCheck,
  },
  {
    id: "READY",
    label: "Ready",
    sublabel: "Quotes & Approvals",
    path: (id) => `/events/${id}/approvals`,
    icon: ShieldCheck,
  },
  {
    id: "LIVE",
    label: "Live",
    sublabel: "Command Center",
    path: (id) => `/events/${id}/live`,
    icon: Radio,
  },
  {
    id: "RECOVER",
    label: "Recover",
    sublabel: "Adaptive Mitigations",
    path: (id) => `/events/${id}/recovery`,
    icon: RefreshCw,
  },
];

export function LifecycleStepper({
  eventId,
  currentStage = "DISCOVER",
  className = "",
}: LifecycleStepperProps) {
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);

  return (
    <nav
      aria-label="Event Lifecycle Stages"
      className={`w-full overflow-x-auto py-2.5 px-4 bg-zinc-950/70 border-b border-zinc-800/60 backdrop-blur-md ${className}`}
    >
      <div className="flex items-center justify-between min-w-[720px] max-w-6xl mx-auto gap-2">
        {STAGES.map((stage, idx) => {
          const isPassed = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const Icon = stage.icon;

          return (
            <React.Fragment key={stage.id}>
              <Link
                href={stage.path(eventId)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition-all duration-200 group ${
                  isCurrent
                    ? "bg-zinc-800/80 text-cyan-400 shadow-sm border border-cyan-500/30"
                    : isPassed
                    ? "text-zinc-300 hover:text-white hover:bg-zinc-900/60"
                    : "text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/30"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    isCurrent
                      ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/40"
                      : isPassed
                      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                      : "bg-zinc-900 text-zinc-600 border border-zinc-800"
                  }`}
                >
                  {isPassed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </div>

                <div className="text-left">
                  <div className="text-xs font-semibold tracking-wide uppercase flex items-center gap-1.5">
                    {stage.label}
                    {isCurrent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400 transition-colors">
                    {stage.sublabel}
                  </div>
                </div>
              </Link>

              {idx < STAGES.length - 1 && (
                <div
                  className={`flex-1 h-px transition-colors mx-1 ${
                    idx < currentIndex ? "bg-emerald-500/40" : "bg-zinc-800/60"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
