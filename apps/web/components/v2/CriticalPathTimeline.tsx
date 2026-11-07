"use client";

import React from "react";
import { Activity, Building2, Check } from "lucide-react";
import type { CriticalPathEntry, CriticalPathResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { EmptyState } from "@/components/ds";
import { StaggerList } from "@/components/ds/motion";
import { shortId } from "@/lib/humanize";
import { STATUS_CHIP, clockOrNull, fmtDuration, fmtSlack, taskStatus } from "./planningFormat";

interface CriticalPathTimelineProps {
  criticalPathEntries?: CriticalPathEntry[];
  criticalPathResponse?: CriticalPathResponse | null;
  totalDurationMinutes?: number | null;
  className?: string;
}

/**
 * The critical path as a cue list: the zero-slack chain of tasks that decides
 * when the event can happen. A crimson spine connects the cues.
 */
export function CriticalPathTimeline({
  criticalPathEntries = [],
  criticalPathResponse,
  totalDurationMinutes,
  className = "",
}: CriticalPathTimelineProps) {
  const hasEntries = criticalPathEntries && criticalPathEntries.length > 0;
  const hasResponseTasks =
    criticalPathResponse?.critical_path_tasks && criticalPathResponse.critical_path_tasks.length > 0;

  if (!hasEntries && !hasResponseTasks) {
    return (
      <EmptyState
        className={className}
        icon={<Activity className="h-5 w-5" />}
        title="Critical path not calculated yet"
        description="Compute the schedule to see the chain of tasks that decides your event’s timing."
      />
    );
  }

  const durationMin = totalDurationMinutes ?? criticalPathResponse?.total_duration_minutes ?? null;
  const responseTasks = criticalPathResponse?.critical_path_tasks || [];
  // The backend sometimes sends the literal string "Unassigned" instead of null.
  const providerOf = (name?: string | null) =>
    name && name.trim().toLowerCase() !== "unassigned" ? name : null;
  const unassigned = criticalPathEntries.filter((t) => !providerOf(t.assigned_provider_name)).length;

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex flex-col justify-between gap-3 border-b border-ink-200 px-5 py-4 sm:flex-row sm:items-start">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="eyebrow">Critical path</span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink-900">The tasks that decide your timing</h3>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-ink-500">
            A delay to any of these moves the whole event.
            {hasEntries && unassigned > 0 && (
              <span className="font-semibold text-standby-700">
                {" "}
                {unassigned} of {criticalPathEntries.length} still need a vendor.
              </span>
            )}
          </p>
        </div>
        {durationMin != null && (
          <div className="shrink-0 rounded-lg bg-ink-900 px-3.5 py-2 text-right text-ink-50">
            <div className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Total length</div>
            <div className="timecode text-[18px] font-semibold">{fmtDuration(Number(durationMin))}</div>
          </div>
        )}
      </header>

      {hasEntries ? (
        <div className="relative px-5 py-4">
          {/* the crimson spine */}
          <span className="absolute bottom-8 left-[35px] top-8 w-[2px] rounded-full bg-cue-200" aria-hidden />
          <StaggerList className="space-y-0">
            {criticalPathEntries.map((task, idx) => {
              const st = taskStatus(task.status);
              const isCompleted = st.label === "Done";
              const isInProgress = st.label === "In progress";
              const seq = task.sequence_order != null ? task.sequence_order : idx + 1;
              const slack = fmtSlack(task.slack_minutes);
              const start = clockOrNull(task.planned_start);
              const end = clockOrNull(task.planned_end);
              return (
                <div key={task.task_id} className="relative grid grid-cols-[32px_1fr] gap-x-4 py-1.5">
                  <span
                    className={`relative z-10 grid h-8 w-8 place-items-center rounded-lg font-mono text-[11px] font-semibold ring-4 ring-[#FDFCFA] ${
                      isCompleted
                        ? "bg-go-500 text-white"
                        : isInProgress
                        ? "bg-cue-600 text-white"
                        : "border border-cue-200 bg-cue-50 text-cue-700"
                    }`}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : String(seq).padStart(2, "0")}
                  </span>
                  <div
                    title={`Task ${shortId(task.task_id)}`}
                    className={`flex min-w-0 flex-col justify-between gap-2 rounded-lg border px-3.5 py-2.5 transition sm:flex-row sm:items-center ${
                      isInProgress
                        ? "border-cue-300 bg-cue-50/50 shadow-sm"
                        : isCompleted
                        ? "border-ink-200 bg-ink-50/60"
                        : "border-ink-200 bg-[#FDFCFA] hover:-translate-y-px hover:border-ink-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4
                          className={`text-[13.5px] font-semibold ${
                            isCompleted ? "text-ink-500 line-through decoration-ink-300" : "text-ink-900"
                          }`}
                        >
                          {task.task_name}
                        </h4>
                        <span className={`chip ${STATUS_CHIP[st.tone]}`}>
                          {isInProgress && <span className="cue-light bg-cue-600 animate-cue-blink" />}
                          {st.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px]">
                        {providerOf(task.assigned_provider_name) ? (
                          <span className="inline-flex items-center gap-1 text-ink-600">
                            <Building2 className="h-3 w-3" /> {providerOf(task.assigned_provider_name)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-medium text-standby-700">
                            <span className="cue-light bg-standby-400" /> No vendor yet
                          </span>
                        )}
                        {(start || end) && (
                          <span className="timecode text-ink-500">
                            {start ?? "?"} <span className="text-ink-300">→</span> {end ?? "?"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[12px]">
                      <span className="font-semibold text-ink-700">{fmtDuration(task.duration_minutes)}</span>
                      {slack && (
                        <span
                          className={`rounded-full px-2 py-px text-[11px] font-semibold ${
                            slack === "No slack" ? "bg-cue-50 text-cue-700" : "bg-ink-100 text-ink-600"
                          }`}
                        >
                          {slack}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </StaggerList>
        </div>
      ) : (
        /* Fallback when the schedule only returns task IDs */
        <div className="px-5 py-4">
          <p className="mb-2.5 text-[12.5px] text-ink-500">
            The schedule lists {responseTasks.length} critical {responseTasks.length === 1 ? "task" : "tasks"}. Compile the
            plan to see their names and vendors.
          </p>
          <ol className="flex flex-wrap items-center gap-1.5">
            {responseTasks.map((taskId, idx) => (
              <li key={taskId} className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-cue-200 bg-cue-50 px-2 py-1 text-[11.5px] text-cue-800"
                  title={taskId}
                >
                  <span className="font-mono text-cue-400">{String(idx + 1).padStart(2, "0")}</span>
                  Task {shortId(taskId)}
                </span>
                {idx < responseTasks.length - 1 && <span className="text-ink-300">→</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
