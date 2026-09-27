"use client";

import React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldAlert,
  Info,
  ChevronRight,
  ListFilter,
} from "lucide-react";
import type {
  PlanReadiness,
  PlanBlocker,
  PlanWarning,
  UnresolvedUnknown,
} from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface PlanningReadinessCardProps {
  readinessStatus?: PlanReadiness | string | null;
  blockers?: PlanBlocker[];
  warnings?: PlanWarning[];
  unresolvedUnknowns?: UnresolvedUnknown[];
  isConsistent?: boolean;
  consistencyErrors?: string[];
  className?: string;
}

export function PlanningReadinessCard({
  readinessStatus,
  blockers = [],
  warnings = [],
  unresolvedUnknowns = [],
  isConsistent = true,
  consistencyErrors = [],
  className = "",
}: PlanningReadinessCardProps) {
  if (!readinessStatus) {
    return (
      <div className={`p-5 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <HelpCircle className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
        <p className="font-semibold text-slate-700">Planning Readiness State</p>
        <p className="text-slate-400 mt-0.5">Planning readiness is not available from the backend.</p>
      </div>
    );
  }

  const statusKey = String(readinessStatus).toUpperCase();

  const STATUS_CONFIG: Record<
    string,
    { label: string; badgeClass: string; icon: React.ReactNode; desc: string }
  > = {
    READY: {
      label: "EXECUTION READY",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      desc: "All required tasks are assigned, DAG acyclic, and no operational blockers exist.",
    },
    PARTIALLY_READY: {
      label: "PARTIALLY READY",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
      desc: "Plan is executable, but non-critical tasks or facts require operator attention.",
    },
    BLOCKED: {
      label: "OPERATIONALLY BLOCKED",
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
      icon: <XCircle className="w-4 h-4 text-rose-600" />,
      desc: "Critical task unassigned, schedule conflict, deadline exceeded, or budget overflow.",
    },
    INCOMPLETE: {
      label: "INCOMPLETE SPECIFICATION",
      badgeClass: "bg-slate-100 text-slate-700 border-slate-300",
      icon: <HelpCircle className="w-4 h-4 text-slate-600" />,
      desc: "Required operational parameters or workflow tasks have not yet been materialized.",
    },
  };

  const config = STATUS_CONFIG[statusKey] || {
    label: statusKey,
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <Info className="w-4 h-4 text-slate-600" />,
    desc: "Operational readiness evaluated by backend planning engine.",
  };

  return (
    <div className={`p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4 ${className}`}>
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Operational Gate
            </span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border flex items-center gap-1.5 ${config.badgeClass}`}>
              {config.icon}
              {config.label}
            </span>
            {!isConsistent && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                Inconsistent
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{config.desc}</p>
        </div>

        {/* Telemetry Summary Counters */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-center px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Blockers</span>
            <span className={`text-xs font-bold font-mono ${blockers.length > 0 ? "text-rose-600" : "text-slate-700"}`}>
              {blockers.length}
            </span>
          </div>
          <div className="text-center px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Warnings</span>
            <span className={`text-xs font-bold font-mono ${warnings.length > 0 ? "text-amber-600" : "text-slate-700"}`}>
              {warnings.length}
            </span>
          </div>
          <div className="text-center px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Unknowns</span>
            <span className="text-xs font-bold font-mono text-slate-700">
              {unresolvedUnknowns.length}
            </span>
          </div>
        </div>
      </div>

      {/* Critical Blockers */}
      {blockers.length > 0 && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              Critical Operational Blockers ({blockers.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {blockers.map((b, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded bg-white border border-rose-200/80 text-xs text-rose-900 flex items-start gap-2"
              >
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-rose-100 text-rose-800 shrink-0">
                  {b.reason_code || "BLOCKER"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="leading-snug">{b.message}</p>
                  {b.task_id && (
                    <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
                      Affected Task ID: {b.task_id}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-Blocking Warnings */}
      {warnings.length > 0 && (
        <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Planning Warnings ({warnings.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {warnings.map((w, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded bg-white border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2"
              >
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-100 text-amber-800 shrink-0">
                  {w.reason_code || "WARN"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="leading-snug">{w.message}</p>
                  {w.task_id && (
                    <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
                      Task: {w.task_id}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved Unknown Facts */}
      {unresolvedUnknowns.length > 0 && (
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-500" />
            Unresolved Facts & Unknowns ({unresolvedUnknowns.length})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {unresolvedUnknowns.map((u, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-white border border-slate-200 text-xs text-slate-700"
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="font-semibold text-slate-900 truncate">{u.field}</span>
                  {u.is_critical && (
                    <span className="text-[9px] font-bold text-rose-700 uppercase bg-rose-50 px-1 rounded">
                      Critical
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                  {u.description}
                </p>
                {u.category && (
                  <span className="text-[9px] text-slate-400 font-mono mt-1 block">
                    Category: {u.category}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consistency Errors */}
      {consistencyErrors.length > 0 && (
        <div className="p-3 rounded-lg border border-rose-300 bg-rose-100/50 text-xs text-rose-900">
          <span className="font-bold block mb-1">DAG Consistency Violations:</span>
          <ul className="list-disc list-inside space-y-0.5 text-[11px]">
            {consistencyErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
