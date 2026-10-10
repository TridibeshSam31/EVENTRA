"use client";

import React, { useState } from "react";
import {
  Bot,
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  History,
  Wrench,
  Cpu,
  Layers,
  Globe,
  Laptop,
} from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { startOperations } from "@/lib/api/discoveryRuns";
import { CompanionPairingModal } from "@/components/browser/CompanionPairingModal";
import { browserCompanionApi, CompanionStatusResponse } from "@/lib/api/browserCompanion";

interface AgentPanelProps {
  eventId: string;
  eventName: string;
  lifecycleState: string;
  isRunning?: boolean;
  isWaitingForSelection?: boolean;
  agentMessage?: string | null;
  agentStatus?: string | null;
  onOperationsStarted?: (runId?: string) => void;
  className?: string;
  latestOperation?: string | null;
  latestTool?: string | null;
  latestEngine?: string | null;
  pendingApprovalsCount?: number;
  latestResult?: string | null;
}

export function AgentPanel({
  eventId,
  eventName,
  lifecycleState,
  isRunning = false,
  isWaitingForSelection = false,
  agentMessage,
  agentStatus,
  onOperationsStarted,
  className = "",
  latestOperation,
  latestTool,
  latestEngine,
  pendingApprovalsCount = 0,
  latestResult,
}: AgentPanelProps) {
  const [starting, setStarting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [companionStatus, setCompanionStatus] = useState<CompanionStatusResponse | null>(null);

  React.useEffect(() => {
    browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {});
    const interval = setInterval(() => {
      browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleStartOperations = async () => {
    try {
      setStarting(true);
      const res = await startOperations(eventId);
      setLastMessage(res.message);
      if (onOperationsStarted) {
        onOperationsStarted(res.run_id);
      }
    } catch (err: any) {
      console.error("Start operations failed:", err);
      setLastMessage(err.message || "Failed to start autonomous operations");
    } finally {
      setStarting(false);
    }
  };

  const isLive = lifecycleState === "LIVE" || lifecycleState === "IN_PROGRESS";
  const hasPendingApprovals = pendingApprovalsCount > 0;

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 ${className}`}>
      {/* Top Header: Identity + Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[#D6003C]">
            <Bot className="w-5 h-5 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide uppercase text-slate-900">
                Event Operations Agent
              </h2>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Autonomous orchestration layer managing lifecycle operations for{" "}
              <span className="font-semibold text-slate-800">{eventName}</span>
            </p>
          </div>
        </div>

        {/* Backend Status Badge */}
        {/* Backend Status Badge */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {hasPendingApprovals ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              <span>Waiting For Approval</span>
            </span>
          ) : isWaitingForSelection ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Waiting For Selection</span>
            </span>
          ) : agentStatus === "FAILED" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Failed</span>
            </span>
          ) : isRunning ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Sourcing & Qualifying</span>
            </span>
          ) : isLive ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Autonomous Live</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>{lifecycleState || "Ready"}</span>
            </span>
          )}
        </div>
      </div>

      {/* Structured Operational Facts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        {/* 1. Current Operation */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Layers className="w-3 h-3 text-slate-500" />
            <span>Current Operation</span>
          </div>
          <div className="font-semibold text-slate-900 truncate" title={agentMessage || latestOperation || ""}>
            {isWaitingForSelection
              ? "EVENTRA is waiting for your selection."
              : agentMessage || latestOperation || (isLive ? "Monitoring execution state" : "Awaiting dispatch")}
          </div>
          <span className="text-[10px] text-slate-500">Autonomous workflow step</span>
        </div>

        {/* 2. Tool Invocation */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Wrench className="w-3 h-3 text-slate-500" />
            <span>Latest Tool</span>
          </div>
          <div className="font-mono text-xs font-semibold text-slate-900 truncate">
            {latestTool || "Tool registry active"}
          </div>
          <span className="text-[10px] text-slate-500">Credential-redacted execution</span>
        </div>

        {/* 3. Deterministic Engine */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Cpu className="w-3 h-3 text-slate-500" />
            <span>Engine Layer</span>
          </div>
          <div className="font-semibold text-slate-900 truncate">
            {latestEngine || "Discrete deterministic engines"}
          </div>
          <span className="text-[10px] text-slate-500">Invariants verification</span>
        </div>

        {/* 4. Governance & Approvals */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <ShieldAlert className="w-3 h-3 text-slate-500" />
            <span>Governance</span>
          </div>
          {hasPendingApprovals ? (
            <div className="flex items-center justify-between">
              <span className="text-amber-700 font-bold">
                {pendingApprovalsCount} Action Pending
              </span>
              <Link
                href={`/events/${eventId}/approvals`}
                className="text-[11px] font-semibold text-[#D6003C] hover:underline"
              >
                Review
              </Link>
            </div>
          ) : (
            <div className="text-emerald-700 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Compliant</span>
            </div>
          )}
          <span className="text-[10px] text-slate-500">Human-in-the-loop gate</span>
        </div>
      </div>

      {/* Bottom Action Controls & Links */}
      <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
          <Link
            href={`/events/${eventId}/activity`}
            className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-950 transition"
          >
            <History className="w-3.5 h-3.5 text-[#D6003C]" />
            <span>Open Agent Activity</span>
          </Link>
          <span className="text-slate-200">|</span>
          <Link
            href={`/events/${eventId}/audit`}
            className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-950 transition"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-slate-600" />
            <span>Open Audit Trail</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {companionStatus?.is_connected ? (
            <button
              onClick={() => setIsPairingOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm hover:bg-emerald-100 transition"
              title="Windows Browser Companion is connected and will open visibly on desktop"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <Laptop className="w-3.5 h-3.5 text-emerald-600" />
              <span>Visible Desktop Ready</span>
            </button>
          ) : (
            <button
              onClick={() => setIsPairingOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 shadow-sm transition"
              title="Click to pair with the local Windows Browser Companion"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <Laptop className="w-3.5 h-3.5 text-amber-700" />
              <span>Pair Desktop Browser</span>
            </button>
          )}

          <Link
            href={`/browser-runtime?eventId=${eventId}`}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 shadow-sm transition-all"
            title="Launch Headed Chromium Browser to discover venues & vendors"
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span>Browser Autonomous Agent</span>
          </Link>

          {isRunning || starting ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              <span>{agentMessage || "Autonomous Loop Active • Sourcing & Qualifying"}</span>
            </div>
          ) : isWaitingForSelection ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
              <span>{agentMessage || "Recommendations Ready • Select Preferred Options"}</span>
            </div>
          ) : agentStatus === "FAILED" ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 shadow-sm">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>{agentMessage || "EVENTRA encountered an issue."}</span>
            </div>
          ) : (
            <button
              onClick={handleStartOperations}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white shadow-sm transition-all disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              <span>{isLive ? "Dispatch Autonomous Sourcing" : "Start Autonomous Operations"}</span>
            </button>
          )}
        </div>
      </div>

      {lastMessage && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs text-slate-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
            <span>{lastMessage}</span>
          </div>
          <button
            onClick={() => setLastMessage(null)}
            className="text-[11px] font-semibold text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </button>
        </div>
      )}

      <CompanionPairingModal
        isOpen={isPairingOpen}
        onClose={() => setIsPairingOpen(false)}
        onConnected={() => {
          browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {});
        }}
      />
    </div>
  );
}
