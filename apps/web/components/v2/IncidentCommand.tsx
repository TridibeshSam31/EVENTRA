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
        setIncidents(incRes.value.items);
        if (incRes.value.items.length > 0 && !selectedIncident) {
          setSelectedIncident(incRes.value.items[0]);
        }
      }

      if (liveRes.status === "fulfilled" && liveRes.value) {
        setLiveState(liveRes.value);
      }
    } catch (err: any) {
      console.error("Failed to load incident workspace:", err);
      setErrorMessage(err.message || "Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedIncident]);

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
        return "bg-blue-50 text-blue-700 border-blue-200";
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
    <div className={`space-y-4 ${className}`}>
      {/* 1. Header Toolbar & Live Operational Telemetry */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Incident & Risk Command
              </span>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  liveOperationalStatus === "NORMAL"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : liveOperationalStatus === "DEGRADED"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-rose-50 text-rose-700 border-rose-200 animate-pulse"
                }`}
              >
                Live State: {liveOperationalStatus}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {incidents.filter((i) => i.status !== "RESOLVED").length} Active Incidents
              </span>
            </div>

            <h1 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
              Anomaly Detection & Risk Governance Radar
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Deterministic impact assessment, dependency propagation analysis, and authoritative state transitions.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh Telemetry</span>
            </button>
            <Link
              href={`/events/${eventId}/recovery`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Open Recovery Command</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN: Incidents List Stream (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[680px]">
          {/* Search & Filter Toolbar */}
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search incidents by title..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
              />
            </div>

            {/* Severity Filter Pills */}
            <div className="flex items-center gap-1 text-[11px] overflow-x-auto no-scrollbar">
              {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                    severityFilter === sev
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Incident Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loading && incidents.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D6003C]" />
                Loading live incident stream...
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-400 px-4">
                No incidents found matching current filter.
              </div>
            ) : (
              filteredIncidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                const isResolved = inc.status === "RESOLVED";

                return (
                  <button
                    key={inc.id}
                    onClick={() => setSelectedIncident(inc)}
                    className={`w-full text-left p-3.5 transition flex items-start gap-2.5 ${
                      isSelected
                        ? "bg-slate-50 border-l-3 border-[#D6003C]"
                        : "hover:bg-slate-50/60"
                    }`}
                  >
                    <div className="p-1.5 rounded-lg mt-0.5 bg-slate-100 shrink-0">
                      <AlertTriangle
                        className={`w-3.5 h-3.5 ${
                          inc.severity === "CRITICAL"
                            ? "text-rose-600"
                            : inc.severity === "HIGH"
                            ? "text-amber-600"
                            : "text-blue-600"
                        }`}
                      />
                    </div>

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

                      <h4 className="text-xs font-bold text-slate-900 truncate">
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
        <div className="lg:col-span-8 space-y-4 h-[680px] overflow-y-auto pr-1">
          {selectedIncident ? (
            <>
              {/* Incident Master Detail Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
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

                    <h2 className="text-base font-bold text-slate-900 tracking-tight">
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
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
                      title="Recalculate deterministic impact"
                    >
                      Recalculate
                    </button>

                    {selectedIncident.status !== "RESOLVED" && (
                      <button
                        onClick={() => handleResolve(selectedIncident.id)}
                        disabled={actionInProgress !== null}
                        className="px-3 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-xs"
                      >
                        Resolve
                      </button>
                    )}

                    <Link
                      href={`/events/${eventId}/recovery`}
                      className="px-3 py-1 rounded-md text-[11px] font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white transition shadow-xs flex items-center gap-1"
                    >
                      <span>Recover</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>

                {selectedIncident.description && (
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed">
                    {selectedIncident.description}
                  </p>
                )}

                {/* Related Entities Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Related Task</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_task_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Related Provider</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_vendor_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Related Venue</span>
                    <span className="font-mono text-slate-700 font-semibold truncate block">
                      {selectedIncident.related_venue_id || "None"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Signal Source</span>
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
            <div className="p-16 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="font-semibold text-slate-600">No Incident Selected</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Select an incident from the stream to inspect impact and dependency blast radius.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
