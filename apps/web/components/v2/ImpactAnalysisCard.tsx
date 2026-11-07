"use client";

import React from "react";
import { Clock, HelpCircle, Wallet } from "lucide-react";
import type { ImpactResultResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface ImpactAnalysisCardProps {
  impact?: ImpactResultResponse | Record<string, any> | null;
  className?: string;
}

const SEVERITY: Record<string, { chip: string; dot: string }> = {
  CRITICAL: { chip: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600 animate-cue-blink" },
  HIGH: { chip: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500" },
  MEDIUM: { chip: "border-standby-200 bg-standby-50 text-standby-700", dot: "bg-standby-300" },
  LOW: { chip: "border-ink-200 bg-ink-100/70 text-ink-700", dot: "bg-ink-400" },
  UNKNOWN: { chip: "border-dashed border-ink-300 bg-transparent text-ink-500", dot: "bg-ink-300" },
};

/** ✓ Engine-calculated consequences of an incident on the plan. */
export function ImpactAnalysisCard({ impact, className = "" }: ImpactAnalysisCardProps) {
  if (!impact || Object.keys(impact).length === 0) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-5 py-4 ${className}`}>
        <HelpCircle className="h-5 w-5 shrink-0 text-ink-400" />
        <div>
          <p className="text-[13.5px] font-semibold text-ink-800">Impact not calculated yet</p>
          <p className="text-[12px] text-ink-500">The impact engine hasn’t returned a result for this problem.</p>
        </div>
      </div>
    );
  }

  const directTasks = (impact.directly_affected_tasks as any[]) || [];
  const indirectTasks = (impact.indirectly_affected_tasks as any[]) || [];
  const blockedTasks = (impact.blocked_tasks as any[]) || [];
  const affectedProviders = (impact.affected_providers as any[]) || [];
  const scheduleImpact = (impact.schedule_impact as Record<string, any>) || {};
  const budgetImpact = (impact.budget_impact as Record<string, any>) || {};
  const depth = impact.dependency_depth != null ? impact.dependency_depth : "—";

  const severity = String(impact.severity || "UNKNOWN").toUpperCase();
  const sev = SEVERITY[severity] || SEVERITY.UNKNOWN;

  const readouts = [
    { label: "Direct tasks", value: directTasks.length, hint: "Hit first", alert: directTasks.length > 0 },
    { label: "Blocked after", value: blockedTasks.length, hint: "Can’t start", alert: blockedTasks.length > 0 },
    { label: "Ripple depth", value: depth, hint: "Layers deep", alert: false },
    { label: "Vendors", value: affectedProviders.length, hint: "Affected", alert: false },
  ];

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Impact</span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
          </div>
          <h4 className="mt-1 text-[14px] font-semibold text-ink-900">What this problem does to the plan</h4>
        </div>
        <span className={`chip ${sev.chip}`}>
          <span className={`cue-light ${sev.dot}`} />
          {severity.toLowerCase()} impact
        </span>
      </header>

      <div className="grid grid-cols-2 gap-px bg-ink-200 sm:grid-cols-4">
        {readouts.map((r) => (
          <div key={r.label} className="bg-[#FDFCFA] px-4 py-3">
            <div className="eyebrow">{r.label}</div>
            <div
              className={`mt-1 font-display text-[24px] font-bold leading-none tabular-nums ${r.alert ? "text-cue-700" : "text-ink-900"}`}
              style={{ fontStretch: "90%" }}
            >
              {r.value}
            </div>
            <div className="mt-1 text-[11px] text-ink-400">{r.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-2">
        <div className="bg-[#FDFCFA] px-4 py-3">
          <div className="eyebrow flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> Schedule
          </div>
          {scheduleImpact.delay_minutes != null ? (
            <>
              <div className="timecode mt-1 text-[15px] font-semibold text-ink-900">+{scheduleImpact.delay_minutes} min delay</div>
              {scheduleImpact.critical_path_affected && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-cue-700">
                  <span className="cue-light bg-cue-600" /> Critical path affected
                </div>
              )}
            </>
          ) : (
            <div className="mt-1 text-[12.5px] italic text-ink-400">Schedule impact unknown</div>
          )}
        </div>
        <div className="bg-[#FDFCFA] px-4 py-3">
          <div className="eyebrow flex items-center gap-1.5">
            <Wallet className="h-3 w-3" /> Budget
          </div>
          {budgetImpact.estimated_cost_delta != null ? (
            <>
              <div className="timecode mt-1 text-[15px] font-semibold text-ink-900">
                {budgetImpact.estimated_cost_delta > 0 ? "+" : ""}₹{Number(budgetImpact.estimated_cost_delta).toLocaleString()}
              </div>
              <div className={`mt-0.5 text-[11.5px] ${budgetImpact.over_budget ? "font-semibold text-cue-700" : "text-ink-500"}`}>
                {budgetImpact.over_budget ? "Goes over the budget ceiling" : "Within contingency"}
              </div>
            </>
          ) : (
            <div className="mt-1 text-[12.5px] italic text-ink-400">Budget impact unknown</div>
          )}
        </div>
      </div>

      {(directTasks.length > 0 || indirectTasks.length > 0) && (
        <div className="border-t border-ink-200 px-5 py-3.5">
          <div className="eyebrow mb-2">Affected tasks · {directTasks.length + indirectTasks.length}</div>
          <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {directTasks.map((t: any, idx: number) => (
              <li key={`dir-${idx}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-ink-50">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="cue-light bg-cue-600" />
                  <span className="truncate font-semibold text-ink-900">{t.name || t.task_id || `Task ${idx + 1}`}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-cue-700">direct</span>
              </li>
            ))}
            {indirectTasks.map((t: any, idx: number) => (
              <li key={`indir-${idx}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-ink-50">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="cue-light bg-standby-500" />
                  <span className="truncate text-ink-800">{t.name || t.task_id || `Task ${idx + 1}`}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-standby-700">knock-on</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
