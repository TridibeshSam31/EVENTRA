"use client";

import React, { useMemo, useState } from "react";
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
import { useAgentRunStore } from "@/stores/agentRunStore";
import { deriveRunView, isExecuting } from "@/lib/agentRun/view";
import { CompanionPairingModal } from "@/components/browser/CompanionPairingModal";
import { browserCompanionApi, CompanionStatusResponse } from "@/lib/api/browserCompanion";
import { useAdvancedMode } from "@/hooks/useAdvancedMode";
import { stripIds } from "@/lib/humanize";

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

// Backend status codes like "FAILED" or "IN_PROGRESS" read as shouting; show them as words.
function humanizeStatus(text?: string | null): string {
  if (!text) return "";
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) {
    const words = text.toLowerCase().replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return text;
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

  // Authoritative run state from the backend (persisted run + progress events).
  const [advanced] = useAdvancedMode();
  const startRun = useAgentRunStore((s) => s.startRun);
  const storeStarting = useAgentRunStore((s) => s.starting);
  const storeEventId = useAgentRunStore((s) => s.eventId);
  const run = useAgentRunStore((s) => s.run);
  const runEvents = useAgentRunStore((s) => s.events);
  const runView = useMemo(
    () => (storeEventId === eventId && run ? deriveRunView(run, runEvents) : null),
    [storeEventId, eventId, run, runEvents]
  );

  const runExecuting = runView ? isExecuting(runView.lifecycle) : false;
  const showRunning = starting || storeStarting || (runView ? runExecuting : isRunning);
  const showWaiting = runView ? runView.lifecycle === "awaiting_selection" : isWaitingForSelection;
  const showFailed = runView ? runView.lifecycle === "failed" : agentStatus === "FAILED";
  const runningLabel = runView?.phase?.label || agentMessage;

  const handleStartOperations = async () => {
    // The store ignores clicks while a start request or an executing run is in flight.
    if (starting || storeStarting || runExecuting) return;
    try {
      setStarting(true);
      await startRun(eventId);
      const { startError, run: startedRun } = useAgentRunStore.getState();
      if (startError) {
        setLastMessage(startError);
      } else if (onOperationsStarted) {
        onOperationsStarted(startedRun?.run_id);
      }
    } finally {
      setStarting(false);
    }
  };

  const isLive = lifecycleState === "LIVE" || lifecycleState === "IN_PROGRESS";
  // Pending approvals are surfaced once, in the Overview "Needs you" block.
  void pendingApprovalsCount;

  return (
    <div className={`rounded-xl border border-slate-200 bg-[#FDFCFA] p-5 shadow-sm space-y-4 ${className}`}>
      {/* Top Header: Identity + Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[#D6003C]">
            <Bot className="w-5 h-5 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
                Your AI assistant
              </h2>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Finds, compares and contacts vendors for{" "}
              <span className="font-semibold text-slate-800">{eventName}</span>. Nothing is booked without your OK.
            </p>
          </div>
        </div>

        {/* Backend Status Badge */}
        {/* Backend Status Badge */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {showWaiting ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-ink-100 text-ink-700 border border-ink-200">
              <span className="w-2 h-2 rounded-full bg-ink-400" />
              <span>Paused</span>
            </span>
          ) : showFailed ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Something went wrong</span>
            </span>
          ) : showRunning ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Finding vendors…</span>
            </span>
          ) : isLive ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Event is live</span>
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
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs ${advanced ? "lg:grid-cols-4" : ""}`}>
        {/* 1. Current Operation */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-label font-mono text-slate-400">
            <Layers className="w-3 h-3 text-slate-500" />
            <span>What&apos;s happening</span>
          </div>
          <div className="font-semibold text-slate-900 truncate" title={agentMessage || latestOperation || ""}>
            {isWaitingForSelection
              ? "Paused until you pick vendors."
              : humanizeStatus(agentMessage || latestOperation) || (isLive ? "Keeping an eye on your event" : "Ready when you are")}
          </div>
        </div>

        {/* 2. Tool Invocation */}
        {advanced && (<>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-label font-mono text-slate-400">
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
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-label font-mono text-slate-400">
            <Cpu className="w-3 h-3 text-slate-500" />
            <span>Engine Layer</span>
          </div>
          <div className="font-semibold text-slate-900 truncate">
            {latestEngine || "Discrete deterministic engines"}
          </div>
          <span className="text-[10px] text-slate-500">Invariants verification</span>
        </div>
        </>)}

        {/* 4. Latest result */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-label font-mono text-slate-400">
            <CheckCircle2 className="w-3 h-3 text-slate-500" />
            <span>Latest result</span>
          </div>
          <div className="font-semibold text-slate-900 truncate" title={latestResult || ""}>
            {humanizeStatus(stripIds(latestResult)) || "Nothing yet"}
          </div>
          <span className="text-[10px] text-slate-500">Nothing is booked without your OK</span>
        </div>
      </div>

      {/* Bottom Action Controls & Links */}
      <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
          {advanced && (<>
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
          </>)}
        </div>

        <div className="flex items-center gap-2">
          {advanced && (companionStatus?.is_connected ? (
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
          ))}

          {advanced && (
          <Link
            href={`/browser-runtime?eventId=${eventId}`}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 shadow-sm transition-all"
            title="Launch Headed Chromium Browser to discover venues & vendors"
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span>Browser Autonomous Agent</span>
          </Link>
          )}

          {showRunning ? (
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              <span>{runningLabel || (starting || storeStarting ? "Starting…" : "Finding vendors for you…")}</span>
            </div>
          ) : showWaiting ? null : showFailed ? (
            <div className="inline-flex items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 shadow-sm">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>{runView?.error || agentMessage || "Something went wrong. Please try again."}</span>
              </div>
              <button
                onClick={handleStartOperations}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartOperations}
              disabled={starting || storeStarting || runExecuting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white shadow-sm transition-all disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              <span>{isLive ? "Find more vendors" : "Find vendors for me"}</span>
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
