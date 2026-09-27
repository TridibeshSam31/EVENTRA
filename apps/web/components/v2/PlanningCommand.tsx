"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
  CalendarCheck,
  CheckSquare,
  Clock,
  DollarSign,
  Activity,
  RotateCcw,
  Sparkles,
  GitCommit,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Layers,
  ArrowRight,
  Zap,
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import {
  getFinalExecutionPlan,
  generateFinalExecutionPlan,
  getPlan,
  generatePlan,
} from "@/lib/api/planning";
import { getSchedule, computeSchedule } from "@/lib/api/schedule";
import { getBudgetSummary, validateBudget } from "@/lib/api/budget";
import { getActivityStream } from "@/lib/api/activityStream";

import type {
  EventResponse,
  FinalExecutionPlan,
  EventPlan,
  ScheduleResponse,
  BudgetSummaryResponse,
  BudgetValidationResponse,
} from "@/types/api";
import type { ActivityLogItem } from "@/types/activityLog";

import { EventBlueprint } from "./EventBlueprint";
import { PlanningReadinessCard } from "./PlanningReadinessCard";
import { TaskCommand } from "./TaskCommand";
import { CriticalPathTimeline } from "./CriticalPathTimeline";
import { PlanningTimeline } from "./PlanningTimeline";
import { BudgetHealthCard } from "./BudgetHealthCard";
import { PlanningDependencyGraph } from "./PlanningDependencyGraph";
import { ProvenanceBadge } from "./ProvenanceBadge";

export type PlanningTab =
  | "OVERVIEW"
  | "TASKS"
  | "SCHEDULE"
  | "CPM"
  | "BUDGET"
  | "DEPENDENCIES";

interface PlanningCommandProps {
  eventId: string;
  initialTab?: PlanningTab;
  className?: string;
}

export function PlanningCommand({
  eventId,
  initialTab = "OVERVIEW",
  className = "",
}: PlanningCommandProps) {
  const [activeTab, setActiveTab] = useState<PlanningTab>(initialTab);

  // Authoritative State from Backend
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [finalPlan, setFinalPlan] = useState<FinalExecutionPlan | null>(null);
  const [rawPlan, setRawPlan] = useState<EventPlan | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummaryResponse | null>(null);
  const [budgetValidation, setBudgetValidation] = useState<BudgetValidationResponse | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync initialTab when route changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Load all planning telemetry concurrently
  const loadPlanningData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setErrorMessage(null);

      const [
        evRes,
        finalPlanRes,
        planRes,
        schedRes,
        budgetRes,
        validRes,
        actRes,
      ] = await Promise.allSettled([
        getEvent(eventId),
        getFinalExecutionPlan(eventId),
        getPlan(eventId),
        getSchedule(eventId),
        getBudgetSummary(eventId),
        validateBudget(eventId),
        getActivityStream(eventId),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }
      if (finalPlanRes.status === "fulfilled" && finalPlanRes.value) {
        setFinalPlan(finalPlanRes.value);
      }
      if (planRes.status === "fulfilled" && planRes.value) {
        setRawPlan(planRes.value);
      }
      if (schedRes.status === "fulfilled" && schedRes.value) {
        setScheduleData(schedRes.value);
      }
      if (budgetRes.status === "fulfilled" && budgetRes.value) {
        setBudgetSummary(budgetRes.value);
      }
      if (validRes.status === "fulfilled" && validRes.value) {
        setBudgetValidation(validRes.value);
      }
      if (actRes.status === "fulfilled" && actRes.value?.items) {
        setActivityLogs(actRes.value.items);
      }
    } catch (err: any) {
      console.error("Failed to load planning data:", err);
      setErrorMessage(err.message || "Failed to load authoritative planning data.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadPlanningData();
  }, [loadPlanningData]);

  // Action: Compile / Refresh Final Execution Plan
  const handleCompileFinalPlan = async () => {
    try {
      setActionInProgress("COMPILE_PLAN");
      setStatusMessage("Compiling topological execution plan with DAG validation...");
      const res = await generateFinalExecutionPlan(eventId);
      setFinalPlan(res);
      setStatusMessage(`Final execution plan v${res.plan_version} compiled successfully.`);
      await loadPlanningData();
    } catch (err: any) {
      console.error("Failed to compile final execution plan:", err);
      setErrorMessage(err.message || "Failed to compile execution plan on backend.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Action: Recompute Schedule
  const handleComputeSchedule = async () => {
    try {
      setActionInProgress("COMPUTE_SCHEDULE");
      setStatusMessage("Recomputing forward-pass schedule and CPM slack...");
      const res = await computeSchedule(eventId);
      setScheduleData(res);
      setStatusMessage("Schedule recomputed successfully.");
      await loadPlanningData();
    } catch (err: any) {
      console.error("Failed to compute schedule:", err);
      setErrorMessage(err.message || "Failed to compute schedule on backend.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Action: Generate Initial Plan
  const handleGeneratePlan = async () => {
    try {
      setActionInProgress("GENERATE_PLAN");
      setStatusMessage("Generating initial operational plan from event specification...");
      const res = await generatePlan(eventId);
      setRawPlan(res);
      setStatusMessage("Operational plan materialized successfully.");
      await loadPlanningData();
    } catch (err: any) {
      console.error("Failed to generate initial plan:", err);
      setErrorMessage(err.message || "Failed to generate plan on backend.");
    } finally {
      setActionInProgress(null);
    }
  };

  const tasks = finalPlan?.tasks || [];
  const readiness = finalPlan?.readiness_status;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Primary Planning Command Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
                <CalendarCheck className="w-3 h-3 text-[#D6003C]" />
                Event Planning Command
              </span>
              <ProvenanceBadge provenance="ENGINE" size="sm" />
              {finalPlan && (
                <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                  Plan v{finalPlan.plan_version}
                </span>
              )}
              {readiness && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                    readiness === "READY"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : readiness === "BLOCKED"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {readiness}
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Blueprint, Critical Path & Operational Plan
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 max-w-3xl leading-relaxed">
              Deterministic topological scheduling, critical path slack monitoring, financial commitments, and execution readiness.
            </p>
          </div>

          {/* Planning Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCompileFinalPlan}
              disabled={!!actionInProgress || loading}
              className="px-3.5 py-2 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {actionInProgress === "COMPILE_PLAN" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>Compile Final Plan</span>
            </button>

            <button
              onClick={handleComputeSchedule}
              disabled={!!actionInProgress || loading}
              className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              {actionInProgress === "COMPUTE_SCHEDULE" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>Compute Schedule</span>
            </button>

            <button
              onClick={loadPlanningData}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
              title="Refresh Planning Telemetry"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Notifications Bar */}
        {statusMessage && (
          <div className="mt-4 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-bold text-emerald-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-[10px] font-bold text-rose-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Operational Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-slate-100 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Tasks</span>
            <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
              {tasks.length}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Critical Path Tasks</span>
            <span className="font-mono font-bold text-rose-600 text-sm mt-0.5 block">
              {finalPlan?.critical_path?.length ?? scheduleData?.critical_path?.critical_path_tasks?.length ?? 0}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Checkpoints</span>
            <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
              {finalPlan?.execution_checkpoints?.length ?? 0}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Blockers</span>
            <span
              className={`font-mono font-bold text-sm mt-0.5 block ${
                (finalPlan?.blockers?.length ?? 0) > 0 ? "text-rose-600" : "text-emerald-700"
              }`}
            >
              {finalPlan?.blockers?.length ?? 0}
            </span>
          </div>
        </div>

        {/* Workspace Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3 border-t border-slate-100 text-xs font-semibold">
          {[
            { id: "OVERVIEW", label: "Overview & Blueprint", icon: FileText },
            { id: "TASKS", label: `Tasks Matrix (${tasks.length})`, icon: CheckSquare },
            { id: "SCHEDULE", label: "Schedule & Timeline", icon: Clock },
            { id: "CPM", label: "Critical Path (CPM)", icon: Activity },
            { id: "BUDGET", label: "Budget & Commitments", icon: DollarSign },
            { id: "DEPENDENCIES", label: "DAG Dependencies", icon: GitCommit },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as PlanningTab)}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  isActive
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: OVERVIEW & BLUEPRINT */}
      {activeTab === "OVERVIEW" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-4">
              <EventBlueprint
                event={eventData}
                summary={finalPlan?.event_summary}
              />
            </div>
            <div className="lg:col-span-4 space-y-4">
              <PlanningReadinessCard
                readinessStatus={finalPlan?.readiness_status}
                blockers={finalPlan?.blockers}
                warnings={finalPlan?.warnings}
                unresolvedUnknowns={finalPlan?.unresolved_unknowns}
                isConsistent={finalPlan?.is_consistent}
                consistencyErrors={finalPlan?.consistency_errors}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CriticalPathTimeline
              criticalPathEntries={finalPlan?.critical_path}
              criticalPathResponse={scheduleData?.critical_path}
              totalDurationMinutes={finalPlan?.total_critical_duration_minutes}
            />
            <BudgetHealthCard
              planBudget={finalPlan?.budget_summary}
              summaryBudget={budgetSummary}
              validation={budgetValidation}
              eventId={eventId}
            />
          </div>
        </div>
      )}

      {/* Tab 2: TASKS MATRIX */}
      {activeTab === "TASKS" && (
        <TaskCommand
          eventId={eventId}
          tasks={tasks}
          onTaskUpdated={loadPlanningData}
        />
      )}

      {/* Tab 3: SCHEDULE & TIMELINE */}
      {activeTab === "SCHEDULE" && (
        <PlanningTimeline
          schedule={scheduleData}
          checkpoints={finalPlan?.execution_checkpoints}
        />
      )}

      {/* Tab 4: CRITICAL PATH (CPM) */}
      {activeTab === "CPM" && (
        <div className="space-y-4">
          <CriticalPathTimeline
            criticalPathEntries={finalPlan?.critical_path}
            criticalPathResponse={scheduleData?.critical_path}
            totalDurationMinutes={finalPlan?.total_critical_duration_minutes}
          />
          <PlanningDependencyGraph
            tasks={tasks}
            dependencies={rawPlan?.dependencies}
          />
        </div>
      )}

      {/* Tab 5: BUDGET */}
      {activeTab === "BUDGET" && (
        <BudgetHealthCard
          planBudget={finalPlan?.budget_summary}
          summaryBudget={budgetSummary}
          validation={budgetValidation}
          eventId={eventId}
        />
      )}

      {/* Tab 6: DAG DEPENDENCIES */}
      {activeTab === "DEPENDENCIES" && (
        <PlanningDependencyGraph
          tasks={tasks}
          dependencies={rawPlan?.dependencies}
        />
      )}
    </div>
  );
}
