"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { AnimatedNumber } from "@/components/ds/motion";

type FunnelStage = "DISCOVERED" | "UNIQUE" | "RELEVANT" | "MATCHING" | "SHORTLISTED";

interface DiscoveryFunnelProps {
  discovered: number;
  unique: number;
  relevant: number;
  matching: number;
  shortlisted: number;
  activeStage?: FunnelStage | null;
  onStageClick?: (stage: FunnelStage) => void;
  className?: string;
}

/**
 * Qualification funnel. Every number comes from the discovery run returned by
 * the backend — nothing here is hardcoded. Bar lengths are proportional to the
 * raw "discovered" count so the narrowing is visible at a glance.
 */
export function DiscoveryFunnel({
  discovered = 0,
  unique = 0,
  relevant = 0,
  matching = 0,
  shortlisted = 0,
  activeStage,
  onStageClick,
  className = "",
}: DiscoveryFunnelProps) {
  const stages: { id: FunnelStage; label: string; sublabel: string; count: number }[] = [
    { id: "DISCOVERED", label: "Discovered", sublabel: "Raw results from sources", count: discovered },
    { id: "UNIQUE", label: "Unique", sublabel: "After de-duplication", count: unique },
    { id: "RELEVANT", label: "Relevant", sublabel: "Right category & area", count: relevant },
    { id: "MATCHING", label: "Matching", sublabel: "Pass hard constraints", count: matching },
    { id: "SHORTLISTED", label: "Shortlisted", sublabel: "Ready for outreach", count: shortlisted },
  ];

  const reduce = useReducedMotion();
  // Bars are proportional to the widest stage so a run with 0 raw results still reads correctly.
  const base = Math.max(discovered || 0, unique || 0, relevant || 0, matching || 0, shortlisted || 0, 1);

  return (
    <section className={`surface overflow-hidden ${className}`} aria-label="Qualification funnel">
      <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <div>
          <div className="eyebrow">Qualification funnel</div>
          <p className="mt-1 text-[13px] text-ink-600">
            How the raw search narrowed down to a shortlist. Click a stage to filter the list.
          </p>
        </div>
        <ProvenanceBadge provenance="ENGINE" size="sm" />
      </header>

      <ol className="mt-4 grid grid-cols-2 border-t border-ink-200 sm:grid-cols-3 lg:grid-cols-5">
        {stages.map((stage, idx) => {
          const isActive = activeStage === stage.id;
          const isLast = idx === stages.length - 1;
          const prevCount = idx > 0 ? stages[idx - 1].count : null;
          const convRate =
            prevCount && prevCount > 0 ? Math.min(100, Math.round((stage.count / prevCount) * 100)) : null;
          const widthPct = Math.max(stage.count > 0 ? 4 : 0, Math.round(((stage.count || 0) / base) * 100));

          return (
            <li
              key={stage.id}
              className={`relative border-b border-ink-200 lg:border-b-0 [&:not(:last-child)]:border-r ${
                isActive ? "bg-ink-900" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onStageClick && onStageClick(stage.id)}
                aria-pressed={isActive}
                className={`group flex h-full w-full flex-col px-4 pb-4 pt-3 text-left transition-colors ${
                  isActive ? "text-ink-50" : "hover:bg-ink-50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-[10px] font-medium uppercase tracking-label ${
                      isActive ? "text-ink-400" : "text-ink-500"
                    }`}
                  >
                    {String(idx + 1).padStart(2, "0")} · {stage.label}
                  </span>
                  {convRate !== null && (
                    <span
                      className={`font-mono text-[10.5px] tabular-nums ${isActive ? "text-ink-300" : "text-ink-400"}`}
                      title={`${convRate}% of the previous stage`}
                    >
                      {convRate}%
                    </span>
                  )}
                </span>

                <span
                  className={`mt-2 font-display text-[34px] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
                    isActive ? "text-white" : isLast && stage.count > 0 ? "text-cue-600" : "text-ink-900"
                  }`}
                  style={{ fontStretch: "85%" }}
                >
                  <AnimatedNumber value={stage.count ?? 0} />
                </span>

                <span
                  className={`mt-3 block h-1.5 w-full overflow-hidden rounded-full ${
                    isActive ? "bg-white/10" : "bg-ink-200/70"
                  }`}
                  aria-hidden
                >
                  <motion.span
                    className={`block h-full rounded-full ${isLast ? "bg-cue-600" : isActive ? "bg-ink-50" : "bg-ink-800"}`}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.8, delay: reduce ? 0 : idx * 0.08, ease: [0.2, 0.7, 0.2, 1] }}
                  />
                </span>

                <span className={`mt-2 text-[11.5px] ${isActive ? "text-ink-400" : "text-ink-500"}`}>
                  {stage.sublabel}
                </span>
              </button>

              {!isLast && (
                <ChevronRight
                  className="pointer-events-none absolute -right-[9px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full border border-ink-200 bg-paper p-[1px] text-ink-400 lg:block"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
