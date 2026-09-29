"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Radio,
  Clock,
  Activity,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Users,
  RotateCcw,
  Building2,
  DollarSign,
  Layers,
  Sparkles,
  ExternalLink,
  Loader2,
  PowerOff,
  History,
} from "lucide-react";

import {
  getLiveState,
  getProvidersLiveState,
  concludeEvent,
} from "@/lib/api/live";
import {
  getEvent,
  getEventExecutionState,
} from "@/lib/api/events";
import { listIncidents } from "@/lib/api/incidents";
import { listApprovals } from "@/lib/api/approvals";
import { getActivityStream } from "@/lib/api/activityStream";
import { getFinalExecutionPlan } from "@/lib/api/planning";

import type {
  EventResponse,
  EventLiveState,
  EventExecutionStateResponse,
  ProviderOperationalSummary,
  IncidentResponse,
  ApprovalRequestResponse,
  FinalExecutionPlan,
} from "@/types/api";
import type { ActivityLogItem } from "@/types/activityLog";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";

import { OperationalHealthCard } from "./OperationalHealthCard";
import { ExecutionOverview } from "./ExecutionOverview";
import { LiveTaskMatrix } from "./LiveTaskMatrix";
import { ProviderExecutionPanel } from "./ProviderExecutionPanel";
import { CriticalPathTimeline } from "./CriticalPathTimeline";
import { RecoveryTimeline } from "./RecoveryTimeline";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { AgentStatusCard } from "./AgentStatusCard";

interface LiveOperationsCommandProps {
  eventId: string;
  className?: string;
}

export function LiveOperationsCommand({
  eventId,
  className = "",
}: LiveOperationsCommandProps) {
  const { sseConnected } = useEventWorkspace(eventId);
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [liveState, setLiveState] = useState<EventLiveState | null>(null);
  const [executionState, setExecutionState] = useState<EventExecutionStateResponse | null>(null);
  const [providerSummary, setProviderSummary] = useState<ProviderOperationalSummary | null>(null);
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestResponse[]>([]);
  const [finalPlan, setFinalPlan] = useState<FinalExecutionPlan | null>(null);
  const [activities, setActivities] = useState<ActivityLogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [isConcluding, setIsConcluding] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Authoritative load function
  const loadLiveData = useCallback(async () => {
    if (!eventId) return;
    try {
      setErrorMessage(null);

      const [
        evRes,
        liveRes,
        execRes,
        provRes,
        incRes,
        appRes,
        planRes,
        actRes,
      ] = await Promise.allSettled([
        getEvent(eventId),
        getLiveState(eventId),
        getEventExecutionState(eventId),
        getProvidersLiveState(eventId),
        listIncidents(eventId),
        listApprovals(eventId),
        getFinalExecutionPlan(eventId),
        getActivityStream(eventId),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }
      if (liveRes.status === "fulfilled" && liveRes.value) {
        setLiveState(liveRes.value);
      }
      if (execRes.status === "fulfilled" && execRes.value) {
        setExecutionState(execRes.value);
      }
      if (provRes.status === "fulfilled" && provRes.value) {
        setProviderSummary(provRes.value);
      }
      if (incRes.status === "fulfilled" && incRes.value?.items) {
        setIncidents(incRes.value.items);
      }
      if (appRes.status === "fulfilled" && Array.isArray(appRes.value)) {
        setApprovals(appRes.value);
      }
      if (planRes.status === "fulfilled" && planRes.value) {
        setFinalPlan(planRes.value);
      }
      if (actRes.status === "fulfilled" && actRes.value?.items) {
        setActivities(actRes.value.items);
      }

      setLastUpdated(new Date());
    } catch (err: any) {
      console.error("Live command poll failed:", err);
      setErrorMessage(err.message || "Failed to update live operational state.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Initial load + Controlled fallback polling only if SSE is disconnected
  useEffect(() => {
    loadLiveData();
    if (sseConnected) return; // Real-time mutations streamed via SSE

    const intervalId = setInterval(() => {
      // Avoid polling if browser tab is in background
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      loadLiveData();
    }, 8000);

    return () => clearInterval(intervalId);
  }, [loadLiveData, sseConnected]);

  // Action: Conclude Event
  const handleConcludeEvent = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to conclude live operations? This transitions the event lifecycle to CONCLUDED."
    );
    if (!confirmed) return;

    try {
      setIsConcluding(true);
      setStatusMessage("Concluding live operations on backend...");
      const res = await concludeEvent(eventId, "Operations completed by operator action");
      setLiveState(res);
      setStatusMessage("Event concluded successfully.");
      await loadLiveData();
    } catch (err: any) {
      console.error("Failed to conclude event:", err);
      setErrorMessage(err.message || "Failed to conclude event on backend.");
    } finally {
      setIsConcluding(false);
    }
  };

  const activeIncidents = incidents.filter(
    (i) => String(i.status).toUpperCase() !== "RESOLVED"
  );
  const pendingApprovals = approvals.filter(
    (a) => String(a.status).toUpperCase() === "PENDING"
  );

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top Command Bar & Operational Pulse */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-[#D6003C] animate-pulse" />
                Live Operational Command
              </span>
              <ProvenanceBadge source="ENGINE" size="sm" />
              <span className="text-[10px] font-mono text-slate-400">
                Poll: 6s heartbeat
              </span>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                Synced: {lastUpdated.toLocaleTimeString()}
              </span>
            </div>

            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              {eventData?.name || "Target Event"} &mdash; Execution Telemetry
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 max-w-3xl leading-relaxed">
              Real-time synchronization across task progress, schedule deviations, supplier execution, incident monitors, and operational pause controls.
            </p>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleConcludeEvent}
              disabled={isConcluding}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              {isConcluding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              ) : (
                <PowerOff className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>Conclude Event</span>
            </button>

            <button
              onClick={loadLiveData}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
              title="Force Refresh Telemetry"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Status & Error Alerts */}
        {statusMessage && (
          <div className="mt-4 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-bold text-emerald-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-[10px] font-bold text-rose-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Agent Operational Status Card */}
      <AgentStatusCard
        eventId={eventId}
        lifecycleState={eventData?.lifecycle_state || "LIVE"}
        eventState={eventData?.state || "NORMAL"}
        pendingApprovalsCount={pendingApprovals.length}
        latestOperation={activities?.[0]?.action || null}
        lastActiveTime={activities?.[0]?.timestamp || null}
        onRunComplete={loadLiveData}
      />

      {/* Row 1: Operational Health & Task Completion Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <OperationalHealthCard
            eventId={eventId}
            liveState={liveState}
            executionState={executionState}
            activeIncidentsCount={activeIncidents.length}
            onStateChanged={loadLiveData}
          />
        </div>
        <div className="lg:col-span-5">
          <ExecutionOverview liveState={liveState} />
        </div>
      </div>

      {/* Row 2: Live Task Matrix */}
      <div>
        <LiveTaskMatrix
          eventId={eventId}
          tasks={liveState?.task_progress || []}
          isPaused={executionState?.is_paused}
          onTaskUpdated={loadLiveData}
        />
      </div>

      {/* Row 3: Supplier & Provider Operational State */}
      <div>
        <ProviderExecutionPanel
          eventId={eventId}
          providerSummary={providerSummary}
        />
      </div>

      {/* Row 4: Critical Path & Active Incident Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Critical Path Method (CPM) Real Tasks */}
        <div className="lg:col-span-7">
          <CriticalPathTimeline
            criticalPathEntries={finalPlan?.critical_path}
            totalDurationMinutes={finalPlan?.total_critical_duration_minutes}
          />
        </div>

        {/* Incident Monitor */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-[#D6003C]" />
                Incident Monitor
              </span>
              <span
                className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                  activeIncidents.length > 0
                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}
              >
                {activeIncidents.length} Active
              </span>
            </div>

            <Link
              href={`/events/${eventId}/incidents`}
              className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1"
            >
              <span>Incident Command</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-2.5 max-h-80">
            {activeIncidents.map((inc) => (
              <div
                key={inc.id}
                className="p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-all text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200">
                    {inc.severity}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {new Date(inc.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <h4 className="font-semibold text-slate-900 leading-snug">
                  {inc.title}
                </h4>
                {inc.description && (
                  <p className="text-[11px] text-slate-500 line-clamp-2">
                    {inc.description}
                  </p>
                )}
                <div className="pt-1 flex items-center justify-between border-t border-slate-100">
                  <span className="text-[10px] font-mono text-slate-400">
                    Status: {inc.status}
                  </span>
                  <Link
                    href={`/events/${eventId}/recovery?incidentId=${inc.id}`}
                    className="text-[10px] font-bold text-[#D6003C] hover:underline"
                  >
                    View Recovery &rarr;
                  </Link>
                </div>
              </div>
            ))}

            {activeIncidents.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-500" />
                <p className="font-semibold text-slate-700">No active incidents reported by backend.</p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Operating nominally under standard contingency envelopes.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 5: Pending Governance Approvals & Live Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Pending Approvals */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                Governance Gate
              </span>
              <span className="text-xs font-bold text-slate-800">
                Pending Approvals ({pendingApprovals.length})
              </span>
            </div>
            <Link
              href={`/events/${eventId}/approvals`}
              className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1"
            >
              <span>Approvals Command</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="p-4 space-y-2.5 max-h-72 overflow-y-auto text-xs">
            {pendingApprovals.map((app) => (
              <div
                key={app.id}
                className="p-3 rounded-lg border border-amber-200 bg-amber-50/40 text-amber-900 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-slate-900">{app.action_type}</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                      {app.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {app.decision_notes ||
                      app.rejection_reason ||
                      (app.requested_action
                        ? JSON.stringify(app.requested_action)
                        : "Action requires authorized human sign-off.")}
                  </p>
                  <span className="text-[10px] font-mono text-slate-400 mt-1 block">
                    ID: {app.id}
                  </span>
                </div>
              </div>
            ))}

            {pendingApprovals.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">
                No approvals are currently blocking live operations.
              </p>
            )}
          </div>
        </div>

        {/* Live Activity Stream */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
                <History className="w-3 h-3 text-[#D6003C]" />
                Activity Stream
              </span>
              <span className="text-xs font-bold text-slate-800">
                Real-Time Event Stream
              </span>
            </div>
            <Link
              href={`/events/${eventId}/activity`}
              className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1"
            >
              <span>Full Feed</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="p-4 space-y-2 max-h-72 overflow-y-auto text-xs">
            {activities.slice(0, 8).map((act) => (
              <div
                key={act.id}
                className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-slate-900 truncate">
                      {act.action}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase bg-slate-200 text-slate-700">
                      {act.actor}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug line-clamp-1">
                    {act.summary || JSON.stringify(act.details) || "Logged action"}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  {act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : ""}
                </span>
              </div>
            ))}

            {activities.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">
                No activity records logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
