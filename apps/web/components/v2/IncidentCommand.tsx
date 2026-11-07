"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ShieldAlert,
  Radio,
  Clock,
  User,
  CheckCircle2,
  MessageSquare,
  Activity,
  Info,
  Search,
  Filter,
  RefreshCw,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  FileText,
  RotateCcw,
} from "lucide-react";

import {
  listIncidents,
  getIncident,
  recalculateIncident,
  resolveIncident,
} from "@/lib/api/incidents";
import { getLiveState } from "@/lib/api/live";
import type { IncidentResponse, EventLiveState } from "@/types/api";

import { ProvenanceBadge } from "./ProvenanceBadge";
import { ImpactAnalysisCard } from "./ImpactAnalysisCard";
import { ImpactDependencyGraph } from "./ImpactDependencyGraph";

interface IncidentCommandProps {
  eventId: string;
  className?: string;
}

export function IncidentCommand({
  eventId,
  className = "",
}: IncidentCommandProps) {
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null);
  const [liveState, setLiveState] = useState<EventLiveState | null>(null);

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // 1. Load Incidents & Live State
  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      const [incRes, liveRes] = await Promise.allSettled([
        listIncidents(eventId),
        getLiveState(eventId),
      ]);

      if (incRes.status === "fulfilled" && incRes.value?.items) {
        const items = incRes.value.items;
        setIncidents(items);
        setLoadFailed(false);
        // Functional update: don't depend on the selection (which refetched on every click).
        setSelectedIncident((cur) => cur ?? (items.length > 0 ? items[0] : null));
      } else if (incRes.status === "rejected") {
        // A failed load must never read as "no incidents".
        setLoadFailed(true);
        setErrorMessage(`Couldn't load problems: ${(incRes.reason as any)?.message || "the server didn't respond."}`);
      }

      if (liveRes.status === "fulfilled" && liveRes.value) {
        setLiveState(liveRes.value);
      }
    } catch (err: any) {
      console.error("Failed to load incident workspace:", err);
      setLoadFailed(true);
      setErrorMessage(err.message || "Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Recalculate Incident Impact
  const handleRecalculate = async (incidentId: string) => {
    try {
      setActionInProgress("recalculate");
      setStatusMessage("Recomputing impact analysis against live DAG state...");
      setErrorMessage(null);
      const updated = await recalculateIncident(eventId, incidentId);
      setSelectedIncident(updated);
      setStatusMessage("Deterministic impact recalculated.");
      await loadData();
    } catch (err: any) {
      setErrorMessage(err.message || "Recalculation failed.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Resolve Incident
  const handleResolve = async (incidentId: string) => {
    try {
      setActionInProgress("resolve");
      setStatusMessage("Marking incident resolved and updating live state...");
      setErrorMessage(null);
      const updated = await resolveIncident(
        eventId,
        incidentId,
        "Resolved by operator action in Incident Command"
      );
      setSelectedIncident(updated);
      setStatusMessage("Incident marked as RESOLVED.");
      await loadData();
    } catch (err: any) {
      setErrorMessage(err.message || "Resolution failed.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Authoritative severity color badges
  const getSeverityStyle = (sev?: string | null) => {
    const s = (sev || "MEDIUM").toUpperCase();
    switch (s) {
      case "CRITICAL":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "HIGH":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "MEDIUM":
        return "bg-standby-50 text-standby-700 border-standby-200";
      case "LOW":
        return "bg-slate-50 text-slate-700 border-slate-200";
      default:
        return "bg-slate-50 text-slate-600 border-slate-200";
    }
  };

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const matchesSearch =
        !search ||
        inc.title.toLowerCase().includes(search.toLowerCase()) ||
        (inc.description && inc.description.toLowerCase().includes(search.toLowerCase())) ||
        inc.incident_type.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (severityFilter !== "ALL" && inc.severity.toUpperCase() !== severityFilter) {
        return false;
      }

      if (statusFilter !== "ALL" && inc.status.toUpperCase() !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [incidents, search, severityFilter, statusFilter]);

  // Operational State badge
  const liveOperationalStatus = (liveState as any)?.overall_status || (liveState as any)?.status || "NORMAL";

  return (
    <div className={`space-y-5 ${className}`}>
      {/* 1. Header Toolbar & Live Operational Telemetry */}
      <div className="surface p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">Incident board</span>
              <span
                className={`chip ${
                  liveOperationalStatus === "NORMAL"
                    ? "border-go-200 bg-go-50 text-go-700"
                    : liveOperationalStatus === "DEGRADED"
                    ? "border-standby-200 bg-standby-50 text-standby-800"
                    : "border-cue-200 bg-cue-50 text-cue-700"
                }`}
              >
                <span
                  className={`cue-light ${
                    liveOperationalStatus === "NORMAL"
                      ? "bg-go-500"
                      : liveOperationalStatus === "DEGRADED"
                      ? "bg-standby-500 animate-cue-blink"
                      : "bg-cue-600 animate-cue-blink"
                  }`}
                />
                <span title={`Live state: ${String(liveOperationalStatus).toLowerCase()}`}>
                  {liveOperationalStatus === "NORMAL" ? "Go" : liveOperationalStatus === "DEGRADED" ? "Standby" : "Hold"}
                </span>
              </span>
              <span className="font-mono text-[10.5px] text-ink-500">
                {incidents.filter((i) => i.status !== "RESOLVED").length} active
              </span>
            </div>

            <h2
              className="mt-2 font-display text-[26px] font-extrabold leading-[1.02] tracking-[-0.025em] text-ink-900"
              style={{ fontStretch: "88%" }}
            >
              Problems &amp; risk
            </h2>
            <p className="mt-1 text-[13px] text-ink-600">
              Each problem shows its source, the engine’s calculated impact on your plan, and its current status.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className="btn-secondary">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <Link
              href={selectedIncident ? `/events/${eventId}/recovery?incidentId=${selectedIncident.id}` : `/events/${eventId}/recovery`}
              className="btn-cue"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Open recovery
            </Link>
          </div>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
              {statusMessage}
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-semibold text-blue-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              {errorMessage}
            </span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-[10px] font-semibold text-rose-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* 2. Split Workspace: Incident Stream (Left 4) vs Detail & Impact (Right 8) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN: Incidents List Stream (4 cols) */}
        <div className="surface lg:col-span-4 flex flex-col overflow-hidden h-[520px] lg:h-[680px]">
          {/* Search & Filter Toolbar */}
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search incidents by title..."
                className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-8 pr-3 text-[12.5px] text-ink-800 placeholder:text-ink-400 transition focus:border-ink-400 focus:bg-[#FDFCFA] focus:outline-none"
              />
            </div>

            {/* Severity Filter Pills */}
            <div className="flex items-center gap-1 text-[11px] overflow-x-auto no-scrollbar">
              {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`whitespace-nowrap rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide transition ${
                    severityFilter === sev
                      ? "bg-ink-900 text-ink-50"
                      : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Incident Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-dashed divide-ink-200">
            {loading && incidents.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-cue-600" />
                Loading live incident stream...
              </div>
            ) : loadFailed && incidents.length === 0 ? (
              <div role="alert" className="py-16 text-center text-[13px] text-slate-700 px-4">
                <p className="font-semibold text-slate-900">Couldn&apos;t load problems</p>
                <p className="mt-1 text-[12.5px] text-slate-600">This doesn&apos;t mean there are none.</p>
                <button onClick={loadData} className="btn-secondary mt-4">
                  Try again
                </button>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="py-20 text-center text-[13px] text-slate-600 px-4">
                {incidents.length === 0 ? "No problems have been reported for this event." : "No problems match these filters."}
              </div>
            ) : (
              filteredIncidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                const isResolved = inc.status === "RESOLVED";

                return (
                  <button
                    key={inc.id}
                    onClick={() => setSelectedIncident(inc)}
                    className={`relative flex w-full items-start gap-3 p-3.5 pl-4 text-left transition ${
                      isSelected ? "bg-ink-100/70" : "hover:bg-ink-50"
                    } ${isResolved ? "opacity-60" : ""}`}
                  >
                    {isSelected && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-cue-600" aria-hidden />}
                    <span
                      className={`cue-light mt-1.5 h-2.5 w-2.5 ${
                        isResolved
                          ? "bg-go-500"
                          : inc.severity === "CRITICAL"
                          ? "bg-cue-600 animate-cue-blink"
                          : inc.severity === "HIGH"
                          ? "bg-standby-500"
                          : "bg-ink-400"
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${getSeverityStyle(
                            inc.severity
                          )}`}
                        >
                          {inc.severity}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                          {new Date(inc.detected_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      <h4 className="truncate text-[13px] font-semibold text-ink-900">
                        {inc.title}
                      </h4>

                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {inc.description || "Operational anomaly reported."}
                      </p>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[9px] uppercase font-mono px-1 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          {inc.incident_type}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            isResolved ? "text-emerald-600" : "text-slate-600"
                          }`}
                        >
                          {inc.status}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Incident Details, Impact, & Graph (8 cols) */}
        <div className="lg:col-span-8 space-y-5 lg:h-[680px] lg:overflow-y-auto lg:pr-1">
          {selectedIncident ? (
            <>
              {/* Incident Master Detail Card */}
              <div className="surface space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getSeverityStyle(
                          selectedIncident.severity
                        )}`}
                      >
                        {selectedIncident.severity}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                        {selectedIncident.incident_type}
                      </span>
                      <ProvenanceBadge source={selectedIncident.source || "ENGINE"} size="sm" />
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                        Status: {selectedIncident.status}
                      </span>
                    </div>

                    <h2
                      className="font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink-900"
                      style={{ fontStretch: "90%" }}
                    >
                      {selectedIncident.title}
                    </h2>
                    <span className="text-xs text-slate-400 font-mono">
                      Detected {new Date(selectedIncident.detected_at).toLocaleString()}
                    </span>
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRecalculate(selectedIncident.id)}
                      disabled={actionInProgress !== null}
                      className="btn-secondary h-8"
                      title="Recalculate deterministic impact"
                    >
                      Recalculate
                    </button>

                    {selectedIncident.status !== "RESOLVED" && (
                      <button
                        onClick={() => handleResolve(selectedIncident.id)}
                        disabled={actionInProgress !== null}
                        className="btn h-8 bg-go-600 text-white hover:bg-go-700"
                      >
                        Resolve
                      </button>
                    )}

                    <Link
                      href={selectedIncident ? `/events/${eventId}/recovery?incidentId=${selectedIncident.id}` : `/events/${eventId}/recovery`}
                      className="btn-cue h-8"
                    >
                      <span>Recover</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>

                {selectedIncident.description && (
                  <p className="rounded-lg border-l-2 border-ink-300 bg-ink-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-700">
                    {selectedIncident.description}
                  </p>
                )}

                {/* Related Entities Grid */}
                <div className="grid grid-cols-2 gap-3 border-t border-dashed border-ink-200 pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <span className="eyebrow block">Related Task</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_task_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow block">Related Provider</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_vendor_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow block">Related Venue</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_venue_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow block">Signal Source</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.source || "ENGINE"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Impact Analysis Card */}
              <ImpactAnalysisCard impact={selectedIncident.impact_result} />

              {/* Dependency Blast Radius Graph */}
              <ImpactDependencyGraph
                impact={selectedIncident.impact_result}
                incidentTitle={selectedIncident.title}
              />
            </>
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 p-10 text-center">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-500 shadow-sm">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <p className="text-[15px] font-semibold text-ink-900">No problem selected</p>
              <p className="mt-1 max-w-[42ch] text-[13px] text-ink-500">
                Pick a problem from the list to see its impact and which tasks it ripples into.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
