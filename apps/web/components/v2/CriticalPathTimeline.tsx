"use client";

import React from "react";
import {
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  GitCommit,
  Building2,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";
import type { CriticalPathEntry, CriticalPathResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface CriticalPathTimelineProps {
  criticalPathEntries?: CriticalPathEntry[];
  criticalPathResponse?: CriticalPathResponse | null;
  totalDurationMinutes?: number | null;
  className?: string;
}

export function CriticalPathTimeline({
  criticalPathEntries = [],
  criticalPathResponse,
  totalDurationMinutes,
  className = "",
}: CriticalPathTimelineProps) {
  // Check if critical path data is present
  const hasEntries = criticalPathEntries && criticalPathEntries.length > 0;
  const hasResponseTasks =
    criticalPathResponse?.critical_path_tasks &&
    criticalPathResponse.critical_path_tasks.length > 0;

  if (!hasEntries && !hasResponseTasks) {
    return (
      <div className={`p-8 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <Activity className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-700">Critical Path Analysis (CPM)</p>
        <p className="text-slate-400 mt-1">Critical path data unavailable from backend.</p>
      </div>
    );
  }

  const durationMin =
    totalDurationMinutes ??
    criticalPathResponse?.total_duration_minutes ??
    null;

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-[#D6003C]" />
              Critical Path Method (CPM)
            </span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            <span className="text-[10px] font-mono text-slate-400">
              Zero Slack Chain
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Topological Execution Sequence
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Tasks on the critical path dictate total event delivery time. Any delay immediately translates to an event-wide delay.
          </p>
        </div>

        {durationMin != null && (
          <div className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-right shrink-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Critical Duration</span>
            <span className="text-sm font-bold font-mono text-slate-900">
              {durationMin} Minutes
            </span>
          </div>
        )}
      </div>

      {/* Structured Critical Tasks Sequence */}
      {hasEntries ? (
        <div className="p-5 space-y-3">
          {criticalPathEntries.map((task, idx) => {
            const isCompleted = task.status === "COMPLETED";
            const isInProgress = task.status === "IN_PROGRESS";

            return (
              <div
                key={task.task_id}
                className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isCompleted
                    ? "bg-slate-50/70 border-slate-200 text-slate-600"
                    : isInProgress
                    ? "bg-blue-50/40 border-blue-200 text-blue-900 shadow-xs"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  {/* Sequence Badge */}
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 border ${
                      isCompleted
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : isInProgress
                        ? "bg-blue-500 text-white border-blue-600"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {task.sequence_order != null ? task.sequence_order : idx + 1}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-slate-400">
                        {task.task_id}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isInProgress
                            ? "bg-blue-100 text-blue-800 border-blue-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {task.status}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500">
                        Slack: {task.slack_minutes ?? 0}m
                      </span>
                    </div>

                    <h4
                      className={`text-sm font-semibold truncate ${
                        isCompleted ? "line-through text-slate-500" : "text-slate-900"
                      }`}
                    >
                      {task.task_name}
                    </h4>

                    {task.assigned_provider_name && (
                      <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        Provider: <strong>{task.assigned_provider_name}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Timing Telemetry from Backend */}
                <div className="flex items-center gap-4 text-xs font-mono text-slate-600 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                  <div className="text-left sm:text-right">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">
                      Duration
                    </span>
                    <span>{task.duration_minutes}m</span>
                  </div>

                  {(task.planned_start || task.planned_end) && (
                    <div className="text-left sm:text-right">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">
                        Window
                      </span>
                      <span>
                        {task.planned_start
                          ? new Date(task.planned_start).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "TBD"}{" "}
                        &rarr;{" "}
                        {task.planned_end
                          ? new Date(task.planned_end).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "TBD"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Fallback when only task ID strings are provided in critical_path_tasks */
        <div className="p-5 space-y-2">
          <p className="text-xs text-slate-600 font-semibold mb-2">
            Critical Path Task Identifiers:
          </p>
          <div className="flex flex-wrap gap-2">
            {criticalPathResponse?.critical_path_tasks.map((taskId, idx) => (
              <span
                key={taskId}
                className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-800 flex items-center gap-1"
              >
                <span className="text-slate-400 text-[10px]">{idx + 1}.</span>
                {taskId}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
