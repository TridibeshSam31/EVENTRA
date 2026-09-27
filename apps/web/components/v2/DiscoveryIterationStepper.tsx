"use client";

import React from "react";
import { CheckCircle2, Clock, AlertCircle, RefreshCw, Compass, MapPin } from "lucide-react";
import type { DiscoveryRunEvent } from "@/types/discoveryRun";

interface DiscoveryIterationStepperProps {
  events: DiscoveryRunEvent[];
  currentIteration?: number;
  maxIterations?: number;
  radiusKm?: number;
  status?: string;
  className?: string;
}

export function DiscoveryIterationStepper({
  events = [],
  currentIteration = 1,
  maxIterations = 3,
  radiusKm = 10,
  status = "COMPLETED",
  className = "",
}: DiscoveryIterationStepperProps) {
  // Group events by iteration number
  const iterationMap: Record<number, DiscoveryRunEvent[]> = {};
  for (const ev of events) {
    const iter = ev.iteration || 1;
    if (!iterationMap[iter]) {
      iterationMap[iter] = [];
    }
    iterationMap[iter].push(ev);
  }

  const iterationNumbers = Object.keys(iterationMap)
    .map(Number)
    .sort((a, b) => a - b);

  // If no detailed events exist yet, render a baseline iteration item
  const iterationsToRender =
    iterationNumbers.length > 0 ? iterationNumbers : [1];

  const getStatusBadge = (iterEvents: DiscoveryRunEvent[], isCurrent: boolean) => {
    const hasError = iterEvents.some(
      (e) =>
        e.event_type.includes("FAIL") ||
        e.event_type.includes("ERROR") ||
        e.event_type.includes("TIMEOUT")
    );
    const hasTargetReached = iterEvents.some(
      (e) =>
        e.event_type.includes("TARGET_REACHED") ||
        e.event_type.includes("COMPLETED")
    );

    if (hasError) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
          <AlertCircle className="w-3 h-3 text-rose-500" /> Search Failed
        </span>
      );
    }
    if (hasTargetReached || status === "COMPLETED") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Target Reached
        </span>
      );
    }
    if (isCurrent && status === "RUNNING") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 animate-pulse">
          <RefreshCw className="w-3 h-3 animate-spin text-blue-600" /> In Progress
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
        <Clock className="w-3 h-3 text-slate-500" /> Iteration Completed
      </span>
    );
  };

  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-[#D6003C]" />
            <span>Adaptive Search Iterations</span>
          </h4>
          <p className="text-[11px] text-slate-500">
            Real multi-iteration query expansion & radius progression
          </p>
        </div>

        <div className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200">
          Iteration {currentIteration} of {maxIterations} • {radiusKm} km radius
        </div>
      </div>

      <div className="space-y-3 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {iterationsToRender.map((iterNum) => {
          const iterEvents = iterationMap[iterNum] || [];
          const isCurrent = iterNum === currentIteration;
          const queryEvent = iterEvents.find((e) => e.data && e.data.query);
          const queryUsed = queryEvent?.data?.query || "Query strategy from event requirements";
          const radiusUsed = queryEvent?.data?.radius_km || radiusKm;
          const countDiscovered = iterEvents.find((e) => e.data && e.data.discovered_count)?.data?.discovered_count;
          const reasonAdapted = queryEvent?.data?.adaptation_reason || "Reason unavailable";

          return (
            <div key={iterNum} className="relative pl-8 text-xs">
              {/* Stepper Dot */}
              <div
                className={`absolute left-2 top-1.5 -translate-x-1/2 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center ${
                  isCurrent
                    ? "border-[#D6003C] text-[#D6003C]"
                    : "border-slate-300 text-slate-500"
                }`}
              >
                <span className="text-[9px] font-bold">{iterNum}</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">
                      Iteration {iterNum}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 flex items-center gap-0.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {radiusUsed} km radius
                    </span>
                  </div>
                  {getStatusBadge(iterEvents, isCurrent)}
                </div>

                <div className="space-y-1 text-slate-600">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-slate-700 text-[11px]">Query:</span>
                    <span className="font-mono text-[11px] text-slate-800 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {queryUsed}
                    </span>
                  </div>

                  {countDiscovered !== undefined && (
                    <div className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="font-semibold text-slate-700">Candidates Found:</span>
                      <span className="font-semibold text-slate-900">{countDiscovered}</span>
                    </div>
                  )}

                  {reasonAdapted !== "Reason unavailable" && (
                    <div className="text-[11px] text-slate-500 italic mt-0.5">
                      Adaptation: {reasonAdapted}
                    </div>
                  )}
                </div>

                {/* Event Logs for this iteration */}
                {iterEvents.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200/60 space-y-1">
                    {iterEvents.map((ev) => (
                      <div key={ev.id} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                        <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="text-slate-700">{ev.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
