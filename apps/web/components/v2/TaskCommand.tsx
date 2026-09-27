"use client";

import React, { useState, useMemo } from "react";
import {
  CheckSquare,
  ListTodo,
  Zap,
  Activity,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
  Layers,
  ChevronDown,
  Loader2,
  GitCommit,
  RotateCcw,
} from "lucide-react";
import type { ExecutionPlanTask } from "@/types/api";
import { updateTaskStatus } from "@/lib/api/live";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface TaskCommandProps {
  eventId: string;
  tasks: ExecutionPlanTask[];
  onTaskUpdated?: () => void;
  className?: string;
}

type FilterOption =
  | "ALL"
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CRITICAL_PATH"
  | "ASSIGNED"
  | "BLOCKED";

type GroupByOption = "NONE" | "PHASE" | "STATUS" | "CRITICAL_PATH";

export function TaskCommand({
  eventId,
  tasks = [],
  onTaskUpdated,
  className = "",
}: TaskCommandProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("ALL");
  const [groupBy, setGroupBy] = useState<GroupByOption>("STATUS");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Filter tasks based on search and status
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Search match
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        t.task_name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.assigned_provider_name || "").toLowerCase().includes(q) ||
        t.task_id.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      // Status / attribute filter
      switch (filter) {
        case "PENDING":
          return (
            t.status.toUpperCase() === "PENDING" ||
            t.status.toUpperCase() === "READY" ||
            t.status.toUpperCase() === "PLANNED"
          );
        case "IN_PROGRESS":
          return t.status.toUpperCase() === "IN_PROGRESS";
        case "COMPLETED":
          return t.status.toUpperCase() === "COMPLETED";
        case "CRITICAL_PATH":
          return t.is_critical_path;
        case "ASSIGNED":
          return t.is_assigned || !!t.assigned_provider_name;
        case "BLOCKED":
          return (
            t.readiness_state?.toUpperCase() === "BLOCKED" ||
            t.status.toUpperCase() === "BLOCKED"
          );
        case "ALL":
        default:
          return true;
      }
    });
  }, [tasks, search, filter]);

  // Grouping structure
  const groupedTasks = useMemo(() => {
    if (groupBy === "NONE") {
      return [{ groupName: "All Filtered Tasks", tasks: filteredTasks }];
    }

    if (groupBy === "STATUS") {
      const pending = filteredTasks.filter(
        (t) =>
          t.status.toUpperCase() === "PENDING" ||
          t.status.toUpperCase() === "READY" ||
          t.status.toUpperCase() === "PLANNED"
      );
      const inProgress = filteredTasks.filter(
        (t) => t.status.toUpperCase() === "IN_PROGRESS"
      );
      const completed = filteredTasks.filter(
        (t) => t.status.toUpperCase() === "COMPLETED"
      );
      const blocked = filteredTasks.filter(
        (t) =>
          t.status.toUpperCase() === "BLOCKED" ||
          t.readiness_state?.toUpperCase() === "BLOCKED"
      );

      return [
        { groupName: "In Progress (Active)", tasks: inProgress },
        { groupName: "Upcoming / Pending", tasks: pending },
        { groupName: "Completed", tasks: completed },
        ...(blocked.length > 0
          ? [{ groupName: "Blocked Tasks", tasks: blocked }]
          : []),
      ];
    }

    if (groupBy === "CRITICAL_PATH") {
      const critical = filteredTasks.filter((t) => t.is_critical_path);
      const nonCritical = filteredTasks.filter((t) => !t.is_critical_path);
      return [
        { groupName: "Critical Path (Zero Slack)", tasks: critical },
        { groupName: "Non-Critical Tasks", tasks: nonCritical },
      ];
    }

    if (groupBy === "PHASE") {
      const phaseMap = new Map<string, ExecutionPlanTask[]>();
      filteredTasks.forEach((t) => {
        const ph = t.phase || "General Operational Phase";
        if (!phaseMap.has(ph)) phaseMap.set(ph, []);
        phaseMap.get(ph)!.push(t);
      });
      return Array.from(phaseMap.entries()).map(([groupName, groupTasks]) => ({
        groupName,
        tasks: groupTasks,
      }));
    }

    return [{ groupName: "Tasks", tasks: filteredTasks }];
  }, [filteredTasks, groupBy]);

  // Handle authoritative status update via backend
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      setUpdatingTaskId(taskId);
      setStatusError(null);
      await updateTaskStatus(eventId, taskId, newStatus);
      if (onTaskUpdated) {
        onTaskUpdated();
      }
    } catch (err: any) {
      console.error("Failed to update task status:", err);
      setStatusError(err.message || "Failed to update task status on backend.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks, providers, or IDs..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#D6003C] transition"
            />
          </div>

          {/* Group By Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Group by:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 bg-white focus:outline-none"
            >
              <option value="STATUS">Operational Status</option>
              <option value="CRITICAL_PATH">Critical Path</option>
              <option value="PHASE">Phase</option>
              <option value="NONE">None</option>
            </select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
          {[
            { id: "ALL", label: `All (${tasks.length})` },
            { id: "IN_PROGRESS", label: "In Progress" },
            { id: "PENDING", label: "Upcoming / Pending" },
            { id: "CRITICAL_PATH", label: "Critical Path" },
            { id: "ASSIGNED", label: "Provider-Linked" },
            { id: "BLOCKED", label: "Blocked" },
            { id: "COMPLETED", label: "Completed" },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilter(btn.id as FilterOption)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filter === btn.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {statusError && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span>{statusError}</span>
            <button
              onClick={() => setStatusError(null)}
              className="text-[10px] font-bold text-rose-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Grouped Task Cards */}
      {groupedTasks.map((group, groupIdx) => {
        if (group.tasks.length === 0) return null;

        return (
          <div key={groupIdx} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {group.groupName} ({group.tasks.length})
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {group.tasks.map((task) => {
                const isCritical = task.is_critical_path;
                const isCompleted = task.status.toUpperCase() === "COMPLETED";
                const isInProgress = task.status.toUpperCase() === "IN_PROGRESS";
                const isUpdating = updatingTaskId === task.task_id;

                return (
                  <div
                    key={task.task_id}
                    className={`bg-white border rounded-xl p-4 shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      isCompleted
                        ? "border-slate-200/80 bg-slate-50/50 opacity-80"
                        : isInProgress
                        ? "border-blue-200 bg-white ring-1 ring-blue-100"
                        : isCritical
                        ? "border-rose-200 bg-white"
                        : "border-slate-200"
                    }`}
                  >
                    {/* Left: Task Identity & Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {task.task_id}
                        </span>

                        {isCritical && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                            <Activity className="w-2.5 h-2.5" /> Critical Path
                          </span>
                        )}

                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                            isCompleted
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : isInProgress
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {task.status}
                        </span>

                        {task.phase && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-500 bg-slate-100">
                            {task.phase}
                          </span>
                        )}
                      </div>

                      <h4
                        className={`text-sm font-semibold ${
                          isCompleted
                            ? "line-through text-slate-500"
                            : "text-slate-900"
                        }`}
                      >
                        {task.task_name}
                      </h4>

                      {task.description && (
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      {/* Provider & Dependencies Info */}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-500">
                        {task.assigned_provider_name ? (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            <Building2 className="w-3.5 h-3.5 text-slate-400" />
                            {task.assigned_provider_name}
                          </span>
                        ) : (
                          <span className="text-amber-600 font-medium">
                            Unassigned Provider
                          </span>
                        )}

                        {task.predecessors && task.predecessors.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <GitCommit className="w-3.5 h-3.5 text-slate-400" />
                            Predecessors: {task.predecessors.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Telemetry & Actions */}
                    <div className="flex items-center gap-3 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                      <div className="text-left md:text-right text-xs font-mono">
                        <span className="text-[9px] uppercase font-bold text-slate-400 block font-sans">
                          Duration
                        </span>
                        <span className="font-semibold text-slate-800">
                          {task.duration_minutes}m
                        </span>
                        {task.slack_minutes != null && (
                          <span className="text-[10px] text-slate-400 block">
                            Slack: {task.slack_minutes}m
                          </span>
                        )}
                      </div>

                      {/* Status Mutation Controls */}
                      <div className="flex items-center gap-1">
                        {task.status.toUpperCase() !== "COMPLETED" && (
                          <button
                            onClick={() =>
                              handleStatusChange(
                                task.task_id,
                                task.status.toUpperCase() === "IN_PROGRESS"
                                  ? "COMPLETED"
                                  : "IN_PROGRESS"
                              )
                            }
                            disabled={isUpdating}
                            className="px-3 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 border-slate-200 hover:bg-slate-50 text-slate-700"
                          >
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                            ) : task.status.toUpperCase() === "IN_PROGRESS" ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                Mark Complete
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5 text-blue-600" />
                                Start Task
                              </>
                            )}
                          </button>
                        )}

                        {task.status.toUpperCase() === "COMPLETED" && (
                          <button
                            onClick={() => handleStatusChange(task.task_id, "PENDING")}
                            disabled={isUpdating}
                            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition"
                            title="Reset to Pending"
                          >
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {tasks.length === 0 && (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-xl text-slate-500 text-xs">
          <ListTodo className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="font-semibold text-slate-700">No planning tasks have been created.</p>
          <p className="text-slate-400 mt-1">
            Generate an operational plan or compile the final execution plan to materialize tasks.
          </p>
        </div>
      )}
    </div>
  );
}
