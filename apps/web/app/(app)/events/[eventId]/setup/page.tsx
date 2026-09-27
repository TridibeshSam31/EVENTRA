"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Settings,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Shield,
  FileText,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Layers,
  Clock,
  Sparkles,
  Info,
} from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { getEvent, getEventSpecification } from "@/lib/api/events";
import type { EventResponse, EventSpecification } from "@/types/api";

type TabMode = "SPEC" | "PARAMETERS" | "RAW";

export default function SetupPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [activeTab, setActiveTab] = useState<TabMode>("SPEC");
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [specification, setSpecification] = useState<EventSpecification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError(null);
      const [evRes, specRes] = await Promise.allSettled([
        getEvent(eventId),
        getEventSpecification(eventId),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      } else {
        throw new Error("Failed to load authoritative event metadata.");
      }

      if (specRes.status === "fulfilled" && specRes.value) {
        setSpecification(specRes.value);
      }
    } catch (err: any) {
      console.error("Setup load failed:", err);
      setError(err?.message || "Could not retrieve event parameters.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const curr = eventData?.currency === "INR" || !eventData?.currency ? "₹" : `${eventData?.currency} `;

  return (
    <EventShell eventId={eventId} currentStage="DEFINE" event={eventData}>
      <div className="space-y-6">
        {/* Top Control Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Specification &amp; Parameters
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                ID: {eventId ? eventId.slice(0, 16) : "UNKNOWN"}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-1 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-700" />
              Event Setup &amp; Authoritative Blueprint
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect backend-materialized event definitions, operational constraints, and lifecycle configuration.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Tab Switcher */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold">
              <button
                onClick={() => setActiveTab("SPEC")}
                className={`px-3 py-1.5 rounded-md transition ${
                  activeTab === "SPEC"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Specification
              </button>
              <button
                onClick={() => setActiveTab("PARAMETERS")}
                className={`px-3 py-1.5 rounded-md transition ${
                  activeTab === "PARAMETERS"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Parameters
              </button>
              <button
                onClick={() => setActiveTab("RAW")}
                className={`px-3 py-1.5 rounded-md transition ${
                  activeTab === "RAW"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Schema
              </button>
            </div>

            <button
              onClick={() => loadData()}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !eventData ? (
          <div className="p-16 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
            <p className="text-xs font-medium text-slate-600">Loading authoritative event specification…</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* TAB 1: BLUEPRINT & SPECIFICATION */}
            {activeTab === "SPEC" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Card: Core Operational Parameters */}
                <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-500" />
                      Core Deployment Specification
                    </h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {eventData?.lifecycle_state || "SPECIFIED"}
                    </span>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Operation Designation
                      </span>
                      <p className="text-sm font-bold text-slate-900">{eventData?.name || "Untitled Event"}</p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Operational Scope &amp; Objective
                      </span>
                      <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                        {eventData?.description || "No specific scope narrative defined for this operation."}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Classification
                        </span>
                        <span className="font-mono text-slate-800 uppercase bg-slate-100 px-2 py-1 rounded">
                          {eventData?.event_type || "GENERAL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Lifecycle Status
                        </span>
                        <span className="font-mono text-slate-800 uppercase bg-slate-100 px-2 py-1 rounded">
                          {eventData?.state || "NORMAL"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Card: Logistics & Hard Constraints */}
                <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-4 h-4 text-slate-500" />
                      Constraints &amp; Capacity Targets
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-100 flex items-start gap-3">
                      <Calendar className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Start Date</span>
                        <span className="font-mono font-medium text-slate-900">
                          {eventData?.start_datetime
                            ? new Date(eventData.start_datetime).toLocaleDateString()
                            : "UNSCHEDULED"}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-100 flex items-start gap-3">
                      <Clock className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">End Date</span>
                        <span className="font-mono font-medium text-slate-900">
                          {eventData?.end_datetime
                            ? new Date(eventData.end_datetime).toLocaleDateString()
                            : "UNSCHEDULED"}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-100 flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Location Target</span>
                        <span className="font-medium text-slate-900">{eventData?.location || "UNASSIGNED"}</span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-100 flex items-start gap-3">
                      <Users className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Capacity</span>
                        <span className="font-mono font-bold text-slate-900">
                          {eventData?.guest_count ? eventData.guest_count.toLocaleString() : "0"} Attendees
                        </span>
                      </div>
                    </div>

                    <div className="sm:col-span-2 p-3.5 rounded-lg bg-slate-50 border border-slate-100 flex items-start gap-3">
                      <DollarSign className="w-4 h-4 text-emerald-600 mt-0.5" />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Budget Ceiling</span>
                        <span className="font-mono font-bold text-emerald-800 text-sm">
                          {eventData?.total_budget
                            ? `${curr}${Number(eventData.total_budget).toLocaleString()}`
                            : "UNRESTRICTED"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-Specification Objectives & Requirements if available */}
                {specification && (
                  <div className="lg:col-span-12 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      Authoritative Specification Blueprint
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      {specification.objectives && specification.objectives.length > 0 && (
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Key Objectives ({specification.objectives.length})
                          </span>
                          <ul className="space-y-1.5 list-disc list-inside text-slate-700">
                            {specification.objectives.map((obj, i) => (
                              <li key={i} className="truncate">
                                <strong>{obj.title}</strong>: {obj.description || obj.priority}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {specification.constraints && specification.constraints.length > 0 && (
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Active Constraints ({specification.constraints.length})
                          </span>
                          <ul className="space-y-1.5 list-disc list-inside text-slate-700">
                            {specification.constraints.map((c, i) => (
                              <li key={i} className="truncate">
                                <strong>{c.constraint_type}</strong>: {c.description || "Active limit"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {specification.requirements && specification.requirements.length > 0 && (
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Operational Requirements ({specification.requirements.length})
                          </span>
                          <ul className="space-y-1.5 list-disc list-inside text-slate-700">
                            {specification.requirements.map((r, i) => (
                              <li key={i} className="truncate">
                                <strong>{r.name}</strong> ({r.type})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: EDITABLE / CONFIG PARAMETERS */}
            {activeTab === "PARAMETERS" && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900">Configured Operational Variables</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Immutable backend ledger records for event governance and CPM engines.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Event Identifier
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={eventData?.id || ""}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Authoritative Owner
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={eventData?.owner_id || "SYSTEM_OPERATOR"}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Created Timestamp
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={eventData?.created_at ? new Date(eventData.created_at).toLocaleString() : "N/A"}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Last Updated
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={eventData?.updated_at ? new Date(eventData.updated_at).toLocaleString() : "N/A"}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    Event specification parameters dictate downstream CPM critical path generation, discovery candidate filters, and budget variance limits. Updates are processed through autonomous intake or planning directives.
                  </span>
                </div>
              </div>
            )}

            {/* TAB 3: RAW SCHEMA */}
            {activeTab === "RAW" && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 font-mono">Backend Authoritative Schema</h3>
                  <span className="text-[10px] font-mono text-slate-400">JSON Payload</span>
                </div>

                <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-[450px]">
                  {JSON.stringify({ event: eventData, specification }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </EventShell>
  );
}
