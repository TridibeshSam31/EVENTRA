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
    sublabel: "Sourcing & Fit",
    path: (id) => `/events/${id}/vendors`,
    icon: Search,
  },
  {
    id: "PLAN",
    label: "Plan",
    sublabel: "Schedule & CPM",
    path: (id) => `/events/${id}/plan`,
    icon: CalendarCheck,
  },
  {
    id: "READY",
    label: "Ready",
    sublabel: "Approvals & Sign-off",
    path: (id) => `/events/${id}/approvals`,
    icon: ShieldCheck,
  },
  {
    id: "LIVE",
    label: "Live",
    sublabel: "Execution Control",
    path: (id) => `/events/${id}/live`,
    icon: Radio,
  },
  {
    id: "RECOVER",
    label: "Recover",
    sublabel: "Incident & Swap",
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
      className={`w-full overflow-x-auto py-2.5 px-4 bg-white border-b border-slate-200 ${className}`}
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
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all duration-150 group ${
                  isCurrent
                    ? "bg-slate-100 text-slate-900 shadow-sm border border-slate-300 font-semibold"
                    : isPassed
                    ? "text-slate-700 hover:text-slate-900 hover:bg-slate-50"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50/50"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                    isCurrent
                      ? "bg-[#D6003C]/10 text-[#D6003C] border border-[#D6003C]/30"
                      : isPassed
                      ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                      : "bg-slate-100 text-slate-400 border border-slate-200"
                  }`}
                >
                  {isPassed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </div>

                <div className="text-left">
                  <div className="text-xs font-semibold tracking-wide uppercase flex items-center gap-1.5">
                    {stage.label}
                    {isCurrent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D6003C] animate-pulse" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 group-hover:text-slate-700 transition-colors">
                    {stage.sublabel}
                  </div>
                </div>
              </Link>

              {idx < STAGES.length - 1 && (
                <div
                  className={`flex-1 h-px transition-colors mx-1 ${
                    idx < currentIndex ? "bg-emerald-300" : "bg-slate-200"
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
