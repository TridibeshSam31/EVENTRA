"use client";

import React, { useMemo } from "react";
import { Clock, Flag } from "lucide-react";
import type { ScheduleResponse, ExecutionCheckpoint } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { EmptyState } from "@/components/ds";
import { fmtDuration, fmtSlack } from "./planningFormat";

interface PlanningTimelineProps {
  schedule?: ScheduleResponse | null;
  checkpoints?: ExecutionCheckpoint[];
  className?: string;
}

function hm(iso?: string | null) {
  if (!iso) return "Not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not set";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Run of show: each scheduled task as a row with its timecode window and a bar
 * positioned on the event's own time axis (derived purely from planned times).
 */
export function PlanningTimeline({ schedule, checkpoints = [], className = "" }: PlanningTimelineProps) {
  const hasSchedule = !!schedule && !!schedule.entries && schedule.entries.length > 0;
  const hasCheckpoints = checkpoints && checkpoints.length > 0;

  // Time axis bounds from the planned windows (only rows with both ends are drawn).
  const axis = useMemo(() => {
    if (!schedule?.entries?.length) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const e of schedule.entries) {
      const s = e.planned_start ? new Date(e.planned_start).getTime() : NaN;
      const f = e.planned_end ? new Date(e.planned_end).getTime() : NaN;
      if (Number.isFinite(s)) min = Math.min(min, s);
      if (Number.isFinite(f)) max = Math.max(max, f);
    }
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
  }, [schedule]);

  if (!hasSchedule && !hasCheckpoints) {
    return (
      <EmptyState
        className={className}
        icon={<Clock className="h-5 w-5" />}
        title="No run of show yet"
        description="Compute the schedule first. The engine will lay out every task with its time window and slack."
      />
    );
  }

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex flex-col justify-between gap-4 border-b border-ink-200 px-5 py-4 sm:flex-row sm:items-start">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="eyebrow">Run of show</span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            {schedule?.is_feasible != null && (
              <span
                className={`chip ${
                  schedule.is_feasible ? "border-go-200 bg-go-50 text-go-700" : "border-cue-200 bg-cue-50 text-cue-700"
                }`}
              >
                <span className={`cue-light ${schedule.is_feasible ? "bg-go-500" : "bg-cue-600 animate-cue-blink"}`} />
                {schedule.is_feasible ? "Feasible" : "Not feasible"}
              </span>
            )}
          </div>
          <h3 className="text-[15px] font-semibold text-ink-900">Timeline &amp; checkpoints</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-500">Scheduled windows with their slack, and the checkpoints that mark progress.</p>
        </div>

        {schedule && (
          <div className="flex shrink-0 gap-px overflow-hidden rounded-lg border border-ink-200 bg-ink-200 text-right">
            <div className="bg-[#FDFCFA] px-3.5 py-2">
              <div className="eyebrow">Total</div>
              <div className="timecode text-[15px] font-semibold text-ink-900">{schedule.total_duration_minutes}m</div>
            </div>
            <div className="bg-[#FDFCFA] px-3.5 py-2">
              <div className="eyebrow">Buffer</div>
              <div className={`timecode text-[15px] font-semibold ${schedule.buffer_minutes > 0 ? "text-go-700" : "text-standby-700"}`}>
                {schedule.buffer_minutes}m
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="space-y-6 px-5 py-5">
        {hasCheckpoints && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Flag className="h-3.5 w-3.5 text-cue-600" />
              <span className="eyebrow text-ink-700">Checkpoints · {checkpoints.length}</span>
            </div>
            <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {checkpoints.map((cp) => (
                <li
                  key={cp.checkpoint_id}
                  className="flex items-start gap-3 rounded-lg border border-ink-200 bg-[#FDFCFA] px-3.5 py-3 transition hover:border-ink-300"
                >
                  <span className="timecode shrink-0 rounded-md bg-ink-900 px-2 py-1 text-[12px] font-semibold text-ink-50">{cp.time}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink-900">{cp.title}</span>
                      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-ink-400">{cp.checkpoint_type}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{cp.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {hasSchedule && schedule && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="eyebrow text-ink-700">Scheduled windows · {schedule.entries.length}</span>
              <span className="flex items-center gap-3 text-[11px] text-ink-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-sm bg-cue-500" /> critical
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-sm bg-ink-400" /> has slack
                </span>
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 font-mono text-[10px] uppercase tracking-label text-ink-400">
                    <th className="w-[96px] px-4 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Task</th>
                    <th className="hidden w-[34%] px-3 py-2.5 font-medium md:table-cell">Window</th>
                    <th className="px-3 py-2.5 text-right font-medium">Dur.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Slack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-ink-200">
                  {schedule.entries.map((entry) => {
                    const s = entry.planned_start ? new Date(entry.planned_start).getTime() : NaN;
                    const f = entry.planned_end ? new Date(entry.planned_end).getTime() : NaN;
                    const drawable = axis && Number.isFinite(s) && Number.isFinite(f);
                    const left = drawable ? ((s - axis!.min) / (axis!.max - axis!.min)) * 100 : 0;
                    const width = drawable ? Math.max(1.5, ((f - s) / (axis!.max - axis!.min)) * 100) : 0;
                    return (
                      <tr key={entry.task_id} className={`transition-colors hover:bg-ink-50/70 ${entry.is_critical_path ? "bg-cue-50/30" : ""}`}>
                        <td className="timecode whitespace-nowrap px-4 py-2.5 text-ink-700">
                          {hm(entry.planned_start)}
                          <span className="block text-[10.5px] text-ink-400">→ {hm(entry.planned_end)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {entry.is_critical_path && <span className="cue-light bg-cue-500" title="On the critical path" />}
                            <span className="max-w-xs truncate font-semibold text-ink-900">{entry.task_name}</span>
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          <div className="relative h-2.5 rounded-full bg-ink-100">
                            {drawable && (
                              <span
                                className={`absolute inset-y-0 rounded-full ${entry.is_critical_path ? "bg-cue-500" : "bg-ink-400"}`}
                                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                              />
                            )}
                          </div>
                        </td>
                        <td className="timecode px-3 py-2.5 text-right font-semibold text-ink-900">{fmtDuration(entry.duration_minutes)}</td>
                        <td className="timecode px-4 py-2.5 text-right text-ink-500">
                          {fmtSlack(entry.slack_minutes) ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
