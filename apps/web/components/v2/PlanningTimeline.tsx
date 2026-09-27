"use client";

import React from "react";
import {
  Clock,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Flag,
  Activity,
  Layers,
  ShieldCheck,
  Building2,
  CheckSquare,
} from "lucide-react";
import type {
  ScheduleResponse,
  ExecutionCheckpoint,
  TaskScheduleResponse,
} from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface PlanningTimelineProps {
  schedule?: ScheduleResponse | null;
  checkpoints?: ExecutionCheckpoint[];
  className?: string;
}

export function PlanningTimeline({
  schedule,
  checkpoints = [],
  className = "",
}: PlanningTimelineProps) {
  const hasSchedule = schedule && schedule.entries && schedule.entries.length > 0;
  const hasCheckpoints = checkpoints && checkpoints.length > 0;

  if (!hasSchedule && !hasCheckpoints) {
    return (
      <div className={`p-8 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <Clock className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-700">Master Run of Show & Schedule</p>
        <p className="text-slate-400 mt-1">Schedule data unavailable from backend. Please compute the schedule first.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-[#D6003C]" />
              Authoritative Run of Show
            </span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            {schedule?.is_feasible != null && (
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                  schedule.is_feasible
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                }`}
              >
                {schedule.is_feasible ? "Feasible Schedule" : "Infeasible Schedule"}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Operational Timeline & Milestones
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Forward-pass scheduled intervals with buffer tracking and operational milestones.
          </p>
        </div>

        {/* Schedule Constraints Telemetry Bar */}
        {schedule && (
          <div className="flex items-center gap-2 text-xs font-mono shrink-0">
            <div className="p-2.5 rounded-lg border border-slate-200 bg-white text-right">
              <span className="text-[9px] uppercase font-bold text-slate-400 block font-sans">
                Total Duration
              </span>
              <span className="font-bold text-slate-900">
                {schedule.total_duration_minutes}m
              </span>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-200 bg-white text-right">
              <span className="text-[9px] uppercase font-bold text-slate-400 block font-sans">
                Buffer Margin
              </span>
              <span
                className={`font-bold ${
                  schedule.buffer_minutes > 0 ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {schedule.buffer_minutes}m
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="p-5 space-y-6">
        {/* Execution Checkpoints / Milestones */}
        {hasCheckpoints && (
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 mb-3">
              <Flag className="w-3.5 h-3.5 text-[#D6003C]" />
              Operational Checkpoints & Milestones ({checkpoints.length})
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {checkpoints.map((cp) => (
                <div
                  key={cp.checkpoint_id}
                  className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-all flex items-start gap-3"
                >
                  <div className="px-2 py-1 rounded bg-white border border-slate-200 text-xs font-mono font-bold text-[#D6003C] shrink-0 text-center">
                    {cp.time}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {cp.title}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-slate-200 text-slate-700 shrink-0">
                        {cp.checkpoint_type}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      {cp.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Master Scheduled Task Sequence */}
        {hasSchedule && (
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 mb-3">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              Scheduled Task Windows ({schedule.entries.length})
            </span>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                    <th className="p-3 pl-4">Task</th>
                    <th className="p-3">Planned Start</th>
                    <th className="p-3">Planned End</th>
                    <th className="p-3 text-right">Duration</th>
                    <th className="p-3 text-right">Slack</th>
                    <th className="p-3 text-center">Critical</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                  {schedule.entries.map((entry) => (
                    <tr
                      key={entry.task_id}
                      className={`hover:bg-slate-50/50 transition-colors ${
                        entry.is_critical_path ? "bg-rose-50/20" : ""
                      }`}
                    >
                      <td className="p-3 pl-4 font-sans font-medium text-slate-900">
                        <div className="truncate max-w-xs">{entry.task_name}</div>
                        <span className="text-[10px] font-mono text-slate-400">
                          {entry.task_id}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">
                        {entry.planned_start
                          ? new Date(entry.planned_start).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "TBD"}
                      </td>
                      <td className="p-3 text-slate-600">
                        {entry.planned_end
                          ? new Date(entry.planned_end).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "TBD"}
                      </td>
                      <td className="p-3 text-right font-semibold text-slate-900">
                        {entry.duration_minutes}m
                      </td>
                      <td className="p-3 text-right text-slate-500">
                        {entry.slack_minutes != null ? `${entry.slack_minutes}m` : "0m"}
                      </td>
                      <td className="p-3 text-center">
                        {entry.is_critical_path ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200">
                            CPM
                          </span>
                        ) : (
                          <span className="text-slate-300">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
