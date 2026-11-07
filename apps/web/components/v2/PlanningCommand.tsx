"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
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
  ArrowRight,
  Lightbulb,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

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
import { AnimatedNumber } from "@/components/ds/motion";

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
  /** "budget" renders a focused budget view (same data sources) instead of the full plan */
  mode?: "plan" | "budget";
}

export function PlanningCommand({
  eventId,
  initialTab = "OVERVIEW",
  className = "",
  mode = "plan",
}: PlanningCommandProps) {
  const reduceMotion = useReducedMotion();
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
      setStatusMessage("Compiling the plan and re-checking every dependency…");
      const res = await generateFinalExecutionPlan(eventId);
      setFinalPlan(res);
      setStatusMessage(`Plan version ${res.plan_version} compiled.`);
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
      setStatusMessage("Working out times and the critical path…");
      const res = await computeSchedule(eventId);
      setScheduleData(res);
      setStatusMessage("Schedule updated.");
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
  void handleGeneratePlan;
  void activityLogs;

  const tasks = finalPlan?.tasks || [];
  const readiness = finalPlan?.readiness_status;

  const criticalCount =
    finalPlan?.critical_path?.length ?? scheduleData?.critical_path?.critical_path_tasks?.length ?? 0;
  const blockerCount = finalPlan?.blockers?.length ?? 0;
  const readinessTone =
    readiness === "READY"
      ? "border-go-200 bg-go-50 text-go-700"
      : readiness === "BLOCKED"
      ? "border-cue-200 bg-cue-50 text-cue-700"
      : "border-standby-200 bg-standby-50 text-standby-800";
  const readinessDot =
    readiness === "READY" ? "bg-go-500" : readiness === "BLOCKED" ? "bg-cue-600 animate-cue-blink" : "bg-standby-500";

  const TABS: Array<{ id: PlanningTab; label: string; count?: number; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "OVERVIEW", label: "Blueprint", icon: FileText },
    { id: "TASKS", label: "Tasks", count: tasks.length, icon: CheckSquare },
    { id: "SCHEDULE", label: "Run of show", icon: Clock },
    { id: "CPM", label: "Critical path", count: criticalCount, icon: Activity },
    { id: "BUDGET", label: "Budget", icon: DollarSign },
    { id: "DEPENDENCIES", label: "Dependencies", icon: GitCommit },
  ];

  const readouts = [
    { label: "Tasks", value: tasks.length, cls: "text-ink-900" },
    { label: "On critical path", value: criticalCount, cls: criticalCount ? "text-cue-700" : "text-ink-900" },
    { label: "Checkpoints", value: finalPlan?.execution_checkpoints?.length ?? 0, cls: "text-ink-900" },
    { label: "Blockers", value: blockerCount, cls: blockerCount > 0 ? "text-cue-700" : "text-go-700" },
  ];

  // What should the user press next? Derived only from what the backend returned.
  const scheduleEntries = (scheduleData as { entries?: unknown[] } | null)?.entries;
  const hasSchedule = Boolean((scheduleEntries && scheduleEntries.length > 0) || scheduleData?.critical_path);
  type NextKey = "compile" | "resolve" | "schedule" | "done";
  const nextStep: { key: NextKey; title: string; body: string } = !finalPlan
    ? {
        key: "compile",
        title: "compile the plan",
        body: "It turns your tasks into a checked plan: vendors, budget, dependencies and anything blocking.",
      }
    : blockerCount > 0
    ? {
        key: "resolve",
        title: `clear ${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}, then compile again`,
        body: "Most blockers are tasks without a vendor — use “Find a vendor” on each one below.",
      }
    : !hasSchedule
    ? {
        key: "schedule",
        title: "compute the schedule",
        body: "It works out start and end times and which tasks have no room for delay.",
      }
    : {
        key: "done",
        title: "nothing — the plan is up to date",
        body: "Compile again whenever you change tasks, vendors or the budget.",
      };

  const btnFor = (k: "compile" | "schedule") => (nextStep.key === k ? "btn-cue" : "btn-secondary");

  const statusBanners = (statusMessage || errorMessage) && (
    <div className="space-y-2 px-5 pb-4">
      {statusMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-go-200 bg-go-50 px-3 py-2 text-[12.5px] text-go-800"
        >
          <span className="flex items-center gap-2">
            <span className="cue-light bg-go-500" /> {statusMessage}
          </span>
          <button onClick={() => setStatusMessage(null)} className="text-[11px] font-semibold text-go-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-cue-200 bg-cue-50 px-3 py-2 text-[12.5px] text-cue-800"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" /> {errorMessage}
          </span>
          <button onClick={() => setErrorMessage(null)} className="text-[11px] font-semibold text-cue-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );

  /* ── Focused budget view (/budget) ─────────────────────────── */
  if (mode === "budget") {
    return (
      <div className={`space-y-5 ${className}`}>
        <section className="surface overflow-hidden">
          <div className="flex flex-col justify-between gap-4 px-5 py-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="eyebrow">Budget</span>
                <ProvenanceBadge provenance="ENGINE" size="sm" />
              </div>
              <h2
                className="font-display text-[26px] font-extrabold leading-[1.02] tracking-[-0.025em] text-ink-900"
                style={{ fontStretch: "88%" }}
              >
                What you&apos;ve committed, and what&apos;s left
              </h2>
              <p className="mt-1 text-[13px] text-ink-600">Figures come from the budget engine for this event.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={loadPlanningData}
                disabled={loading}
                className="btn-ghost h-9 w-9 px-0"
                title="Reload budget figures"
                aria-label="Refresh budget"
              >
                <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <Link href={`/events/${eventId}/plan`} className="btn-secondary">
                Open the full plan <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          {statusBanners}
        </section>

        {loading && !finalPlan && !budgetSummary ? (
          <div className="space-y-3" aria-label="Loading budget">
            <div className="workspace-shimmer h-28 rounded-xl" />
            <div className="workspace-shimmer h-40 rounded-xl" />
          </div>
        ) : (
          <BudgetHealthCard
            planBudget={finalPlan?.budget_summary}
            summaryBudget={budgetSummary}
            validation={budgetValidation}
            eventId={eventId}
            variant="full"
          />
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Planning header */}
      <section className="surface overflow-hidden">
        <div className="flex flex-col justify-between gap-5 px-5 pb-4 pt-5 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="eyebrow">Event plan</span>
              <ProvenanceBadge provenance="ENGINE" size="sm" />
              {finalPlan && (
                <span
                  className="rounded border border-ink-200 bg-ink-50 px-1.5 py-px font-mono text-[10.5px] text-ink-600"
                  title="Plan version"
                >
                  v{finalPlan.plan_version}
                </span>
              )}
              {readiness && (
                <span className={`chip ${readinessTone}`}>
                  <span className={`cue-light ${readinessDot}`} />
                  {String(readiness).toLowerCase().replace(/_/g, " ")}
                </span>
              )}
            </div>
            <h2
              className="font-display text-[26px] font-extrabold leading-[1.02] tracking-[-0.025em] text-ink-900"
              style={{ fontStretch: "88%" }}
            >
              Blueprint, critical path &amp; run of show
            </h2>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">
              Every time, dependency and cost here is calculated by the planning engine from your tasks. Nothing is guessed.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
            <button
              onClick={loadPlanningData}
              disabled={loading}
              className="btn-ghost h-9 w-9 px-0"
              title="Reload the plan from the server"
              aria-label="Refresh plan"
            >
              <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handleComputeSchedule}
              disabled={!!actionInProgress || loading}
              className={btnFor("schedule")}
              title="Works out start/end times and the critical path from task durations and dependencies."
            >
              {actionInProgress === "COMPUTE_SCHEDULE" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              Compute schedule
            </button>
            <button
              onClick={handleCompileFinalPlan}
              disabled={!!actionInProgress || loading}
              className={btnFor("compile")}
              title="Re-checks every task, vendor, budget and dependency, and saves a new plan version."
            >
              {actionInProgress === "COMPILE_PLAN" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Compile plan
            </button>
          </div>
        </div>

        {/* Next-step guidance */}
        {!loading && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-5 mb-4 flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50/60 px-3.5 py-2.5"
          >
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                nextStep.key === "done"
                  ? "bg-go-500 text-white"
                  : nextStep.key === "resolve"
                  ? "bg-cue-600 text-white"
                  : "bg-ink-900 text-ink-50"
              }`}
            >
              {nextStep.key === "done" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 text-[12.5px] leading-relaxed">
              <span className="font-semibold text-ink-900">Next: {nextStep.title}. </span>
              <span className="text-ink-600">{nextStep.body}</span>
              <span className="mt-0.5 block text-[11.5px] text-ink-400">
                <b className="font-semibold text-ink-500">Compute schedule</b> sets times and the critical path ·{" "}
                <b className="font-semibold text-ink-500">Compile plan</b> re-checks everything and saves a new version.
              </span>
            </div>
          </motion.div>
        )}

        {statusBanners}

        {/* Readouts */}
        <div className="grid grid-cols-2 gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-4">
          {readouts.map((m) => (
            <div key={m.label} className="bg-[#FDFCFA] px-5 py-3">
              <div className="eyebrow">{m.label}</div>
              <div
                className={`mt-1 font-display text-[24px] font-bold leading-none tabular-nums ${m.cls}`}
                style={{ fontStretch: "90%" }}
              >
                <AnimatedNumber value={m.value} />
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <nav
          className="flex gap-1 overflow-x-auto border-t border-ink-200 bg-ink-50/60 px-3"
          role="tablist"
          aria-label="Plan views"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-[12.5px] font-semibold transition ${
                  isActive ? "text-ink-900" : "text-ink-500 hover:text-ink-800"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-cue-600" : ""}`} />
                {tab.label}
                {typeof tab.count === "number" && (
                  <span className={`font-mono text-[10.5px] ${isActive ? "text-cue-600" : "text-ink-400"}`}>{tab.count}</span>
                )}
                {isActive && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : "plan-tab-underline"}
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink-900"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </nav>
      </section>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={{ duration: 0.26, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {/* Tab 1: OVERVIEW & BLUEPRINT */}
          {activeTab === "OVERVIEW" && (
            <div className="space-y-5">
              <PlanningReadinessCard
                readinessStatus={finalPlan?.readiness_status}
                blockers={finalPlan?.blockers}
                warnings={finalPlan?.warnings}
                unresolvedUnknowns={finalPlan?.unresolved_unknowns}
                isConsistent={finalPlan?.is_consistent}
                consistencyErrors={finalPlan?.consistency_errors}
                tasks={tasks}
                eventId={eventId}
                layout="wide"
              />

              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <EventBlueprint event={eventData} summary={finalPlan?.event_summary} />
                  <BudgetHealthCard
                    planBudget={finalPlan?.budget_summary}
                    summaryBudget={budgetSummary}
                    validation={budgetValidation}
                    eventId={eventId}
                    variant="compact"
                  />
                </div>
                <CriticalPathTimeline
                  criticalPathEntries={finalPlan?.critical_path}
                  criticalPathResponse={scheduleData?.critical_path}
                  totalDurationMinutes={finalPlan?.total_critical_duration_minutes}
                />
              </div>
            </div>
          )}

          {/* Tab 2: TASKS MATRIX */}
          {activeTab === "TASKS" && <TaskCommand eventId={eventId} tasks={tasks} onTaskUpdated={loadPlanningData} />}

          {/* Tab 3: SCHEDULE & TIMELINE */}
          {activeTab === "SCHEDULE" && (
            <PlanningTimeline schedule={scheduleData} checkpoints={finalPlan?.execution_checkpoints} />
          )}

          {/* Tab 4: CRITICAL PATH (CPM) */}
          {activeTab === "CPM" && (
            <div className="space-y-5">
              <CriticalPathTimeline
                criticalPathEntries={finalPlan?.critical_path}
                criticalPathResponse={scheduleData?.critical_path}
                totalDurationMinutes={finalPlan?.total_critical_duration_minutes}
              />
              <PlanningDependencyGraph tasks={tasks} dependencies={rawPlan?.dependencies} />
            </div>
          )}

          {/* Tab 5: BUDGET */}
          {activeTab === "BUDGET" && (
            <BudgetHealthCard
              planBudget={finalPlan?.budget_summary}
              summaryBudget={budgetSummary}
              validation={budgetValidation}
              eventId={eventId}
              variant="full"
            />
          )}

          {/* Tab 6: DAG DEPENDENCIES */}
          {activeTab === "DEPENDENCIES" && <PlanningDependencyGraph tasks={tasks} dependencies={rawPlan?.dependencies} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
