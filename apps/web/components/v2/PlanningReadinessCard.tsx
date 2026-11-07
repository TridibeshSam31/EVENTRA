"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldAlert,
  Info,
  ChevronDown,
  Search,
  Building2,
} from "lucide-react";
import type {
  PlanReadiness,
  PlanBlocker,
  PlanWarning,
  UnresolvedUnknown,
  ExecutionPlanTask,
} from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { AnimatePresence, AnimatedNumber, PresenceItem, StaggerList } from "@/components/ds/motion";
import { humanizeCode, shortId } from "@/lib/humanize";
import { categoryForIssue, categoryLabel, findVendorHref, taskNameFromMessage } from "./planningFormat";

interface PlanningReadinessCardProps {
  readinessStatus?: PlanReadiness | string | null;
  blockers?: PlanBlocker[];
  warnings?: PlanWarning[];
  unresolvedUnknowns?: UnresolvedUnknown[];
  isConsistent?: boolean;
  consistencyErrors?: string[];
  className?: string;
  /** plan tasks — used to work out each blocker's category so it can link to the fix */
  tasks?: ExecutionPlanTask[];
  /** when given, every blocker/warning gets a "Find a vendor" action */
  eventId?: string;
  /** "wide" puts the gate summary beside the issue list (Blueprint tab) */
  layout?: "stack" | "wide";
}

type Issue = (PlanBlocker | PlanWarning) & { kind: "blocker" | "warning" };

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode; desc: string }> = {
  READY: {
    label: "Ready to run",
    cls: "border-go-200 bg-go-50 text-go-700",
    icon: <CheckCircle2 className="h-4 w-4 text-go-600" />,
    desc: "Every critical task has a vendor, the schedule works and the budget holds.",
  },
  PARTIALLY_READY: {
    label: "Partly ready",
    cls: "border-standby-200 bg-standby-50 text-standby-800",
    icon: <AlertTriangle className="h-4 w-4 text-standby-600" />,
    desc: "The plan can run, but some non-critical tasks or facts still need you.",
  },
  BLOCKED: {
    label: "Blocked",
    cls: "border-cue-200 bg-cue-50 text-cue-700",
    icon: <XCircle className="h-4 w-4 text-cue-600" />,
    desc: "Something on the critical path is missing — usually a vendor. Clear the items listed here.",
  },
  INCOMPLETE: {
    label: "Incomplete",
    cls: "border-ink-300 bg-ink-100 text-ink-700",
    icon: <HelpCircle className="h-4 w-4 text-ink-600" />,
    desc: "Key event details or tasks haven't been created yet.",
  },
};

function IssueRow({ issue, eventId, category }: { issue: Issue; eventId?: string; category: string | null }) {
  const isBlocker = issue.kind === "blocker";
  const taskName = taskNameFromMessage(issue.message);
  const [showTech, setShowTech] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isBlocker ? "bg-cue-600" : "bg-standby-500"}`}
          aria-hidden
        />
        <div className="min-w-0">
          {taskName && <div className="text-[13px] font-semibold text-ink-900">{taskName}</div>}
          <p className={`text-[12.5px] leading-snug ${taskName ? "text-ink-600" : "text-ink-800"}`}>{issue.message}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]">
            <span className={isBlocker ? "font-semibold text-cue-700" : "font-semibold text-standby-700"}>
              {humanizeCode(issue.reason_code, isBlocker ? "Blocker" : "Warning")}
            </span>
            {issue.task_id && (
              <button
                type="button"
                onClick={() => setShowTech((v) => !v)}
                className="text-ink-400 underline decoration-dotted underline-offset-2 hover:text-ink-700"
                aria-expanded={showTech}
              >
                {showTech ? "Hide details" : "Details"}
              </button>
            )}
            {showTech && issue.task_id && (
              <span className="font-mono text-ink-400" title={issue.task_id}>
                task {shortId(issue.task_id)}
              </span>
            )}
          </div>
        </div>
      </div>
      {eventId && (
        <Link
          href={findVendorHref(eventId, category)}
          className={`${isBlocker ? "btn-primary" : "btn-secondary"} h-8 shrink-0 self-start px-3 text-[12px] sm:self-center`}
        >
          {category === "VENUE" ? <Building2 className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
          {category === "VENUE" ? "Find a venue" : "Find a vendor"}
        </Link>
      )}
    </div>
  );
}

function groupByCategory(issues: Issue[], tasksById: Map<string, ExecutionPlanTask>) {
  const groups = new Map<string, { category: string | null; items: Issue[] }>();
  for (const issue of issues) {
    const cat = categoryForIssue(issue, tasksById);
    const key = cat ?? "__other";
    if (!groups.has(key)) groups.set(key, { category: cat, items: [] });
    groups.get(key)!.items.push(issue);
  }
  return Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length);
}

function IssueGroups({
  issues,
  tasksById,
  eventId,
  tone,
}: {
  issues: Issue[];
  tasksById: Map<string, ExecutionPlanTask>;
  eventId?: string;
  tone: "cue" | "standby";
}) {
  const groups = groupByCategory(issues, tasksById);
  return (
    <StaggerList className="space-y-3">
      {groups.map((g) => (
        <div
          key={g.category ?? "other"}
          className={`overflow-hidden rounded-xl border ${tone === "cue" ? "border-cue-200/80" : "border-standby-200/80"} bg-[#FDFCFA]`}
        >
          <div className={`flex items-center justify-between px-3.5 py-2 ${tone === "cue" ? "bg-cue-50/50" : "bg-standby-50/50"}`}>
            <span className="text-[12.5px] font-semibold text-ink-900">{categoryLabel(g.category)}</span>
            <span className={`font-mono text-[11px] ${tone === "cue" ? "text-cue-700" : "text-standby-700"}`}>
              {g.items.length} {g.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="divide-y divide-dashed divide-ink-200">
            <AnimatePresence initial={false}>
              {g.items.map((issue) => (
                <PresenceItem key={`${issue.kind}-${issue.reason_code}-${issue.task_id ?? issue.message}`}>
                  <IssueRow issue={issue} eventId={eventId} category={g.category} />
                </PresenceItem>
              ))}
            </AnimatePresence>
          </div>
        </div>
      ))}
    </StaggerList>
  );
}

export function PlanningReadinessCard({
  readinessStatus,
  blockers = [],
  warnings = [],
  unresolvedUnknowns = [],
  isConsistent = true,
  consistencyErrors = [],
  className = "",
  tasks = [],
  eventId,
  layout = "stack",
}: PlanningReadinessCardProps) {
  const [showWarnings, setShowWarnings] = useState(false);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.task_id, t])), [tasks]);

  if (!readinessStatus) {
    return (
      <div className={`rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 p-6 text-center ${className}`}>
        <HelpCircle className="mx-auto mb-2 h-5 w-5 text-ink-400" />
        <p className="text-[13.5px] font-semibold text-ink-800">Readiness not calculated yet</p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">Compile the plan to see what&apos;s holding it back.</p>
      </div>
    );
  }

  const statusKey = String(readinessStatus).toUpperCase();
  const config = STATUS_CONFIG[statusKey] || {
    label: humanizeCode(statusKey),
    cls: "border-ink-200 bg-ink-100 text-ink-700",
    icon: <Info className="h-4 w-4 text-ink-600" />,
    desc: "Readiness as calculated by the planning engine.",
  };

  const blockerIssues: Issue[] = blockers.map((b) => ({ ...b, kind: "blocker" }));
  const warningIssues: Issue[] = warnings.map((w) => ({ ...w, kind: "warning" }));
  const nothingWrong =
    blockers.length === 0 && warnings.length === 0 && unresolvedUnknowns.length === 0 && consistencyErrors.length === 0;

  const counters = [
    { label: "Blockers", value: blockers.length, tone: blockers.length > 0 ? "text-cue-600" : "text-ink-800" },
    { label: "Warnings", value: warnings.length, tone: warnings.length > 0 ? "text-standby-600" : "text-ink-800" },
    { label: "Unknowns", value: unresolvedUnknowns.length, tone: "text-ink-800" },
  ];

  const gate = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Can this plan run?</span>
        <ProvenanceBadge provenance="ENGINE" size="sm" />
        {!isConsistent && <span className="chip border-cue-200 bg-cue-50 text-cue-700">Inconsistent</span>}
      </div>
      <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[14px] font-semibold ${config.cls}`}>
        {config.icon}
        {config.label}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-500">{config.desc}</p>
      <div className="grid grid-cols-3 divide-x divide-ink-200 overflow-hidden rounded-lg border border-ink-200 bg-[#FDFCFA]">
        {counters.map((c) => (
          <div key={c.label} className="px-3 py-2">
            <div className="eyebrow text-[9.5px]">{c.label}</div>
            <div className={`mt-0.5 font-display text-[22px] font-bold leading-none ${c.tone}`} style={{ fontStretch: "90%" }}>
              <AnimatedNumber value={c.value} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const extras = (
    <>
      {unresolvedUnknowns.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-700">
            <Info className="h-3.5 w-3.5 text-ink-500" />
            Still unknown ({unresolvedUnknowns.length})
          </h4>
          <ul className="grid grid-cols-1 gap-2">
            {unresolvedUnknowns.map((u, idx) => (
              <li key={idx} className="rounded-lg border border-dashed border-ink-300 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-ink-900">? {humanizeCode(u.field)}</span>
                  {u.is_critical && <span className="chip border-cue-200 bg-cue-50 text-cue-700">Critical</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-500">{u.description}</p>
                {u.category && <span className="mt-1 block text-[11px] text-ink-400">{humanizeCode(u.category)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {consistencyErrors.length > 0 && (
        <section className="rounded-lg border border-cue-300 bg-cue-50/60 p-3 text-[12.5px] text-cue-900">
          <span className="mb-1 block font-semibold">Dependency problems in the plan</span>
          <ul className="list-inside list-disc space-y-0.5 text-[12px]">
            {consistencyErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  const issues = (
    <div className="space-y-5">
      {blockerIssues.length > 0 && (
        <section>
          <h4 className="mb-2.5 flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
            <ShieldAlert className="h-4 w-4 text-cue-600" />
            Clear these to unblock the plan
            <span className="font-mono text-[11.5px] font-medium text-cue-600">{blockerIssues.length}</span>
          </h4>
          <IssueGroups issues={blockerIssues} tasksById={tasksById} eventId={eventId} tone="cue" />
        </section>
      )}

      {warningIssues.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowWarnings((v) => !v)}
            aria-expanded={showWarnings}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-standby-200 bg-standby-50/50 px-3.5 py-2.5 text-left transition hover:bg-standby-50"
          >
            <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold text-standby-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warningIssues.length} {warningIssues.length === 1 ? "warning" : "warnings"}
              <span className="font-normal text-standby-700">— won&apos;t stop the plan, worth a look</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-standby-700 transition-transform ${showWarnings ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {showWarnings && (
              <PresenceItem>
                <div className="pt-3">
                  <IssueGroups issues={warningIssues} tasksById={tasksById} eventId={eventId} tone="standby" />
                </div>
              </PresenceItem>
            )}
          </AnimatePresence>
        </section>
      )}

      {nothingWrong && (
        <p className="flex items-center gap-2 rounded-lg border border-go-200 bg-go-50 px-3.5 py-3 text-[13px] font-semibold text-go-700">
          <CheckCircle2 className="h-4 w-4" /> Nothing is holding this plan back.
        </p>
      )}
    </div>
  );

  if (layout === "wide") {
    return (
      <section className={`surface overflow-hidden ${className}`}>
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
          <div className="space-y-5 border-b border-ink-200 bg-ink-50/40 p-5 lg:border-b-0 lg:border-r">
            {gate}
            {extras}
          </div>
          <div className="p-5">
            <div className="eyebrow mb-3">What&apos;s holding the plan back</div>
            {issues}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`surface space-y-5 overflow-hidden p-5 ${className}`}>
      {gate}
      {issues}
      {extras}
    </section>
  );
}
