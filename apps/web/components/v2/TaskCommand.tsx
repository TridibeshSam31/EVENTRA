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
import { STATUS_CHIP, fmtDuration, fmtSlack, taskStatus } from "./planningFormat";
import { humanizeCode, humanizeCategory, shortId } from "@/lib/humanize";

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
      <div className="surface space-y-3 p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks, providers, or IDs..."
              className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-[12.5px] text-ink-800 transition placeholder:text-ink-400 focus:border-ink-400 focus:bg-[#FDFCFA] focus:outline-none"
            />
          </div>

          {/* Group By Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Group by:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 bg-[#FDFCFA] focus:outline-none"
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
              className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition ${
                filter === btn.id
                  ? "bg-ink-900 text-ink-50 shadow-sm"
                  : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
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
            <div className="flex items-center px-1 pt-1">
              <span className="eyebrow text-ink-600">
                {group.groupName} <span className="text-ink-400">· {group.tasks.length}</span>
              </span>
              <span className="ml-3 h-px flex-1 bg-ink-200" aria-hidden />
            </div>

            <div className="grid grid-cols-1 gap-2">
              {group.tasks.map((task) => {
                const isCritical = task.is_critical_path;
                const isCompleted = task.status.toUpperCase() === "COMPLETED";
                const isInProgress = task.status.toUpperCase() === "IN_PROGRESS";
                const isUpdating = updatingTaskId === task.task_id;

                return (
                  <div
                    key={task.task_id}
                    className={`relative flex flex-col justify-between gap-4 overflow-hidden rounded-xl border bg-[#FDFCFA] p-4 pl-5 shadow-sm transition-all hover:shadow-md md:flex-row md:items-center ${
                      isCompleted
                        ? "border-ink-200 bg-ink-50/60 opacity-75"
                        : isInProgress
                        ? "border-go-300 ring-1 ring-go-100"
                        : isCritical
                        ? "border-cue-200"
                        : "border-ink-200"
                    }`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-1 ${
                        isCompleted ? "bg-go-400" : isInProgress ? "bg-go-500" : isCritical ? "bg-cue-500" : "bg-ink-200"
                      }`}
                      aria-hidden
                    />
                    {/* Left: Task Identity & Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">

                        {isCritical && (
                          <span className="chip border-cue-200 bg-cue-50 text-cue-700">
                            <span className="cue-light bg-cue-500" /> Critical path
                          </span>
                        )}

                        <span className={`chip ${STATUS_CHIP[taskStatus(task.status).tone]}`}>
                          {isInProgress && <span className="cue-light bg-go-500 animate-cue-blink" />}
                          {taskStatus(task.status).label}
                        </span>

                        {task.phase && (
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                            {humanizeCode(task.phase)}
                          </span>
                        )}
                      </div>

                      <h4
                        className={`text-[14px] font-semibold ${
                          isCompleted
                            ? "text-ink-500 line-through decoration-ink-300"
                            : "text-ink-900"
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
                          <span className="inline-flex items-center gap-1.5 font-medium text-standby-700">
                            <span className="cue-light bg-standby-400" /> No vendor yet
                            {task.required_provider_category && (
                              <a
                                href={`/events/${eventId}/${String(task.required_provider_category).toUpperCase() === "VENUE" ? "venue" : `vendors?category=${encodeURIComponent(String(task.required_provider_category).toUpperCase())}`}`}
                                className="ml-1 font-semibold text-ink-800 underline decoration-ink-300 underline-offset-2 hover:text-cue-700"
                              >
                                Find {humanizeCategory(task.required_provider_category).toLowerCase()} vendor
                              </a>
                            )}
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
                        <span className="eyebrow block font-sans">
                          Duration
                        </span>
                        <span className="font-sans font-semibold text-slate-800">
                          {fmtDuration(task.duration_minutes)}
                        </span>
                        {fmtSlack(task.slack_minutes) && (
                          <span className="block font-sans text-[11px] text-slate-400" title={`Task ${shortId(task.task_id)}`}>
                            {fmtSlack(task.slack_minutes)}
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
                            className={`${task.status.toUpperCase() === "IN_PROGRESS" ? "btn bg-go-600 text-white hover:bg-go-700" : "btn-secondary"} h-8`}
                          >
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                            ) : task.status.toUpperCase() === "IN_PROGRESS" ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Mark complete
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5 text-go-600" />
                                Start task
                              </>
                            )}
                          </button>
                        )}

                        {task.status.toUpperCase() === "COMPLETED" && (
                          <button
                            onClick={() => handleStatusChange(task.task_id, "PENDING")}
                            disabled={isUpdating}
                            className="btn-secondary h-8 w-8 px-0"
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-6 py-12 text-center">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-500 shadow-sm">
            <ListTodo className="h-5 w-5" />
          </div>
          <p className="text-[15px] font-semibold text-ink-900">No tasks yet</p>
          <p className="mt-1.5 max-w-[46ch] text-[13px] text-ink-500">
            Compile the final plan and the engine will break your event into tasks, with times and dependencies.
          </p>
        </div>
      )}
    </div>
  );
}
