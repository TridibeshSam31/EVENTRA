"use client";

import React from "react";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  Layers,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  HelpCircle,
  Activity,
  Calendar,
} from "lucide-react";
import type { ImpactResultResponse } from "@/types/api";

interface ImpactAnalysisCardProps {
  impact?: ImpactResultResponse | Record<string, any> | null;
  className?: string;
}

export function ImpactAnalysisCard({
  impact,
  className = "",
}: ImpactAnalysisCardProps) {
  if (!impact || Object.keys(impact).length === 0) {
    return (
      <div className={`p-5 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-400 ${className}`}>
        <HelpCircle className="w-5 h-5 mx-auto mb-1 text-slate-300" />
        <p className="font-semibold text-slate-600">Impact Analysis Unavailable</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Deterministic impact assessment has not completed or returned data.
        </p>
      </div>
    );
  }

  const directTasks = (impact.directly_affected_tasks as any[]) || [];
  const indirectTasks = (impact.indirectly_affected_tasks as any[]) || [];
  const blockedTasks = (impact.blocked_tasks as any[]) || [];
  const affectedProviders = (impact.affected_providers as any[]) || [];
  const scheduleImpact = (impact.schedule_impact as Record<string, any>) || {};
  const budgetImpact = (impact.budget_impact as Record<string, any>) || {};
  const depth = impact.dependency_depth != null ? impact.dependency_depth : "UNKNOWN";

  const severity = String(impact.severity || "UNKNOWN").toUpperCase();

  const SEVERITY_CLASSES: Record<string, string> = {
    CRITICAL: "bg-rose-50 text-rose-700 border-rose-200",
    HIGH: "bg-amber-50 text-amber-800 border-amber-200",
    MEDIUM: "bg-blue-50 text-blue-700 border-blue-200",
    LOW: "bg-slate-50 text-slate-700 border-slate-200",
    UNKNOWN: "bg-slate-50 text-slate-500 border-slate-200",
  };
  const severityBadgeClass = SEVERITY_CLASSES[severity] || "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <div className={`p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-[#D6003C]" />
            Deterministic Impact Assessment
          </span>
          <h4 className="text-sm font-bold text-slate-900 mt-0.5">
            Operational Blast Radius & Dependency Impact
          </h4>
        </div>

        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${severityBadgeClass}`}>
          {severity} IMPACT
        </span>
      </div>

      {/* Primary Impact Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Direct Tasks</span>
          <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
            {directTasks.length}
          </span>
          <span className="text-[10px] text-slate-500">Immediate failure point</span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Blocked Downstream</span>
          <span className="font-mono font-bold text-amber-700 text-sm mt-0.5 block">
            {blockedTasks.length}
          </span>
          <span className="text-[10px] text-slate-500">DAG execution halted</span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Dependency Depth</span>
          <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
            {depth}
          </span>
          <span className="text-[10px] text-slate-500">Propagation layers</span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Affected Providers</span>
          <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
            {affectedProviders.length}
          </span>
          <span className="text-[10px] text-slate-500">Suppliers compromised</span>
        </div>
      </div>

      {/* Schedule & Budget Consequences (Backend Authoritative) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {/* Schedule Delay Impact */}
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            Schedule Consequence
          </span>
          {scheduleImpact.delay_minutes != null ? (
            <div>
              <span className="font-mono font-bold text-slate-900 text-xs">
                +{scheduleImpact.delay_minutes} min estimated delay
              </span>
              {scheduleImpact.critical_path_affected && (
                <span className="block text-[10px] text-rose-600 font-semibold mt-0.5">
                  Critical path timeline compromised
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 text-[11px] italic">
              Schedule impact: UNKNOWN
            </span>
          )}
        </div>

        {/* Budget Consequence */}
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-slate-400" />
            Budget Consequence
          </span>
          {budgetImpact.estimated_cost_delta != null ? (
            <div>
              <span className="font-mono font-bold text-slate-900 text-xs">
                {budgetImpact.estimated_cost_delta > 0 ? "+" : ""}
                ₹{Number(budgetImpact.estimated_cost_delta).toLocaleString()} estimated delta
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                {budgetImpact.over_budget ? "Requires budget ceiling override" : "Within contingent reserve"}
              </span>
            </div>
          ) : (
            <span className="text-slate-400 text-[11px] italic">
              Budget impact: UNKNOWN
            </span>
          )}
        </div>
      </div>

      {/* Directly & Indirectly Affected Tasks List */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
          Affected Tasks Audit ({directTasks.length + indirectTasks.length} total)
        </span>

        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {directTasks.map((t: any, idx: number) => (
            <div
              key={`dir-${idx}`}
              className="p-2 rounded bg-rose-50/60 border border-rose-200/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
                <span className="font-bold text-slate-900 truncate">
                  {t.name || t.task_id || `Task ${idx + 1}`}
                </span>
              </div>
              <span className="text-[9px] uppercase font-bold text-rose-700 bg-rose-100/60 px-1.5 py-0.2 rounded shrink-0">
                Direct Failure
              </span>
            </div>
          ))}

          {indirectTasks.map((t: any, idx: number) => (
            <div
              key={`indir-${idx}`}
              className="p-2 rounded bg-amber-50/60 border border-amber-200/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="font-semibold text-slate-800 truncate">
                  {t.name || t.task_id || `Task ${idx + 1}`}
                </span>
              </div>
              <span className="text-[9px] uppercase font-bold text-amber-700 bg-amber-100/60 px-1.5 py-0.2 rounded shrink-0">
                Indirectly Blocked
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
