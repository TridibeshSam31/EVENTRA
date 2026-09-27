"use client";

import React from "react";
import {
  CheckSquare,
  Clock,
  ListTodo,
  Zap,
  Activity,
  AlertTriangle,
  Layers,
} from "lucide-react";
import type { EventLiveState } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface ExecutionOverviewProps {
  liveState: EventLiveState | null;
  className?: string;
}

export function ExecutionOverview({
  liveState,
  className = "",
}: ExecutionOverviewProps) {
  if (!liveState) {
    return (
      <div className={`p-5 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <Layers className="w-5 h-5 mx-auto mb-1.5 text-slate-300" />
        <p className="font-semibold text-slate-700">Execution Overview</p>
        <p className="text-slate-400 mt-0.5">Execution telemetry unavailable.</p>
      </div>
    );
  }

  const taskSummary = liveState.task_summary || {};
  const completed = liveState.completed_tasks;
  const total = liveState.total_tasks;
  const progress = liveState.progress_percent;

  const inProgress = taskSummary["IN_PROGRESS"] || 0;
  const pending =
    (taskSummary["PENDING"] || 0) + (taskSummary["READY"] || 0) + (taskSummary["PLANNED"] || 0);
  const blocked = taskSummary["BLOCKED"] || 0;
  const criticalCount = liveState.task_progress.filter((t) => t.is_critical_path).length;

  return (
    <div className={`p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4 ${className}`}>
      {/* Header & Progress Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Execution Progress
            </span>
            <ProvenanceBadge source="ENGINE" size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Operational Completion
            </h3>
            <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              {completed} of {total} Tasks
            </span>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold font-mono text-slate-900">
            {progress.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Visual Progress Bar */}
      <div className="space-y-1">
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
          <div
            className="h-full bg-[#D6003C] transition-all duration-500 rounded-full"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-slate-400">
          <span>0%</span>
          <span>{total - completed} Remaining</span>
          <span>100%</span>
        </div>
      </div>

      {/* State Breakdown Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs font-mono">
        <div className="p-2.5 rounded-lg border border-blue-200/70 bg-blue-50/40">
          <span className="text-[9px] uppercase font-bold text-blue-600 block mb-0.5 font-sans flex items-center gap-1">
            <Zap className="w-3 h-3 text-blue-500" /> In Progress
          </span>
          <span className="text-base font-bold text-blue-900">{inProgress}</span>
        </div>

        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="text-[9px] uppercase font-bold text-slate-500 block mb-0.5 font-sans flex items-center gap-1">
            <ListTodo className="w-3 h-3 text-slate-400" /> Pending / Ready
          </span>
          <span className="text-base font-bold text-slate-800">{pending}</span>
        </div>

        <div className="p-2.5 rounded-lg border border-emerald-200/70 bg-emerald-50/40">
          <span className="text-[9px] uppercase font-bold text-emerald-600 block mb-0.5 font-sans flex items-center gap-1">
            <CheckSquare className="w-3 h-3 text-emerald-500" /> Completed
          </span>
          <span className="text-base font-bold text-emerald-900">{completed}</span>
        </div>

        <div className="p-2.5 rounded-lg border border-rose-200/70 bg-rose-50/40">
          <span className="text-[9px] uppercase font-bold text-rose-600 block mb-0.5 font-sans flex items-center gap-1">
            <Activity className="w-3 h-3 text-rose-500" /> Critical Path
          </span>
          <span className="text-base font-bold text-rose-900">{criticalCount}</span>
        </div>
      </div>
    </div>
  );
}
