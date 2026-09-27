"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Bot,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  Zap,
} from "lucide-react";
import { startOperations } from "@/lib/api/discoveryRuns";

interface AgentPanelProps {
  eventId: string;
  eventName: string;
  lifecycleState: string;
  isRunning?: boolean;
  onOperationsStarted?: (runId?: string) => void;
  className?: string;
}

export function AgentPanel({
  eventId,
  eventName,
  lifecycleState,
  isRunning = false,
  onOperationsStarted,
  className = "",
}: AgentPanelProps) {
  const [starting, setStarting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

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

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5 shadow-2xl backdrop-blur-xl ${className}`}
    >
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left Info */}
        <div className="flex items-center gap-3.5">
          <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 text-cyan-400">
            <Bot className="w-6 h-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-zinc-950" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide uppercase text-zinc-100 flex items-center gap-1.5">
                Event Operations Agent
              </h2>
              <span
                className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                  isLive
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}
              >
                {isLive ? "Autonomous Live" : lifecycleState || "Planning"}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Continuously orchestrating discovery, provider outreach, quoting, and adaptive recovery for{" "}
              <span className="text-zinc-200 font-medium">{eventName}</span>.
            </p>
          </div>
        </div>

        {/* Right CTA */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          {!isLive && (
            <button
              onClick={handleStartOperations}
              disabled={starting}
              className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 transition-all duration-200 active:scale-95 disabled:opacity-50"
            >
              {starting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initiating Operations...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Start Autonomous Operations
                </>
              )}
            </button>
          )}

          {isLive && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Active Monitoring & Sourcing
            </div>
          )}
        </div>
      </div>

      {lastMessage && (
        <div className="mt-3.5 pt-3 border-t border-zinc-800/60 text-xs text-zinc-300 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span>{lastMessage}</span>
        </div>
      )}
    </div>
  );
}
