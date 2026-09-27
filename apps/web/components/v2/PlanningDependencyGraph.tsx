"use client";

import React, { useMemo } from "react";
import {
  GitCommit,
  ArrowRight,
  Layers,
  AlertCircle,
  Clock,
  CheckCircle2,
  Building2,
} from "lucide-react";
import type {
  ExecutionPlanTask,
  PlanDependencyEntry,
} from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

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

export function PlanningDependencyGraph({
  tasks = [],
  dependencies = [],
  className = "",
}: PlanningDependencyGraphProps) {
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
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <GitCommit className="w-3 h-3 text-[#D6003C]" />
              Dependency Graph & Blast Radius
            </span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            <span className="text-[10px] font-mono text-slate-400">
              {edges.length} Authoritative Edges
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Directed Acyclic Graph (DAG) Traversal
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Explicit Predecessor &rarr; Successor edges enforcing workflow execution constraints.
          </p>
        </div>
      </div>

      {edges.length > 0 ? (
        /* Visual Edge List */
        <div className="p-5 space-y-3">
          {edges.map((edge, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
            >
              {/* Predecessor (Blocking Node) */}
              <div className="flex-1 min-w-0 p-2.5 rounded bg-slate-50/80 border border-slate-100">
                <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
                  Predecessor (Prerequisite)
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 truncate">
                    {edge.predecessorName}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                      edge.predecessorStatus === "COMPLETED"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {edge.predecessorStatus}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                  ID: {edge.predecessorId}
                </span>
              </div>

              {/* Edge Relation Indicator */}
              <div className="flex items-center justify-center gap-1.5 text-slate-400 shrink-0 px-2 py-1">
                <span className="text-[10px] font-mono font-semibold uppercase text-slate-500">
                  {edge.type || "FS"}
                </span>
                <ArrowRight className="w-4 h-4 text-[#D6003C]" />
                {edge.lagMinutes ? (
                  <span className="text-[10px] font-mono text-slate-500">
                    +{edge.lagMinutes}m
                  </span>
                ) : null}
              </div>

              {/* Successor (Dependent Node) */}
              <div className="flex-1 min-w-0 p-2.5 rounded bg-slate-50/80 border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                  Successor (Dependent)
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 truncate">
                    {edge.successorName}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                      edge.successorStatus === "COMPLETED"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {edge.successorStatus}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                  ID: {edge.successorId}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Truthful Fallback Table when no graph edges are returned */
        <div className="p-6">
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 text-xs text-amber-900 mb-4">
            <span className="font-bold block mb-1">
              Dependency graph unavailable from backend; displaying structured dependency data.
            </span>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              The backend has not exposed explicit predecessor/successor graph edges for this event plan. Showing active tasks and their recorded readiness status.
            </p>
          </div>

          {tasks.length > 0 ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                    <th className="p-3">Task ID</th>
                    <th className="p-3">Task Name</th>
                    <th className="p-3">Readiness</th>
                    <th className="p-3">Critical Path</th>
                    <th className="p-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                  {tasks.map((t) => (
                    <tr key={t.task_id} className="hover:bg-slate-50/50">
                      <td className="p-3 text-slate-400">{t.task_id}</td>
                      <td className="p-3 font-sans font-medium text-slate-900">{t.task_name}</td>
                      <td className="p-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                          {t.readiness_state || t.status}
                        </span>
                      </td>
                      <td className="p-3">
                        {t.is_critical_path ? (
                          <span className="text-rose-600 font-bold">YES</span>
                        ) : (
                          <span className="text-slate-400">NO</span>
                        )}
                      </td>
                      <td className="p-3 text-right">{t.duration_minutes}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-xs text-slate-400 py-6">
              No tasks or dependency data found for this event.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
