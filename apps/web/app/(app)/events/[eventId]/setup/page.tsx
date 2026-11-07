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
import { PageHeader, Panel, CueChip, KeyValue, EmptyState } from "@/components/ds";
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

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null;

  const facts: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string | null; wide?: boolean }> = [
    { icon: Calendar, label: "Starts", value: fmt(eventData?.start_datetime) },
    { icon: Clock, label: "Ends", value: fmt(eventData?.end_datetime) },
    { icon: MapPin, label: "Location", value: eventData?.location || null },
    { icon: Users, label: "Guests", value: eventData?.guest_count ? `${eventData.guest_count.toLocaleString()} attendees` : null },
    {
      icon: DollarSign,
      label: "Budget ceiling",
      value: eventData?.total_budget ? `${curr}${Number(eventData.total_budget).toLocaleString()}` : null,
      wide: true,
    },
  ];

  const tabs: Array<{ id: TabMode; label: string }> = [
    { id: "SPEC", label: "Specification" },
    { id: "PARAMETERS", label: "Parameters" },
    { id: "RAW", label: "Schema" },
  ];

  const readonlyCls = "w-full rounded-lg border border-ink-200 bg-ink-100/50 px-3 py-2 font-mono text-[12.5px] text-ink-800";

  return (
    <EventShell eventId={eventId} currentStage="DEFINE" event={eventData}>
      <div className="space-y-6">
        <PageHeader
          eyebrow={
            <span>
              Define · <span className="normal-case tracking-normal text-ink-400">{eventId ? eventId.slice(0, 16) : "unknown"}</span>
            </span>
          }
          title="Event details"
          description="What EVENTRA knows about this event. Every downstream plan, search and budget check is built from these facts."
          actions={
            <>
              <div role="tablist" className="inline-flex rounded-lg border border-ink-200 bg-ink-100/70 p-0.5">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${
                      activeTab === t.id ? "bg-[#FDFCFA] text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => loadData()} disabled={loading} className="btn-secondary h-9 w-9 px-0" title="Refresh" aria-label="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </>
          }
        />

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-cue-200 bg-cue-50 p-4 text-[13px] text-cue-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-cue-600" />
            <span>{error}</span>
          </div>
        )}

        {loading && !eventData ? (
          <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
            <div className="workspace-shimmer h-72 rounded-xl" />
            <div className="workspace-shimmer h-72 rounded-xl" />
          </div>
        ) : !eventData && error ? (
          <EmptyState
            title="Event details unavailable"
            description="EVENTRA couldn't load this event from the server. Check that the API is running, then refresh."
            action={
              <button onClick={() => loadData()} className="btn-secondary">
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            }
          />
        ) : (
          <div className="space-y-6">
            {activeTab === "SPEC" && (
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
                <Panel
                  className="lg:col-span-6"
                  eyebrow={
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> Brief
                    </span>
                  }
                  title={eventData?.name || "Untitled event"}
                  actions={<CueChip tone="go">{eventData?.lifecycle_state || "SPECIFIED"}</CueChip>}
                >
                  <div className="space-y-4">
                    <p
                      className={`rounded-lg border-l-2 px-3 py-2 text-[13px] leading-relaxed ${
                        eventData?.description ? "border-ink-300 bg-ink-100/40 text-ink-700" : "border-dashed border-ink-300 text-ink-400"
                      }`}
                    >
                      {eventData?.description || "No description yet."}
                    </p>
                    <KeyValue
                      rows={[
                        { label: "Type", value: <span className="font-mono uppercase">{eventData?.event_type || "General"}</span> },
                        { label: "Operational state", value: <span className="font-mono uppercase">{eventData?.state || "NORMAL"}</span> },
                      ]}
                    />
                  </div>
                </Panel>

                <Panel
                  className="lg:col-span-6"
                  eyebrow={
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-3 w-3" /> Hard constraints
                    </span>
                  }
                  title="When, where, how big"
                >
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {facts.map((f) => (
                      <div
                        key={f.label}
                        className={`flex items-start gap-3 rounded-lg border p-3 ${f.wide ? "sm:col-span-2" : ""} ${
                          f.value ? "border-ink-200 bg-paper" : "border-dashed border-ink-300"
                        }`}
                      >
                        <f.icon className={`mt-0.5 h-4 w-4 ${f.value ? "text-ink-600" : "text-ink-300"}`} />
                        <div className="min-w-0">
                          <span className="eyebrow block">{f.label}</span>
                          <span className={`block truncate text-[13.5px] font-semibold ${f.value ? "text-ink-900" : "text-ink-400"}`}>
                            {f.value || "Not set"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                {specification && (
                  <Panel
                    className="lg:col-span-12"
                    eyebrow={
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-agent-500" /> Specification
                      </span>
                    }
                    title="Objectives, constraints & requirements"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {[
                        {
                          title: "Key objectives",
                          items: (specification.objectives || []).map((o) => ({ k: o.title, v: o.description || o.priority })),
                        },
                        {
                          title: "Active constraints",
                          items: (specification.constraints || []).map((c) => ({ k: c.constraint_type, v: c.description || "Active limit" })),
                        },
                        {
                          title: "Requirements",
                          items: (specification.requirements || []).map((r) => ({ k: r.name, v: r.type })),
                        },
                      ]
                        .filter((g) => g.items.length > 0)
                        .map((g) => (
                          <div key={g.title} className="rounded-lg border border-ink-200 bg-paper p-4">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="eyebrow">{g.title}</span>
                              <span className="font-mono text-[11px] text-ink-400">{g.items.length}</span>
                            </div>
                            <ul className="ruled text-[12.5px]">
                              {g.items.map((it, i) => (
                                <li key={i} className="py-1.5">
                                  <span className="font-semibold text-ink-900">{it.k}</span>
                                  {it.v ? <span className="text-ink-500"> — {String(it.v)}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                  </Panel>
                )}
              </div>
            )}

            {activeTab === "PARAMETERS" && (
              <Panel eyebrow="Record" title="Event record" className="max-w-4xl">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {[
                    { label: "Event ID", value: eventData?.id || "" },
                    { label: "Owner", value: eventData?.owner_id || "SYSTEM_OPERATOR" },
                    { label: "Created", value: eventData?.created_at ? new Date(eventData.created_at).toLocaleString() : "N/A" },
                    { label: "Last updated", value: eventData?.updated_at ? new Date(eventData.updated_at).toLocaleString() : "N/A" },
                  ].map((f) => (
                    <div key={f.label}>
                      <label className="eyebrow mb-1.5 block">{f.label}</label>
                      <input type="text" readOnly value={f.value} className={readonlyCls} />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-engine-200 bg-engine-50/60 p-4 text-[12.5px] text-ink-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-engine-600" />
                  <span>
                    These details drive the critical-path schedule, vendor search filters and budget limits. Change them through voice
                    intake or planning — EVENTRA re-checks everything downstream when they change.
                  </span>
                </div>
              </Panel>
            )}

            {activeTab === "RAW" && (
              <Panel eyebrow="JSON payload" title={<span className="font-mono">Raw event data</span>}>
                <pre className="max-h-[480px] overflow-x-auto rounded-xl bg-ink-950 p-4 font-mono text-[12px] leading-relaxed text-ink-200">
                  {JSON.stringify({ event: eventData, specification }, null, 2)}
                </pre>
              </Panel>
            )}
          </div>
        )}
      </div>
    </EventShell>
  );
}
