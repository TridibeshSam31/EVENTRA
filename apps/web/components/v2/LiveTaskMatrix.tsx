"use client";

import React, { useState, useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Zap,
  RotateCcw,
  Search,
  Filter,
  Loader2,
  Layers,
  ArrowRight,
  ShieldCheck,
  Building2,
} from "lucide-react";
import type { TaskProgress } from "@/types/api";
import { updateTaskStatus } from "@/lib/api/live";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface LiveTaskMatrixProps {
  eventId: string;
  tasks: TaskProgress[];
  isPaused?: boolean;
  onTaskUpdated?: () => void;
  className?: string;
}

type LiveFilter = "ALL" | "IN_PROGRESS" | "PENDING" | "DEVIATED" | "CRITICAL" | "COMPLETED";

export function LiveTaskMatrix({
  eventId,
  tasks = [],
  isPaused = false,
  onTaskUpdated,
  className = "",
}: LiveTaskMatrixProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LiveFilter>("ALL");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filter tasks based on search and status
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        t.task_name.toLowerCase().includes(q) ||
        t.task_id.toLowerCase().includes(q) ||
        (t.key || "").toLowerCase().includes(q);

      if (!matchesSearch) return false;

      switch (filter) {
        case "IN_PROGRESS":
          return t.status.toUpperCase() === "IN_PROGRESS";
        case "PENDING":
          return (
            t.status.toUpperCase() === "PENDING" ||
            t.status.toUpperCase() === "READY" ||
            t.status.toUpperCase() === "PLANNED"
          );
        case "DEVIATED":
          return (
            t.deviation_type === "LATE_START" ||
            t.deviation_type === "LATE_FINISH" ||
            t.deviation_minutes > 0
          );
        case "CRITICAL":
          return t.is_critical_path;
        case "COMPLETED":
          return t.status.toUpperCase() === "COMPLETED";
        case "ALL":
        default:
          return true;
      }
    });
  }, [tasks, search, filter]);

  // Handle task status transition via backend API
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    if (isPaused) {
      setActionError("Operations are currently PAUSED. Resume execution before updating tasks.");
      return;
    }

    try {
      setUpdatingTaskId(taskId);
      setActionError(null);
      await updateTaskStatus(eventId, taskId, newStatus);
      if (onTaskUpdated) {
        onTaskUpdated();
      }
    } catch (err: any) {
      console.error("Failed to update task status:", err);
      setActionError(err.message || "Failed to update task status on backend.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-[#D6003C]" />
              Live Task Matrix
            </span>
            <ProvenanceBadge source="ENGINE" size="sm" />
            <span className="text-[10px] font-mono text-slate-400">
              {tasks.length} Operational Tasks
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Live Task Execution & Variance Tracking
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time schedule variance, critical path execution, and state propagation.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#D6003C]"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-5 py-2.5 bg-slate-50/30 border-b border-slate-100 flex flex-wrap items-center gap-1 text-xs">
        {[
          { id: "ALL", label: `All (${tasks.length})` },
          { id: "IN_PROGRESS", label: "In Progress" },
          { id: "PENDING", label: "Pending / Ready" },
          { id: "DEVIATED", label: "Deviated / Late" },
          { id: "CRITICAL", label: "Critical Path" },
          { id: "COMPLETED", label: "Completed" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as LiveFilter)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              filter === tab.id
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="m-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-[10px] font-bold text-rose-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table of Tasks */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <th className="p-3 pl-5">Task</th>
              <th className="p-3">Status</th>
              <th className="p-3">Planned Window</th>
              <th className="p-3">Actual Timing</th>
              <th className="p-3">Variance / Deviation</th>
              <th className="p-3 text-right pr-5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
            {filteredTasks.map((t) => {
              const isUpdating = updatingTaskId === t.task_id;
              const isCompleted = t.status.toUpperCase() === "COMPLETED";
              const isInProgress = t.status.toUpperCase() === "IN_PROGRESS";
              const isLate =
                t.deviation_type === "LATE_START" ||
                t.deviation_type === "LATE_FINISH" ||
                t.deviation_minutes > 0;

              return (
                <tr
                  key={t.task_id}
                  className={`hover:bg-slate-50/50 transition-colors ${
                    t.is_critical_path && !isCompleted ? "bg-rose-50/15" : ""
                  }`}
                >
                  {/* Task Identity */}
                  <td className="p-3 pl-5 font-sans font-medium text-slate-900 max-w-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{t.task_name}</span>
                      {t.is_critical_path && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                          CPM
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 block">
                      {t.task_id}
                    </span>
                  </td>

                  {/* Status Badge */}
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        isCompleted
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : isInProgress
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>

                  {/* Planned Window */}
                  <td className="p-3 text-slate-600">
                    <div>
                      {t.planned_start
                        ? new Date(t.planned_start).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "TBD"}{" "}
                      &rarr;{" "}
                      {t.planned_end
                        ? new Date(t.planned_end).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "TBD"}
                    </div>
                  </td>

                  {/* Actual Timing */}
                  <td className="p-3 text-slate-600">
                    {t.actual_start ? (
                      <span className="text-slate-800">
                        Started:{" "}
                        {new Date(t.actual_start).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-400">Not Started</span>
                    )}
                  </td>

                  {/* Deviation */}
                  <td className="p-3">
                    {isLate ? (
                      <span className="text-rose-600 font-bold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        +{t.deviation_minutes}m ({t.deviation_type || "LATE"})
                      </span>
                    ) : t.deviation_type === "EARLY_FINISH" ? (
                      <span className="text-emerald-700 font-medium">Early Finish</span>
                    ) : (
                      <span className="text-slate-400 font-sans">On Track</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="p-3 pr-5 text-right font-sans">
                    {!isCompleted ? (
                      <button
                        onClick={() =>
                          handleStatusChange(
                            t.task_id,
                            isInProgress ? "COMPLETED" : "IN_PROGRESS"
                          )
                        }
                        disabled={isUpdating || isPaused}
                        className="px-2.5 py-1 rounded-md text-xs font-bold transition border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                        ) : isInProgress ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Complete</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3 h-3 text-blue-600" />
                            <span>Start</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange(t.task_id, "PENDING")}
                        disabled={isUpdating || isPaused}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 transition"
                        title="Reset task status"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredTasks.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-400 font-sans">
            No tasks match the active filter criteria.
          </div>
        )}
      </div>
    </div>
  );
}
