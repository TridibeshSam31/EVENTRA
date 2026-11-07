"use client";

import React from "react";
import { ArrowRight, GitBranch } from "lucide-react";
import type { ImpactResultResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface ImpactDependencyGraphProps {
  impact?: ImpactResultResponse | Record<string, any> | null;
  incidentTitle?: string;
  className?: string;
}

/** The ripple: incident → directly hit task → blocked downstream, from engine edges only. */
export function ImpactDependencyGraph({ impact, incidentTitle, className = "" }: ImpactDependencyGraphProps) {
  if (!impact || Object.keys(impact).length === 0) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-5 py-4 ${className}`}>
        <GitBranch className="h-5 w-5 shrink-0 text-ink-400" />
        <div>
          <p className="text-[13.5px] font-semibold text-ink-800">No ripple recorded</p>
          <p className="text-[12px] text-ink-500">No dependency relationships were recorded for this problem.</p>
        </div>
      </div>
    );
  }

  const dependencies = (impact.affected_dependencies as any[]) || [];
  const directTasks = (impact.directly_affected_tasks as any[]) || [];
  const blockedTasks = (impact.blocked_tasks as any[]) || [];
  const hasExplicitEdges = dependencies.length > 0;

  const stages = [
    {
      k: "Problem",
      title: incidentTitle || "Reported problem",
      meta: `Severity ${String(impact.severity || "unknown").toLowerCase()}`,
      cls: "border-cue-300 bg-cue-50",
      label: "text-cue-700",
      dot: "bg-cue-600 animate-cue-blink",
    },
    {
      k: "Hit first",
      title: directTasks[0]?.name || directTasks[0]?.task_id || "—",
      meta: `${directTasks.length} task${directTasks.length === 1 ? "" : "s"} directly affected`,
      cls: "border-standby-300 bg-standby-50",
      label: "text-standby-800",
      dot: "bg-standby-500",
    },
    {
      k: "Blocked after",
      title: blockedTasks[0]?.name || blockedTasks[0]?.task_id || "—",
      meta: `${blockedTasks.length} downstream can’t start`,
      cls: "border-ink-300 bg-ink-50",
      label: "text-ink-600",
      dot: "bg-ink-400",
    },
  ];

  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Ripple</span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
          </div>
          <h4 className="mt-1 text-[14px] font-semibold text-ink-900">How the problem spreads through the plan</h4>
        </div>
        <span className="rounded border border-ink-200 bg-ink-50 px-1.5 py-px font-mono text-[10.5px] text-ink-600">
          {hasExplicitEdges ? `${dependencies.length} links` : "no links returned"}
        </span>
      </header>

      {hasExplicitEdges ? (
        <div className="space-y-4 px-5 py-4">
          <div className="overflow-x-auto pb-1">
            <ol className="flex min-w-[560px] items-stretch gap-2">
              {stages.map((st, idx) => (
                <React.Fragment key={st.k}>
                  <li className={`min-w-0 flex-1 rounded-lg border px-3 py-2.5 ${st.cls}`}>
                    <div className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-label ${st.label}`}>
                      <span className={`cue-light ${st.dot}`} /> {st.k}
                    </div>
                    <div className="mt-1 truncate text-[13px] font-semibold text-ink-900" title={st.title}>
                      {st.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-500">{st.meta}</div>
                  </li>
                  {idx < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 self-center text-ink-300" />}
                </React.Fragment>
              ))}
            </ol>
          </div>

          <div>
            <div className="eyebrow mb-2">Dependency links · {dependencies.length}</div>
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {dependencies.map((dep: any, idx: number) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50/60 px-2.5 py-1.5 text-[12px]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-ink-800">{dep.predecessor_name || dep.predecessor_id || "Predecessor"}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-cue-500" />
                    <span className="truncate font-semibold text-ink-800">{dep.successor_name || dep.successor_id || "Successor"}</span>
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] uppercase text-ink-400">
                    {String(dep.dependency_type || "FINISH_TO_START").replace(/_/g, " ").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        /* Fallback: affected-task list without fabricating edges */
        <div className="space-y-3 px-5 py-4">
          <p className="rounded-lg border border-standby-200 bg-standby-50 px-3 py-2 text-[12.5px] text-standby-900">
            The impact engine didn’t return exact links between tasks, so they aren’t drawn. Here are the affected tasks instead.
          </p>
          {directTasks.length + blockedTasks.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 font-mono text-[10px] uppercase tracking-label text-ink-400">
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">How it’s hit</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-ink-200">
                  {directTasks.map((t: any, idx: number) => (
                    <tr key={`dir-${idx}`} className="hover:bg-ink-50/70">
                      <td className="px-3 py-2 font-semibold text-ink-900">{t.name || t.task_id || `Task ${idx + 1}`}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-cue-700">
                          <span className="cue-light bg-cue-600" /> Directly
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] uppercase text-ink-500">{t.status || "—"}</td>
                    </tr>
                  ))}
                  {blockedTasks.map((t: any, idx: number) => (
                    <tr key={`blk-${idx}`} className="hover:bg-ink-50/70">
                      <td className="px-3 py-2 text-ink-800">{t.name || t.task_id || `Downstream task ${idx + 1}`}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-standby-700">
                          <span className="cue-light bg-standby-500" /> Blocked downstream
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] uppercase text-ink-500">{t.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-3 text-center text-[12.5px] text-ink-400">No affected tasks were recorded.</p>
          )}
        </div>
      )}
    </section>
  );
}
