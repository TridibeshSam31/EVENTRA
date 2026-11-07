"use client";

import React from "react";
import { MapPin, Search } from "lucide-react";
import type { DiscoveryRunEvent } from "@/types/discoveryRun";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface DiscoveryIterationStepperProps {
  events: DiscoveryRunEvent[];
  currentIteration?: number;
  maxIterations?: number;
  radiusKm?: number;
  status?: string;
  className?: string;
}

function timecode(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

type IterState = "failed" | "reached" | "running" | "done";

const STATE_META: Record<IterState, { label: string; chip: string; dot: string }> = {
  failed: { label: "Search failed", chip: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600" },
  reached: { label: "Target reached", chip: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" },
  running: { label: "Searching", chip: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500 animate-cue-blink" },
  done: { label: "Iteration finished", chip: "border-ink-200 bg-ink-100/70 text-ink-600", dot: "bg-ink-400" },
};

/**
 * Agent discovery log. Replaces a generic "Searching…" spinner with what the
 * agent actually did per iteration: the query, the radius, how many it found,
 * why it adapted, and the time-stamped event stream from the backend.
 */
export function DiscoveryIterationStepper({
  events = [],
  currentIteration = 1,
  maxIterations = 3,
  radiusKm = 10,
  status = "COMPLETED",
  className = "",
}: DiscoveryIterationStepperProps) {
  const iterationMap: Record<number, DiscoveryRunEvent[]> = {};
  for (const ev of events) {
    const iter = ev.iteration || 1;
    if (!iterationMap[iter]) iterationMap[iter] = [];
    iterationMap[iter].push(ev);
  }

  const iterationNumbers = Object.keys(iterationMap)
    .map(Number)
    .sort((a, b) => a - b);
  const iterationsToRender = iterationNumbers.length > 0 ? iterationNumbers : [1];

  const stateFor = (iterEvents: DiscoveryRunEvent[], isCurrent: boolean): IterState => {
    const hasError = iterEvents.some(
      (e) => e.event_type.includes("FAIL") || e.event_type.includes("ERROR") || e.event_type.includes("TIMEOUT")
    );
    const hasTargetReached = iterEvents.some(
      (e) => e.event_type.includes("TARGET_REACHED") || e.event_type.includes("COMPLETED")
    );
    if (hasError) return "failed";
    if (hasTargetReached || status === "COMPLETED") return "reached";
    if (isCurrent && status === "RUNNING") return "running";
    return "done";
  };

  const iterPct = Math.min(100, Math.round((currentIteration / Math.max(1, maxIterations)) * 100));

  return (
    <section className={`surface overflow-hidden ${className}`} aria-label="Agent discovery log">
      <header className="flex flex-wrap items-end justify-between gap-3 px-5 pt-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Agent discovery log</span>
            <ProvenanceBadge provenance="AGENT" size="sm" />
          </div>
          <p className="mt-1 text-[13px] text-ink-600">
            Each iteration widens or rewrites the search until the target is reached or the search is exhausted.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-label text-ink-400">Iteration</div>
            <div className="font-display text-[20px] font-bold leading-none tabular-nums text-ink-900" style={{ fontStretch: "88%" }}>
              {currentIteration}
              <span className="text-ink-400">/{maxIterations}</span>
            </div>
          </div>
          <div className="h-8 w-px bg-ink-200" />
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-label text-ink-400">Radius</div>
            <div className="font-display text-[20px] font-bold leading-none tabular-nums text-ink-900" style={{ fontStretch: "88%" }}>
              {radiusKm}
              <span className="text-[13px] text-ink-400"> km</span>
            </div>
          </div>
        </div>
      </header>
      <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-ink-200/70" aria-hidden>
        <div className="h-full rounded-full bg-agent-500 transition-[width] duration-700" style={{ width: `${iterPct}%` }} />
      </div>

      <ol className="space-y-4 px-5 pb-5 pt-4">
        {iterationsToRender.map((iterNum) => {
          const iterEvents = iterationMap[iterNum] || [];
          const isCurrent = iterNum === currentIteration;
          const queryEvent = iterEvents.find((e) => e.data && e.data.query);
          const queryUsed: string | undefined = queryEvent?.data?.query;
          const radiusUsed = queryEvent?.data?.radius_km || radiusKm;
          const countDiscovered = iterEvents.find((e) => e.data && e.data.discovered_count)?.data?.discovered_count;
          const reasonAdapted: string | undefined = queryEvent?.data?.adaptation_reason;
          const state = stateFor(iterEvents, isCurrent);
          const meta = STATE_META[state];

          return (
            <li key={iterNum} className="grid grid-cols-[28px_1fr] gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-md font-mono text-[11px] font-bold ${
                    isCurrent ? "bg-ink-900 text-ink-50" : "border border-ink-200 bg-[#FDFCFA] text-ink-600"
                  }`}
                >
                  {String(iterNum).padStart(2, "0")}
                </span>
                <span className="mt-1 w-px flex-1 bg-ink-200" aria-hidden />
              </div>

              <div className="min-w-0 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink-900">Iteration {iterNum}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-500">
                    <MapPin className="h-3 w-3" />
                    {radiusUsed} km
                  </span>
                  {countDiscovered !== undefined && (
                    <span className="font-mono text-[11px] text-ink-500">· {countDiscovered} found</span>
                  )}
                  <span className={`chip ml-auto ${meta.chip}`}>
                    <span className={`cue-light ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>

                <div className="mt-2 flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5">
                  <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className={`font-mono text-[12px] ${queryUsed ? "text-ink-800" : "italic text-ink-400"}`}>
                    {queryUsed || "Query not reported for this iteration"}
                  </span>
                </div>

                {reasonAdapted && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-agent-800">
                    <span aria-hidden className="mt-px text-agent-500">✦</span>
                    <span>
                      <span className="font-semibold">Why it adapted:</span> {reasonAdapted}
                    </span>
                  </p>
                )}

                {iterEvents.length > 0 && (
                  <div className="mt-2.5 overflow-hidden rounded-lg bg-ink-950 ring-1 ring-black/10">
                    <ul className="max-h-56 overflow-y-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.7]">
                      {iterEvents.map((ev) => (
                        <li key={ev.id} className="flex gap-3">
                          <span className="shrink-0 tabular-nums text-ink-500">{timecode(ev.timestamp)}</span>
                          <span className="min-w-0 text-ink-200">{ev.message}</span>
                        </li>
                      ))}
                      {state === "running" && isCurrent && (
                        <li className="flex gap-3" aria-live="polite">
                          <span className="shrink-0 text-ink-600">········</span>
                          <span className="text-standby-300">
                            working<span className="animate-cue-blink">_</span>
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
