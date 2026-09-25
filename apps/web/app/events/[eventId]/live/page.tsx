"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Radio,
  Play,
  CheckCircle,
  AlertTriangle,
  Clock,
  Flame,
  Zap,
  RefreshCw,
  Sliders,
  ChevronRight,
  ShieldAlert,
  PowerOff,
  UserX,
  X,
  Users,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import {
  getLiveState,
  goLive,
  concludeEvent,
  updateTaskStatus,
} from "../../../../lib/api/live";
import { createIncident } from "../../../../lib/api/incidents";
import { getAssignmentsForEvent } from "../../../../lib/api/vendors";
import { ExecutionPauseControl } from "../../../../components/operations";
import type {
  EventLiveState,
  TaskProgress,
  TaskStatus,
  VendorAssignmentResponse,
} from "../../../../types/api";

export default function LiveCommandPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.eventId as string;

  const [liveState, setLiveState] = useState<EventLiveState | null>(null);
  const [providerAssignments, setProviderAssignments] = useState<VendorAssignmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);


  // Status update modal state
  const [selectedTask, setSelectedTask] = useState<TaskProgress | null>(null);
  const [newStatus, setNewStatus] = useState<TaskStatus>("IN_PROGRESS");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Demo incident trigger modal
  const [triggeringDemo, setTriggeringDemo] = useState(false);

  const fetchLiveState = useCallback(async () => {
    try {
      const [data, assignmentsData] = await Promise.all([
        getLiveState(eventId),
        getAssignmentsForEvent(eventId).catch(() => []),
      ]);
      setLiveState(data);
      setProviderAssignments(assignmentsData || []);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load live state";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId) {
      fetchLiveState();
    }
  }, [eventId, fetchLiveState]);

  // Polling loop
  useEffect(() => {
    if (!autoRefresh || !eventId) return;
    const interval = setInterval(() => {
      fetchLiveState();
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, eventId, fetchLiveState]);

  async function handleGoLive() {
    try {
      setTransitioning(true);
      setError(null);
      const res = await goLive(eventId, "Master command authorized live start");
      setLiveState(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate live state";
      setError(msg);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleConclude() {
    if (!confirm("Are you sure you want to conclude this live event?")) return;
    try {
      setTransitioning(true);
      const res = await concludeEvent(eventId, "Operations formally completed");
      setLiveState(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to conclude event";
      setError(msg);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleUpdateTask() {
    if (!selectedTask) return;
    try {
      setUpdatingStatus(true);
      await updateTaskStatus(
        eventId,
        selectedTask.task_id,
        newStatus,
        newStatus === "IN_PROGRESS" ? new Date().toISOString() : undefined,
        newStatus === "COMPLETED" ? new Date().toISOString() : undefined
      );
      setSelectedTask(null);
      await fetchLiveState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update task";
      alert(msg);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleSimulateVendorNoShow() {
    try {
      setTriggeringDemo(true);
      const avTask = liveState?.task_progress?.find((t) => 
        t.task_name.toLowerCase().includes("audio") || 
        t.task_name.toLowerCase().includes("av") || 
        t.task_name.toLowerCase().includes("video")
      ) || liveState?.task_progress?.find((t) => t.is_critical_path) || liveState?.task_progress?.[0];

      const incident = await createIncident(eventId, {
        incident_type: "VENDOR_NO_SHOW",
        title: "CRITICAL: Key AV Sound Engineer Failed to Arrive (Beamline AV)",
        description:
          "Lead audio technician from primary vendor failed to check in at scheduled time T-45m. Audio setup and stage rehearsal blocked.",
        severity: "CRITICAL",
        source: "LIVE_COMMAND_TRIGGER",
        related_task_id: avTask?.task_id || undefined,
        related_vendor_id: "vnd-003-blr-av",
        evidence_metadata: {
          delay_minutes: 45,
          call_time_missed_minutes: 45,
          phone_attempts: 4,
          provider_eta_minutes: { "vnd-012-sea-av": 25 },
        },
        occurred_at: new Date().toISOString(),
      });
      // Redirect directly to the incident analysis screen
      router.push(`/events/${eventId}/incidents`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to trigger demo incident";
      alert(msg);
    } finally {
      setTriggeringDemo(false);
    }
  }

  const isLive = liveState?.lifecycle_state === "LIVE";
  const tasks = liveState?.task_progress || [];
  const deviations = liveState?.schedule_deviations || [];
  const summary = liveState?.task_summary || {};

  return (
    <div className="space-y-6">
      {/* Top Telemetry & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                {isLive && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-3 w-3 ${
                    isLive ? "bg-emerald-500" : "bg-muted-foreground/50"
                  }`}
                />
              </span>
              Live Operations Command
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                isLive
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : liveState?.lifecycle_state === "INCIDENT"
                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse"
                  : "bg-secondary text-muted-foreground border border-border/40"
              }`}
            >
              {liveState?.lifecycle_state || "OFFLINE"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time execution telemetry, task progression state machine, and deviation tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 1-Click Demo Injector Button */}
          <button
            onClick={handleSimulateVendorNoShow}
            disabled={triggeringDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors shadow-[0_0_12px_rgba(244,63,94,0.2)]"
          >
            <UserX className="w-3.5 h-3.5" />
            {triggeringDemo ? "Triggering..." : "Simulate Vendor No-Show"}
          </button>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              autoRefresh
                ? "bg-primary/10 text-primary border-primary/30"
                : "border-border/60 text-muted-foreground hover:bg-card"
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? "text-emerald-400 animate-pulse" : ""}`} />
            {autoRefresh ? "Auto-Polling" : "Polling Paused"}
          </button>

          {!isLive && (
            <button
              onClick={handleGoLive}
              disabled={transitioning}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {transitioning ? "Initiating..." : "GO LIVE"}
            </button>
          )}

          {isLive && (
            <button
              onClick={handleConclude}
              disabled={transitioning}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400 text-muted-foreground transition-colors"
            >
              <PowerOff className="w-3.5 h-3.5" />
              Conclude
            </button>
          )}
        </div>
      </div>

      {/* Task 11 Real Pause / Resume Operational Control */}
      <ExecutionPauseControl eventId={eventId} onStateChange={() => fetchLiveState()} />

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchLiveState}
            className="underline font-semibold hover:text-rose-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* Live KPI Telemetry */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            Progress Completion
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground mt-2">
            {liveState?.progress_percent?.toFixed(0) ?? 0}%
          </div>
          <div className="w-full bg-secondary/50 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${liveState?.progress_percent ?? 0}%` }}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            Completed Tasks
          </div>
          <div className="text-2xl font-bold tracking-tight text-emerald-400 mt-2">
            {liveState?.completed_tasks ?? 0}
            <span className="text-xs font-normal text-muted-foreground">
              {" "}
              / {liveState?.total_tasks ?? 0}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Authoritative progress count
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Schedule Deviations
          </div>
          <div
            className={`text-2xl font-bold tracking-tight mt-2 ${
              deviations.length > 0 ? "text-amber-400" : "text-foreground"
            }`}
          >
            {deviations.length}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Tasks with recorded slippage
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            Active Incidents
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground mt-2">
            {liveState?.lifecycle_state === "INCIDENT" ? "1 Active" : "None"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            System status monitoring
          </div>
        </div>
      </div>

      {/* Task Summary Badges */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-border/40 bg-card/20 backdrop-blur-sm text-xs">
        <span className="text-muted-foreground font-medium uppercase text-[10px] tracking-wider mr-2">
          Fleet Task Breakdown:
        </span>
        {Object.entries(summary).map(([status, count]) => (
          <span
            key={status}
            className="px-2.5 py-1 rounded-lg bg-card border border-border/50 font-mono text-xs flex items-center gap-1.5"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === "COMPLETED"
                  ? "bg-emerald-400"
                  : status === "IN_PROGRESS"
                  ? "bg-blue-400 animate-pulse"
                  : status === "BLOCKED"
                  ? "bg-amber-400"
                  : status === "FAILED"
                  ? "bg-rose-400"
                  : "bg-muted-foreground/40"
              }`}
            />
            <span className="font-semibold text-foreground">{count}</span>
            <span className="text-muted-foreground">{status}</span>
          </span>
        ))}
      </div>

      {/* Deviations Alert (if any) */}
      {deviations.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Live Schedule Deviations Detected ({deviations.length})
            </h3>
          </div>
          <div className="grid gap-2">
            {deviations.map((dev, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-background/60 border border-amber-500/20 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-amber-300 mr-2">
                    {dev.task_name}
                  </span>
                  <span className="text-muted-foreground">
                    Deviation: {dev.deviation_type}
                  </span>
                </div>
                <div className="font-mono font-bold text-amber-400">
                  +{dev.deviation_minutes}m slippage
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contracted Provider Readiness & Negotiation Telemetry */}
      {providerAssignments.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-foreground">
                Provider Network & Negotiation Readiness
              </h2>
            </div>
            <button
              onClick={() => router.push(`/events/${eventId}/vendors`)}
              className="text-xs text-primary hover:underline flex items-center gap-1 font-mono"
            >
              <span>Manage All ({providerAssignments.length})</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {providerAssignments.map((pa) => {
              const negStatus = (pa.negotiation_status || "NOT_CONTACTED").toUpperCase();
              const isAwaiting = negStatus === "AWAITING_APPROVAL";
              const isConfirmed = negStatus === "CONFIRMED";
              const isNeg = negStatus === "NEGOTIATING";

              return (
                <div
                  key={pa.id}
                  onClick={() => router.push(`/events/${eventId}/vendors`)}
                  className={`p-3 rounded-xl border bg-background/80 cursor-pointer hover:border-primary/50 transition flex flex-col justify-between space-y-2 ${
                    isAwaiting
                      ? "border-purple-600/60 shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                      : isConfirmed
                      ? "border-emerald-600/40"
                      : isNeg
                      ? "border-amber-600/40"
                      : "border-border/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                      {pa.category}
                    </span>
                    {isAwaiting && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold animate-pulse">
                        APPROVAL REQUIRED
                      </span>
                    )}
                    {isConfirmed && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                        CONFIRMED & READY
                      </span>
                    )}
                    {isNeg && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                        AI NEGOTIATING
                      </span>
                    )}
                    {negStatus === "CONTACTED" && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
                        CONTACTED
                      </span>
                    )}
                    {negStatus === "NOT_CONTACTED" && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground text-[9px]">
                        NOT CONTACTED
                      </span>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {pa.vendor?.name || `Provider #${pa.vendor_id}`}
                    </h4>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      Cost: {pa.currency || "INR"} {Number(pa.agreed_cost || pa.quoted_amount || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Real-time Task Progression Table */}
      <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
        <div className="p-4 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Live Task Progression & Operational State Machine
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {tasks.length} Tracked Tasks
          </span>
        </div>

        {tasks.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No live task progress available. Generate plan and compute schedule first.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {tasks.map((task) => (
              <div
                key={task.task_id}
                className="p-4 hover:bg-card/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {task.is_critical_path && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <Flame className="w-2.5 h-2.5" />
                        CRITICAL
                      </span>
                    )}
                    <span className="text-xs font-semibold text-foreground">
                      {task.task_name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        task.status === "COMPLETED"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : task.status === "IN_PROGRESS"
                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          : task.status === "BLOCKED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : task.status === "FAILED"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : "bg-secondary text-muted-foreground border border-border/40"
                      }`}
                    >
                      {task.status}
                    </span>
                    {task.deviation_minutes !== 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">
                        +{task.deviation_minutes}m
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                    <span>
                      Planned:{" "}
                      {task.planned_start
                        ? new Date(task.planned_start).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "TBD"}{" "}
                      -{" "}
                      {task.planned_end
                        ? new Date(task.planned_end).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "TBD"}
                    </span>
                    {task.actual_start && (
                      <span className="text-foreground">
                        Started:{" "}
                        {new Date(task.actual_start).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedTask(task);
                      setNewStatus(task.status as TaskStatus);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-border/60 hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Update Status
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Task Status Transition Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Update Task Status
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedTask.task_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Operational Transition
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    "PENDING",
                    "READY",
                    "IN_PROGRESS",
                    "BLOCKED",
                    "COMPLETED",
                    "FAILED",
                  ] as TaskStatus[]
                ).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setNewStatus(status)}
                    className={`p-2.5 rounded-lg text-xs font-semibold border text-center transition-colors ${
                      newStatus === status
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/40 text-muted-foreground hover:text-foreground border-border/50"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => setSelectedTask(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 hover:bg-card text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTask}
                disabled={updatingStatus}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
                {updatingStatus ? "Persisting..." : "Save State Transition"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
