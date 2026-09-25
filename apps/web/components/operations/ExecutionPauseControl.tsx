"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Pause,
  Play,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ShieldCheck,
  History,
  CheckCircle2,
  XCircle,
  Loader2,
  Lock,
  Layers,
  FileText,
  User,
} from "lucide-react";
import {
  pauseEvent,
  resumeEvent,
  getEventExecutionState,
  getEventPauseHistory,
} from "../../lib/api/events";
import type {
  EventExecutionStateResponse,
  PauseResumeRecordResponse,
} from "../../types/api";

interface ExecutionPauseControlProps {
  eventId: string;
  onStateChange?: (state: string) => void;
  className?: string;
}

export default function ExecutionPauseControl({
  eventId,
  onStateChange,
  className = "",
}: ExecutionPauseControlProps) {
  const [execState, setExecState] = useState<EventExecutionStateResponse | null>(null);
  const [history, setHistory] = useState<PauseResumeRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [reasonInput, setReasonInput] = useState("");

  const loadState = useCallback(async () => {
    try {
      const data = await getEventExecutionState(eventId);
      setExecState(data);
      if (onStateChange) {
        onStateChange(data.execution_state);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load execution state");
    } finally {
      setLoading(false);
    }
  }, [eventId, onStateChange]);

  useEffect(() => {
    if (eventId) {
      loadState();
    }
  }, [eventId, loadState]);

  const loadHistory = async () => {
    try {
      const hist = await getEventPauseHistory(eventId);
      setHistory(hist);
    } catch (err: any) {
      // Non-blocking
    }
  };

  const handlePause = async () => {
    if (!reasonInput || reasonInput.trim().length < 3) {
      setError("Please provide a valid operational reason for pausing execution.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pauseEvent(eventId, {
        reason: reasonInput.trim(),
        plan_version: execState?.plan_version,
      });
      setShowPauseModal(false);
      setReasonInput("");
      await loadState();
    } catch (err: any) {
      setError(err?.message || "Failed to pause execution.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await resumeEvent(eventId, {
        reason: reasonInput.trim() || undefined,
        plan_version: execState?.plan_version,
      });
      setShowResumeModal(false);
      setReasonInput("");
      await loadState();
    } catch (err: any) {
      setError(err?.message || "Failed to resume execution.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-4 rounded-xl border border-border/40 bg-card/40 flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Loading execution state...</span>
      </div>
    );
  }

  const state = execState?.execution_state || "RUNNING";
  const isPaused = state === "PAUSED";
  const isPausing = state === "PAUSING";
  const isResuming = state === "RESUMING";
  const isRunning = state === "RUNNING";

  const getStatusBadge = () => {
    switch (state) {
      case "RUNNING":
        return {
          bg: "bg-emerald-950/80 border-emerald-500/50 text-emerald-400",
          dot: "bg-emerald-500 animate-pulse",
          text: "RUNNING",
        };
      case "PAUSING":
        return {
          bg: "bg-amber-950/80 border-amber-500/50 text-amber-400",
          dot: "bg-amber-500 animate-spin",
          text: "PAUSING...",
        };
      case "PAUSED":
        return {
          bg: "bg-rose-950/90 border-rose-500/60 text-rose-300",
          dot: "bg-rose-500",
          text: "PAUSED",
        };
      case "RESUMING":
        return {
          bg: "bg-cyan-950/80 border-cyan-500/50 text-cyan-400",
          dot: "bg-cyan-500 animate-spin",
          text: "RESUMING...",
        };
      default:
        return {
          bg: "bg-secondary border-border/40 text-muted-foreground",
          dot: "bg-muted-foreground",
          text: state,
        };
    }
  };

  const badge = getStatusBadge();
  const lastRecord = execState?.last_pause_record;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* State Bar Banner */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          isPaused
            ? "border-rose-500/50 bg-rose-950/30 shadow-[0_0_24px_rgba(244,63,94,0.12)]"
            : isPausing || isResuming
            ? "border-amber-500/40 bg-amber-950/20"
            : "border-border/60 bg-card/60"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${badge.bg}`}>
                <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                {badge.text}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                Plan v{execState?.plan_version ?? 1}
              </span>
              {execState?.active_incidents_count ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                  <ShieldAlert className="w-3 h-3" />
                  {execState.active_incidents_count} Active Incident{execState.active_incidents_count > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>

            {isPaused ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm font-semibold text-rose-200 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-rose-400" />
                  Event execution is paused.
                </p>
                <p className="text-xs text-rose-300/80">
                  Consequential agent mutations and recovery actions are blocked. Task assignments, vendor bindings, and execution plan are strictly preserved.
                </p>
                {lastRecord && (
                  <div className="mt-2 pt-2 border-t border-rose-500/20 text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <span className="text-rose-400/90 font-medium">Reason: </span>
                      <span className="text-foreground/90">{String(lastRecord.reason || "Operational pause")}</span>
                    </div>
                    <div>
                      <span className="text-rose-400/90 font-medium">Requested By: </span>
                      <span className="text-foreground/90">{String(lastRecord.requested_by || "Unknown")}</span>
                    </div>
                    <div>
                      <span className="text-rose-400/90 font-medium">Time: </span>
                      <span className="text-foreground/90">
                        {lastRecord.requested_at ? new Date(String(lastRecord.requested_at)).toLocaleTimeString() : "N/A"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Authoritative execution is active. Automated task scheduling, agent telemetry, and recovery engines are operational.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isRunning && (
              <button
                onClick={() => {
                  setReasonInput("");
                  setShowPauseModal(true);
                }}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all shadow-[0_0_12px_rgba(245,158,11,0.15)]"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                Pause Event
              </button>
            )}

            {isPaused && (
              <button
                onClick={() => {
                  setReasonInput("");
                  setShowResumeModal(true);
                }}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-950/40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume Event
              </button>
            )}

            <button
              onClick={() => {
                loadHistory();
                setShowHistoryModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border/60 hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              History
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 text-xs font-bold">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Pause Confirmation Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                <Pause className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Pause Event Execution</h3>
                <p className="text-xs text-muted-foreground">Freeze consequential actions and recovery mutations</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Pausing halts all scheduled task dispatching and agent recovery mutations. Task assignments, vendor bindings, and budget commitments remain intact.
              </p>
              <label className="block font-medium text-foreground text-xs pt-1">
                Reason for Pause <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="e.g., Severe thunderstorm protocol triggered, pausing sound/stage tasks."
                rows={3}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => setShowPauseModal(false)}
                disabled={submitting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-muted-foreground hover:bg-secondary/40"
              >
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={submitting || !reasonInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                Confirm Pause
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Confirmation Modal */}
      {showResumeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-emerald-400">
              <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Play className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Resume Event Execution</h3>
                <p className="text-xs text-muted-foreground">Restore operational dispatch and agent recovery</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                The system will validate state integrity before restoring execution to RUNNING. Any active incidents will require fresh validation before actions can execute.
              </p>
              <label className="block font-medium text-foreground text-xs pt-1">
                Optional Resume Note
              </label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="e.g., Weather cleared, operations resumed."
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => setShowResumeModal(false)}
                disabled={submitting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-muted-foreground hover:bg-secondary/40"
              >
                Cancel
              </button>
              <button
                onClick={handleResume}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Confirm Resume
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-card border border-border rounded-xl p-5 shadow-2xl space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-border/40">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Execution Pause & Resume Audit Log</h3>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {history.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No pause or resume records logged for this event.
                </div>
              ) : (
                history.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-3 rounded-lg border border-border/50 bg-secondary/20 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            rec.operation_type === "PAUSE"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {rec.operation_type}
                        </span>
                        <span className="font-mono text-muted-foreground text-[11px]">
                          {rec.previous_state} → {rec.target_state}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {rec.requested_at ? new Date(rec.requested_at).toLocaleString() : "N/A"}
                      </span>
                    </div>

                    <div className="text-foreground/90 font-medium pt-1">
                      {rec.reason || "No operational reason provided."}
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1 border-t border-border/20">
                      <span>Requester: <strong className="text-foreground">{rec.requested_by}</strong></span>
                      <span>Plan: <strong className="text-foreground">v{rec.plan_version}</strong></span>
                      <span>Status: <strong className="text-emerald-400">{rec.status}</strong></span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
