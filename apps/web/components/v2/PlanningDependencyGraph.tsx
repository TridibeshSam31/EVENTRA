"use client";

import React, { useMemo } from "react";
import { ArrowRight, GitCommit } from "lucide-react";
import type { ExecutionPlanTask, PlanDependencyEntry } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { STATUS_CHIP, taskStatus } from "./planningFormat";

interface PlanningDependencyGraphProps {
  tasks?: ExecutionPlanTask[];
  dependencies?: PlanDependencyEntry[];
  className?: string;
}

interface ResolvedEdge {
  predecessorId: string;
  predecessorName: string;
  predecessorStatus: string;
  successorId: string;
  successorName: string;
  successorStatus: string;
  type?: string;
  lagMinutes?: number;
}

const TYPE_SHORT: Record<string, string> = {
  FINISH_TO_START: "FS",
  START_TO_START: "SS",
  FINISH_TO_FINISH: "FF",
  START_TO_FINISH: "SF",
};

function statusDot(status: string) {
  if (status === "COMPLETED") return "bg-go-500";
  if (status === "IN_PROGRESS") return "bg-cue-500 animate-cue-blink";
  if (status === "BLOCKED" || status === "FAILED") return "bg-cue-600";
  if (status === "UNKNOWN") return "bg-ink-300";
  return "bg-standby-400";
}

function Node({ label, name, id, status }: { label: string; name: string; id: string; status: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-[#FDFCFA] px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`cue-light ${statusDot(status)}`} />
        <span className="truncate text-[13px] font-semibold text-ink-900">{name}</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-ink-500" title={id}>
        {taskStatus(status === "UNKNOWN" ? "" : status).label}
      </div>
    </div>
  );
}

export function PlanningDependencyGraph({ tasks = [], dependencies = [], className = "" }: PlanningDependencyGraphProps) {
  // Extract explicit directed edges from tasks or plan dependencies
  const edges: ResolvedEdge[] = useMemo(() => {
    const list: ResolvedEdge[] = [];

    // Method 1: from ExecutionPlanTask predecessors/successors
    if (tasks && tasks.length > 0) {
      tasks.forEach((task) => {
        if (task.predecessors && Array.isArray(task.predecessors)) {
          task.predecessors.forEach((pred) => {
            list.push({
              predecessorId: pred.task_id,
              predecessorName: pred.task_name,
              predecessorStatus: pred.status,
              successorId: task.task_id,
              successorName: task.task_name,
              successorStatus: task.status,
              type: "FINISH_TO_START",
            });
          });
        }
      });
    }

    // Method 2: from PlanDependencyEntry if edges empty
    if (list.length === 0 && dependencies && dependencies.length > 0) {
      const taskMap = new Map<string, ExecutionPlanTask>();
      tasks.forEach((t) => taskMap.set(t.task_id, t));

      dependencies.forEach((d) => {
        const pred = taskMap.get(d.predecessor_task_id);
        const succ = taskMap.get(d.successor_task_id);
        list.push({
          predecessorId: d.predecessor_task_id,
          predecessorName: pred?.task_name || d.predecessor_task_id,
          predecessorStatus: pred?.status || "UNKNOWN",
          successorId: d.successor_task_id,
          successorName: succ?.task_name || d.successor_task_id,
          successorStatus: succ?.status || "UNKNOWN",
          type: d.dependency_type,
          lagMinutes: d.lag_minutes,
        });
      });
    }

    return list;
  }, [tasks, dependencies]);

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="border-b border-ink-200 px-5 py-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="eyebrow">Dependencies</span>
          <ProvenanceBadge provenance="ENGINE" size="sm" />
          <span className="font-mono text-[10.5px] text-ink-400">{edges.length} links</span>
        </div>
        <h3 className="text-[15px] font-semibold text-ink-900">What has to happen before what</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Each link means the second task can’t start until the first one is done. A problem upstream ripples down this chain.
        </p>
      </header>

      {edges.length > 0 ? (
        <ol className="space-y-2 px-5 py-4">
          {edges.map((edge, idx) => (
            <li key={idx} className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
              <Node label="First" name={edge.predecessorName} id={edge.predecessorId} status={edge.predecessorStatus} />
              <div className="flex shrink-0 items-center justify-center gap-1.5 px-1 text-ink-400">
                <span className="font-mono text-[10px] font-semibold uppercase text-ink-500">
                  {TYPE_SHORT[edge.type || ""] || edge.type || "FS"}
                </span>
                <ArrowRight className="h-4 w-4 rotate-90 text-cue-500 md:rotate-0" />
                {edge.lagMinutes ? <span className="font-mono text-[10px] text-ink-500">+{edge.lagMinutes}m</span> : null}
              </div>
              <Node label="Then" name={edge.successorName} id={edge.successorId} status={edge.successorStatus} />
            </li>
          ))}
        </ol>
      ) : (
        /* Truthful fallback when no graph edges are returned */
        <div className="px-5 py-5">
          <div className="mb-4 flex gap-3 rounded-lg border border-standby-200 bg-standby-50 px-3.5 py-3">
            <GitCommit className="mt-0.5 h-4 w-4 shrink-0 text-standby-700" />
            <div className="text-[12.5px] text-standby-900">
              <p className="font-semibold">No dependency links were returned for this plan.</p>
              <p className="mt-0.5 leading-relaxed text-standby-800">
                Showing each task with its recorded readiness instead.
              </p>
            </div>
          </div>

          {tasks.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 font-mono text-[10px] uppercase tracking-label text-ink-400">
                    <th className="px-4 py-2.5 font-medium">Task</th>
                    <th className="px-3 py-2.5 font-medium">Readiness</th>
                    <th className="px-3 py-2.5 font-medium">Critical</th>
                    <th className="px-4 py-2.5 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-ink-200">
                  {tasks.map((t) => (
                    <tr key={t.task_id} className="hover:bg-ink-50/70">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-ink-900">{t.task_name}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`chip ${STATUS_CHIP[taskStatus(t.readiness_state || t.status).tone]}`}>
                          {taskStatus(t.readiness_state || t.status).label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {t.is_critical_path ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-cue-700">
                            <span className="cue-light bg-cue-500" /> Yes
                          </span>
                        ) : (
                          <span className="text-ink-400">No</span>
                        )}
                      </td>
                      <td className="timecode px-4 py-2.5 text-right">{t.duration_minutes}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-[13px] text-ink-400">No tasks or dependency data found for this event.</p>
          )}
        </div>
      )}
    </section>
  );
}
