"use client";

import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Loader2,
  Radio,
} from "lucide-react";
import type {
  EventLiveState,
  EventExecutionStateResponse,
} from "@/types/api";
import { pauseEvent, resumeEvent } from "@/lib/api/events";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface OperationalHealthCardProps {
  eventId: string;
  liveState: EventLiveState | null;
  executionState?: EventExecutionStateResponse | null;
  activeIncidentsCount?: number;
  onStateChanged?: () => void;
  className?: string;
}

export function OperationalHealthCard({
  eventId,
  liveState,
  executionState,
  activeIncidentsCount = 0,
  onStateChanged,
  className = "",
}: OperationalHealthCardProps) {
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!liveState) {
    return (
      <div className={`p-5 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <Activity className="w-5 h-5 mx-auto mb-1.5 text-slate-300" />
        <p className="font-semibold text-slate-700">Operational Health</p>
        <p className="text-slate-400 mt-0.5">Live operational state is unavailable.</p>
      </div>
    );
  }

  // Authoritative status from backend
  const overallStatus =
    liveState.overall_status ||
    (activeIncidentsCount > 0 ? "DEGRADED" : "NORMAL");

  const isPaused = executionState?.is_paused ?? false;
  const execState = executionState?.execution_state || (isPaused ? "PAUSED" : "RUNNING");

  const STATUS_STYLES: Record<
    string,
    { label: string; badge: string; icon: React.ReactNode; desc: string }
  > = {
    NORMAL: {
      label: "OPERATIONS NORMAL",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      desc: "Telemetry signals nominal. Tasks and providers executing on schedule.",
    },
    DEGRADED: {
      label: "OPERATIONS DEGRADED",
      badge: "bg-amber-50 text-amber-800 border-amber-200",
      icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
      desc: "Schedule deviations or active non-critical incidents detected.",
    },
    DISRUPTED: {
      label: "OPERATIONS DISRUPTED",
      badge: "bg-rose-50 text-rose-700 border-rose-200",
      icon: <ShieldAlert className="w-4 h-4 text-rose-600" />,
      desc: "Critical incident or blocking dependency active. Immediate intervention required.",
    },
  };

  const statusConfig = STATUS_STYLES[overallStatus] || STATUS_STYLES.NORMAL;

  const handlePause = async () => {
    if (!pauseReason.trim()) return;
    try {
      setIsPausing(true);
      setActionError(null);
      await pauseEvent(eventId, {
        reason: pauseReason.trim(),
        plan_version: executionState?.plan_version,
      });
      setShowPauseModal(false);
      setPauseReason("");
      if (onStateChanged) onStateChanged();
    } catch (err: any) {
      console.error("Failed to pause execution:", err);
      setActionError(err.message || "Failed to pause execution on backend.");
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    try {
      setIsResuming(true);
      setActionError(null);
      await resumeEvent(eventId, {
        reason: "Operations resumed by authorized operator",
        plan_version: executionState?.plan_version,
      });
      if (onStateChanged) onStateChanged();
    } catch (err: any) {
      console.error("Failed to resume execution:", err);
      setActionError(err.message || "Failed to resume execution on backend.");
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className={`p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4 ${className}`}>
      {/* Header & Status Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Live Operations Health
            </span>
            <ProvenanceBadge source="ENGINE" size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border flex items-center gap-1.5 ${statusConfig.badge}`}
            >
              {statusConfig.icon}
              {statusConfig.label}
            </span>

            {isPaused && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                EXECUTION PAUSED
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            {statusConfig.desc}
          </p>
        </div>

        {/* Execution Flow Control (Pause / Resume) */}
        <div className="flex items-center gap-2 shrink-0">
          {isPaused ? (
            <button
              onClick={handleResume}
              disabled={isResuming}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {isResuming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
              <span>Resume Execution</span>
            </button>
          ) : (
            <button
              onClick={() => setShowPauseModal(true)}
              disabled={isPausing}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 text-xs font-bold transition flex items-center gap-1.5"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              <span>Pause Operations</span>
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-[10px] font-bold text-rose-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary Live Telemetry Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Active Incidents
          </span>
          <span
            className={`font-mono font-bold text-sm block ${
              activeIncidentsCount > 0 ? "text-rose-600" : "text-slate-800"
            }`}
          >
            {activeIncidentsCount}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Schedule Deviations
          </span>
          <span
            className={`font-mono font-bold text-sm block ${
              liveState.schedule_deviations.length > 0 ? "text-amber-600" : "text-emerald-700"
            }`}
          >
            {liveState.schedule_deviations.length}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Task Progress
          </span>
          <span className="font-mono font-bold text-slate-800 text-sm block">
            {liveState.progress_percent.toFixed(1)}%
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Execution State
          </span>
          <span className="font-mono font-bold text-slate-800 text-sm block">
            {execState}
          </span>
        </div>
      </div>

      {/* Pause Confirmation Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
              <PauseCircle className="w-4 h-4 text-rose-600" />
              <span>Pause Live Event Operations</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Pausing will record an authoritative pause event, hold scheduled workflow triggers, and prevent autonomous task progression until resumed.
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-slate-500">
                Reason for Pause (Required)
              </label>
              <textarea
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="e.g., Weather delay, technical rehearsal hold, or operator checkpoint..."
                rows={3}
                className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setShowPauseModal(false);
                  setPauseReason("");
                }}
                disabled={isPausing}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={isPausing || !pauseReason.trim()}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isPausing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PauseCircle className="w-3.5 h-3.5" />
                )}
                <span>Confirm Pause</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
