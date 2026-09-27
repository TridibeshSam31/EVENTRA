"use client";

import React from "react";
import {
  Bot,
  Wrench,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowDown,
  Layers,
  FileCheck,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { AgentRunResponse, ToolHistoryEntry } from "@/types/api";

interface AgentExecutionTimelineProps {
  run?: AgentRunResponse | null;
  toolHistory?: ToolHistoryEntry[];
  className?: string;
}

export function AgentExecutionTimeline({
  run,
  toolHistory = [],
  className = "",
}: AgentExecutionTimelineProps) {
  const tools = run?.tool_history?.length ? run.tool_history : toolHistory;

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
            <Layers className="w-4 h-4 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Agent Action Execution Timeline
              </h3>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-[11px] text-slate-500">
              Chronological operational progression verified by backend execution records
            </p>
          </div>
        </div>

        {run?.run_id && (
          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            Run ID: {run.run_id}
          </span>
        )}
      </div>

      {!run && tools.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400 space-y-1">
          <p className="font-semibold text-slate-600">No agent operations timeline recorded</p>
          <p className="text-[11px]">
            Execute an operational directive or trigger autonomous discovery to generate verifiable timeline records.
          </p>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {/* Step 1: Directive / Objective */}
          <div className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="w-0.5 h-8 bg-slate-200 mt-1" />
            </div>

            <div className="flex-1 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                  01. Objective Received
                </span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Agent Loop
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {run?.objective || run?.operational_intent || "Operational directive accepted"}
              </p>
            </div>
          </div>

          {/* Step 2: Tool Execution History */}
          {tools.map((th, idx) => (
            <div key={`tool-step-${idx}`} className="flex items-start gap-3 relative">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                  <Wrench className="w-3.5 h-3.5" />
                </div>
                <div className="w-0.5 h-8 bg-slate-200 mt-1" />
              </div>

              <div className="flex-1 pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-tight font-mono">
                    Tool #{th.step || idx + 1}: {th.tool}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
                      th.status === "SUCCESS"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {th.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {th.result_summary || "Tool execution completed"}
                </p>
              </div>
            </div>
          ))}

          {/* Step 3: Governance / Approval */}
          <div className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${
                  run?.approval_id
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div className="w-0.5 h-8 bg-slate-200 mt-1" />
            </div>

            <div className="flex-1 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                  Governance Authorization
                </span>
                <span
                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
                    run?.approval_id
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-100 text-slate-400 border-slate-200"
                  }`}
                >
                  {run?.approval_id ? "APPROVAL REQUIRED" : "NOT RECORDED"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {run?.approval_id
                  ? `Approval gate generated: #${run.approval_id}`
                  : "Autonomous actions executed without human approval gate"}
              </p>
            </div>
          </div>

          {/* Step 4: Verification Result */}
          <div className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${
                  run?.verification
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <FileCheck className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                  Verification Engine
                </span>
                <span
                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
                    run?.verification
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-400 border-slate-200"
                  }`}
                >
                  {run?.verification ? "VERIFIED" : "NOT RECORDED"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {run?.verification
                  ? "Post-action operational invariants confirmed by backend"
                  : "Verification record not recorded for this run"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
