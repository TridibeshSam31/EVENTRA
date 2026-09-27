"use client";

import React, { useState } from "react";
import {
  Bot,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Send,
  Loader2,
  ExternalLink,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { runOperationsAgent } from "@/lib/api/agent";
import type { AgentRunResponse } from "@/types/api";

export type AgentOperationalState =
  | "IDLE"
  | "RUNNING"
  | "WAITING"
  | "WAITING_FOR_APPROVAL"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "UNKNOWN";

interface AgentStatusCardProps {
  eventId: string;
  lifecycleState?: string;
  eventState?: string;
  pendingApprovalsCount?: number;
  latestOperation?: string | null;
  lastActiveTime?: string | null;
  lastRun?: AgentRunResponse | null;
  onRunComplete?: (result: AgentRunResponse) => void;
  className?: string;
}

export function AgentStatusCard({
  eventId,
  lifecycleState,
  eventState,
  pendingApprovalsCount = 0,
  latestOperation,
  lastActiveTime,
  lastRun,
  onRunComplete,
  className = "",
}: AgentStatusCardProps) {
  const [directive, setDirective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  // Derive authoritative agent status strictly from real backend state
  const deriveAgentStatus = (): { status: AgentOperationalState; label: string } => {
    if (lastRun?.status) {
      const s = lastRun.status.toUpperCase();
      if (s === "WAITING_FOR_APPROVAL") return { status: "WAITING_FOR_APPROVAL", label: "Waiting For Approval" };
      if (s === "RUNNING") return { status: "RUNNING", label: "Running Operation" };
      if (s === "FAILED") return { status: "FAILED", label: "Execution Failed" };
      if (s === "COMPLETED") return { status: "COMPLETED", label: "Operation Completed" };
      if (s === "BLOCKED") return { status: "BLOCKED", label: "Operation Blocked" };
    }

    if (eventState === "PAUSED") {
      return { status: "PAUSED", label: "Autonomous Loop Paused" };
    }

    if (pendingApprovalsCount > 0) {
      return { status: "WAITING_FOR_APPROVAL", label: "Waiting for Human Approval" };
    }

    if (lifecycleState === "LIVE" || lifecycleState === "IN_PROGRESS") {
      return { status: "IDLE", label: "Active & Monitoring" };
    }

    if (lifecycleState) {
      return { status: "IDLE", label: `Ready (${lifecycleState})` };
    }

    return { status: "UNKNOWN", label: "Agent status unavailable from backend." };
  };

  const currentStatus = deriveAgentStatus();

  const handleSendDirective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim() || submitting) return;

    try {
      setSubmitting(true);
      setErrorFeedback(null);
      setActionFeedback(null);

      const res = await runOperationsAgent(eventId, {
        message: directive.trim(),
      });

      if (res) {
        setActionFeedback(res.response || `Agent completed with status: ${res.status}`);
        if (onRunComplete) {
          onRunComplete(res);
        }
      }
      setDirective("");
    } catch (err: any) {
      console.error("Agent directive failed:", err);
      setErrorFeedback(err.message || "Failed to dispatch operator directive to agent.");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: AgentOperationalState) => {
    switch (status) {
      case "RUNNING":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "WAITING_FOR_APPROVAL":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "FAILED":
      case "BLOCKED":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "PAUSED":
        return "bg-slate-100 text-slate-700 border-slate-300";
      case "COMPLETED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "IDLE":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-slate-100 text-slate-600 border-slate-200";
    }
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 ${className}`}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-50 text-[#D6003C] border border-slate-200">
            <Bot className="w-5 h-5 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Event Operations Agent
              </h3>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-[11px] text-slate-500">
              Autonomous orchestration layer powered by EVENTRA LangGraph
            </p>
          </div>
        </div>

        {/* Canonical Status Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${getStatusBadge(
              currentStatus.status
            )}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                currentStatus.status === "RUNNING"
                  ? "bg-blue-500 animate-pulse"
                  : currentStatus.status === "WAITING_FOR_APPROVAL"
                  ? "bg-amber-500"
                  : currentStatus.status === "FAILED"
                  ? "bg-rose-500"
                  : "bg-emerald-500"
              }`}
            />
            <span>{currentStatus.label}</span>
          </span>
        </div>
      </div>

      {/* Main Grid: Status Facts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* Box 1: Latest Operation */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Latest Operation
          </span>
          <div className="font-semibold text-slate-900 truncate">
            {latestOperation || lastRun?.operational_intent || "Monitoring active event"}
          </div>
          <span className="text-[10px] text-slate-400 font-mono block">
            {lastActiveTime ? `At ${new Date(lastActiveTime).toLocaleTimeString()}` : "Active"}
          </span>
        </div>

        {/* Box 2: Governance / Approval Gating */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Governance Gate
          </span>
          {pendingApprovalsCount > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-amber-700 font-semibold flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                {pendingApprovalsCount} Action{pendingApprovalsCount > 1 ? "s" : ""} Pending
              </span>
              <Link
                href={`/events/${eventId}/approvals`}
                className="text-[11px] font-semibold text-[#D6003C] hover:underline flex items-center gap-0.5"
              >
                <span>Review</span>
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <div className="text-slate-600 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>No pending gates</span>
            </div>
          )}
          <span className="text-[10px] text-slate-400 block">
            Human-in-the-loop compliance
          </span>
        </div>

        {/* Box 3: Tool Execution */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Tool Telemetry
          </span>
          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-slate-600" />
            <span>
              {lastRun?.tool_history?.length
                ? `${lastRun.tool_history.length} tools executed in run`
                : "Tools registered & available"}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block font-mono">
            {lastRun?.run_id ? `Run: ${lastRun.run_id}` : "System nominal"}
          </span>
        </div>
      </div>

      {/* Operator Directive Form */}
      <form onSubmit={handleSendDirective} className="pt-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
          Dispatch Operator Directive
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="e.g. 'Shortlist top 3 backup caterers within 5km' or 'Inspect sound delay incident'"
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            disabled={submitting}
            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 bg-slate-50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!directive.trim() || submitting}
            className="px-4 py-2 bg-[#D6003C] hover:bg-[#b50033] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Execute</span>
          </button>
        </div>
      </form>

      {/* Feedback Messages */}
      {actionFeedback && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionFeedback}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-[10px] text-emerald-600 hover:text-emerald-900 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorFeedback && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorFeedback}</span>
          </div>
          <button
            onClick={() => setErrorFeedback(null)}
            className="text-[10px] text-rose-600 hover:text-rose-900 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
