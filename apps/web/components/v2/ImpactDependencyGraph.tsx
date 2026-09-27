"use client";

import React from "react";
import {
  Layers,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
  GitBranch,
} from "lucide-react";
import type { ImpactResultResponse } from "@/types/api";

interface ImpactDependencyGraphProps {
  impact?: ImpactResultResponse | Record<string, any> | null;
  incidentTitle?: string;
  className?: string;
}

export function ImpactDependencyGraph({
  impact,
  incidentTitle,
  className = "",
}: ImpactDependencyGraphProps) {
  if (!impact || Object.keys(impact).length === 0) {
    return (
      <div className={`p-5 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-400 ${className}`}>
        <GitBranch className="w-5 h-5 mx-auto mb-1 text-slate-300" />
        <p className="font-semibold text-slate-600">Dependency Blast Radius Unavailable</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          No dependency impact relationships recorded for this incident.
        </p>
      </div>
    );
  }

  const dependencies = (impact.affected_dependencies as any[]) || [];
  const directTasks = (impact.directly_affected_tasks as any[]) || [];
  const blockedTasks = (impact.blocked_tasks as any[]) || [];

  const hasExplicitEdges = dependencies.length > 0;

  return (
    <div className={`p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5 text-[#D6003C]" />
            Blast Radius Propagation
          </span>
          <h4 className="text-sm font-bold text-slate-900 mt-0.5">
            Operational Dependency Graph
          </h4>
        </div>

        <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
          {hasExplicitEdges ? `${dependencies.length} Edges` : "Flat Propagation Audit"}
        </span>
      </div>

      {hasExplicitEdges ? (
        /* Real Graph Visualization based on Authoritative Backend Edges */
        <div className="space-y-3">
          <div className="overflow-x-auto pb-2">
            <div className="flex items-center gap-2 min-w-[500px]">
              {/* Node 1: Originating Incident */}
              <div className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-xs w-44 shrink-0 shadow-xs">
                <span className="text-[9px] font-bold uppercase tracking-wider text-rose-600 block">
                  Root Incident
                </span>
                <span className="font-bold text-xs truncate block mt-0.5" title={incidentTitle}>
                  {incidentTitle || "Trigger Event"}
                </span>
                <span className="text-[10px] text-rose-700 font-mono block mt-1">
                  Severity: {impact.severity || "CRITICAL"}
                </span>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

              {/* Node 2: Direct Task Failures */}
              <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs w-48 shrink-0 shadow-xs">
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 block">
                  Direct Failure Point
                </span>
                <span className="font-bold text-xs truncate block mt-0.5">
                  {directTasks[0]?.name || directTasks[0]?.task_id || "Direct Task"}
                </span>
                <span className="text-[10px] text-amber-700 font-mono block mt-1">
                  {directTasks.length} directly affected
                </span>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

              {/* Node 3: Downstream Blocked Tasks */}
              <div className="p-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-900 text-xs w-48 shrink-0 shadow-xs">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                  Blocked Downstream
                </span>
                <span className="font-bold text-xs truncate block mt-0.5">
                  {blockedTasks[0]?.name || blockedTasks[0]?.task_id || "Blocked Node"}
                </span>
                <span className="text-[10px] text-slate-600 font-mono block mt-1">
                  {blockedTasks.length} downstream halted
                </span>
              </div>
            </div>
          </div>

          {/* List of explicit dependency propagation edges from backend */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Direct Backend Dependency Edges ({dependencies.length})
            </span>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {dependencies.map((dep: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-slate-50 border border-slate-200 text-xs flex items-center justify-between font-mono"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-slate-800 font-semibold truncate">
                      {dep.predecessor_name || dep.predecessor_id || "Predecessor"}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="text-slate-800 font-semibold truncate">
                      {dep.successor_name || dep.successor_id || "Successor"}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0 ml-2">
                    {dep.dependency_type || "FINISH_TO_START"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Fallback: Structured Affected Tasks Audit without Fabricating Graph Edges */
        <div className="space-y-3">
          <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200 text-xs text-amber-800">
            <strong>Dependency graph unavailable from backend:</strong> Exact edge relationships were not returned by the impact engine. Displaying structured affected-task audit below without fabricating relationships.
          </div>

          <div className="space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Affected Nodes Table
            </span>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Task</th>
                    <th className="px-3 py-2">Impact Tier</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {directTasks.map((t: any, idx: number) => (
                    <tr key={`dir-${idx}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-900">
                        {t.name || t.task_id || `Task ${idx + 1}`}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-semibold text-rose-700">
                        Direct Failure
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">
                        {t.status || "BLOCKED"}
                      </td>
                    </tr>
                  ))}

                  {blockedTasks.map((t: any, idx: number) => (
                    <tr key={`blk-${idx}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-800">
                        {t.name || t.task_id || `Downstream Task ${idx + 1}`}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-semibold text-amber-700">
                        Downstream Blocked
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">
                        {t.status || "WAITING"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
