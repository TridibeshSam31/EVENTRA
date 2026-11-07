"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Lock,
  Filter,
  Search,
  RefreshCw,
  ShieldCheck,
  Bot,
  User,
  Activity,
  ArrowRight,
  ExternalLink,
  Clock,
  Layers,
  AlertCircle,
  FileCheck,
  HelpCircle,
} from "lucide-react";
import { getAuditTrail } from "@/lib/api/observability";
import { getActivityStream } from "@/lib/api/activityStream";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { AuditEvidenceDrawer } from "./AuditEvidenceDrawer";
import { EventHistoryTimeline } from "./EventHistoryTimeline";
import { ActivityEvidenceDrawer } from "./ActivityEvidenceDrawer";
import type { AuditRecordResponse } from "@/types/api";
import type { ActivityLogItem } from "@/types/activityLog";

interface AuditCommandProps {
  eventId: string;
}

export function AuditCommand({ eventId }: AuditCommandProps) {
  const [auditRecords, setAuditRecords] = useState<AuditRecordResponse[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View Mode: Audit Table vs Unified Timeline
  const [viewMode, setViewMode] = useState<"TABLE" | "TIMELINE">("TABLE");

  // Filters
  const [selectedActionType, setSelectedActionType] = useState<string>("ALL");
  const [selectedActorType, setSelectedActorType] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Drawers
  const [selectedAudit, setSelectedAudit] = useState<AuditRecordResponse | null>(null);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityLogItem | null>(null);
  const [isActivityDrawerOpen, setIsActivityDrawerOpen] = useState(false);

  const fetchAuditData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const params: { action_type?: string; limit: number } = { limit: 100 };
      if (selectedActionType !== "ALL") {
        params.action_type = selectedActionType;
      }

      const [auditRes, activityRes] = await Promise.all([
        getAuditTrail(eventId, params).catch(() => ({ total: 0, items: [] })),
        getActivityStream(eventId, 50).catch(() => ({ total: 0, items: [] })),
      ]);

      if (auditRes && Array.isArray(auditRes.items)) {
        setAuditRecords(auditRes.items);
      } else {
        setAuditRecords([]);
      }

      if (activityRes && Array.isArray(activityRes.items)) {
        setActivityItems(activityRes.items);
      } else {
        setActivityItems([]);
      }
    } catch (err: any) {
      console.error("Failed to fetch audit records:", err);
      if (!isBackground) {
        setError(err.message || "Failed to load audit history from backend.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, selectedActionType]);

  useEffect(() => {
    fetchAuditData();
  }, [fetchAuditData]);

  // Derive unique action types from loaded records
  const availableActionTypes = Array.from(
    new Set(auditRecords.map((r) => r.action_type).filter(Boolean))
  );

  const actorTypes = ["ALL", "AGENT", "HUMAN", "SYSTEM", "ENGINE"];

  const filteredAuditRecords = auditRecords.filter((rec) => {
    if (selectedActorType !== "ALL" && (rec.actor_type || "").toUpperCase() !== selectedActorType) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${rec.action} ${rec.action_type} ${rec.actor_id || ""} ${rec.actor_type || ""} ${rec.target_id || ""} ${rec.id || ""}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const getActorBadge = (actorType: string, actorId?: string | null) => {
    const norm = (actorType || "UNKNOWN").toUpperCase();
    switch (norm) {
      case "AGENT":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            <Bot className="w-2.5 h-2.5" /> Agent ({actorId || "System"})
          </span>
        );
      case "HUMAN":
      case "ORGANIZER":
      case "USER":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <User className="w-2.5 h-2.5" /> {actorId || "Human Operator"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            <Activity className="w-2.5 h-2.5" /> {actorId || "System"}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Governance Banner: Truthful Immutability UX */}
      <div className="surface-ink relative flex flex-col justify-between gap-4 overflow-hidden p-5 sm:flex-row sm:items-center">
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-60" aria-hidden />
        <div className="relative flex items-start gap-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
            <Lock className="h-4 w-4 text-ink-200" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-label text-ink-400">History log</span>
              <span className="chip border-white/10 bg-white/5 text-ink-300">Read-only</span>
            </div>
            <h2
              className="mt-1 font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-ink-50"
              style={{ fontStretch: "88%" }}
            >
              Every recorded action, in order
            </h2>
            <p className="mt-1 max-w-xl text-[12.5px] text-ink-400">
              Entries are written by EVENTRA’s backend services and can’t be edited here.
            </p>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="relative inline-flex shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-[12.5px]" role="tablist">
          <button
            role="tab"
            aria-selected={viewMode === "TABLE"}
            onClick={() => setViewMode("TABLE")}
            className={`rounded-md px-3 py-1.5 font-semibold transition ${
              viewMode === "TABLE" ? "bg-ink-50 text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-100"
            }`}
          >
            Ledger
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "TIMELINE"}
            onClick={() => setViewMode("TIMELINE")}
            className={`rounded-md px-3 py-1.5 font-semibold transition ${
              viewMode === "TIMELINE" ? "bg-ink-50 text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-100"
            }`}
          >
            Timeline
          </button>
        </div>
      </div>

      {viewMode === "TIMELINE" ? (
        /* Unified Timeline View */
        <EventHistoryTimeline
          eventId={eventId}
          activityItems={activityItems}
          auditItems={auditRecords}
          onSelectActivity={(act) => {
            setSelectedActivity(act);
            setIsActivityDrawerOpen(true);
          }}
          onSelectAudit={(aud) => {
            setSelectedAudit(aud);
            setIsAuditDrawerOpen(true);
          }}
        />
      ) : (
        /* Audit Table Workspace */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Governance Filters (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <div className="surface p-4 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-500" />
                  <h3 className="eyebrow text-ink-700">
                    Governance Filters
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {filteredAuditRecords.length} records
                </span>
              </div>

              {/* Action Type Filter */}
              <div className="space-y-1.5">
                <label className="eyebrow">
                  Action Type
                </label>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => setSelectedActionType("ALL")}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                      selectedActionType === "ALL"
                        ? "bg-slate-900 text-white font-medium"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span>All Actions</span>
                    <span className="text-[10px] opacity-75 font-mono">{auditRecords.length}</span>
                  </button>
                  {availableActionTypes.map((actType) => {
                    const count = auditRecords.filter((r) => r.action_type === actType).length;
                    return (
                      <button
                        key={actType}
                        onClick={() => setSelectedActionType(actType)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                          selectedActionType === actType
                            ? "bg-slate-900 text-white font-medium"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="truncate max-w-[150px] font-mono text-[11px]">{actType}</span>
                        <span className="text-[10px] opacity-75 font-mono">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Actor Type Filter */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100">
                <label className="eyebrow">
                  Actor Type
                </label>
                <div className="space-y-1">
                  {actorTypes.map((act) => {
                    const count =
                      act === "ALL"
                        ? auditRecords.length
                        : auditRecords.filter(
                            (r) => (r.actor_type || "").toUpperCase() === act
                          ).length;
                    return (
                      <button
                        key={act}
                        onClick={() => setSelectedActorType(act)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                          selectedActorType === act
                            ? "bg-slate-900 text-white font-medium"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span>{act}</span>
                        <span className="text-[10px] opacity-75 font-mono">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Ledger Table (9 cols) */}
          <div className="lg:col-span-9 space-y-4">
            {/* Search and Refresh bar */}
            <div className="surface p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search audit records by action, actor, target ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  onClick={() => fetchAuditData(false)}
                  disabled={loading || refreshing}
                  className="px-3 py-1.5 text-xs border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 font-medium flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing || loading ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Audit Table Container */}
            <div className="surface overflow-hidden">
              {loading ? (
                <div className="py-16 text-center text-xs text-slate-400">
                  Loading authoritative audit trail...
                </div>
              ) : error ? (
                <div className="py-12 text-center text-xs text-rose-500 space-y-2">
                  <AlertCircle className="w-6 h-6 mx-auto text-rose-400" />
                  <p className="font-semibold">{error}</p>
                  <button
                    onClick={() => fetchAuditData(false)}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredAuditRecords.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 space-y-1">
                  <p className="font-semibold text-slate-600">No audit records available.</p>
                  <p className="text-[11px]">
                    {searchQuery || selectedActionType !== "ALL" || selectedActorType !== "ALL"
                      ? "No records matched your search query or filter selection."
                      : "Audit records are created when state changes, tasks execute, or authorizations occur."}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {/* Table Header */}
                  <div className="hidden sm:grid sm:grid-cols-12 gap-3 px-4 py-3 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                    <div className="col-span-3">Timestamp</div>
                    <div className="col-span-5">Action & Classification</div>
                    <div className="col-span-3">Actor & Target</div>
                    <div className="col-span-1 text-right">Details</div>
                  </div>

                  {/* Rows */}
                  {filteredAuditRecords.map((record) => {
                    const dateObj = new Date(record.created_at);
                    const timeStr = isNaN(dateObj.getTime())
                      ? record.created_at
                      : dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    const dateStr = isNaN(dateObj.getTime())
                      ? ""
                      : dateObj.toLocaleDateString([], { month: "short", day: "numeric" });

                    const derivedProvenance =
                      record.actor_type === "AGENT"
                        ? "AGENT"
                        : record.actor_type === "HUMAN"
                        ? "HUMAN"
                        : record.actor_type === "ENGINE"
                        ? "ENGINE"
                        : record.execution_id
                        ? "EXECUTED"
                        : "UNKNOWN";

                    return (
                      <div
                        key={record.id}
                        onClick={() => {
                          setSelectedAudit(record);
                          setIsAuditDrawerOpen(true);
                        }}
                        className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      >
                        {/* Column 1: Timestamp */}
                        <div className="sm:col-span-3 flex sm:flex-col items-start gap-1">
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {timeStr}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {dateStr}
                          </span>
                        </div>

                        {/* Column 2: Action & Classification */}
                        <div className="sm:col-span-5 space-y-1">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {record.action}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {record.action_type}
                            </span>
                            <ProvenanceBadge provenance={derivedProvenance} size="sm" />
                            {record.impact_level && (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                {record.impact_level}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Column 3: Actor & Target */}
                        <div className="sm:col-span-3 space-y-1">
                          <div>{getActorBadge(record.actor_type, record.actor_id)}</div>
                          {record.target_id && (
                            <div className="text-[10px] font-mono text-slate-500 truncate">
                              Target: {record.target_type || "ENTITY"}: {record.target_id}
                            </div>
                          )}
                        </div>

                        {/* Column 4: Inspect */}
                        <div className="sm:col-span-1 flex justify-end">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-200 transition">
                            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drawers */}
      <AuditEvidenceDrawer
        record={selectedAudit}
        eventId={eventId}
        isOpen={isAuditDrawerOpen}
        onClose={() => setIsAuditDrawerOpen(false)}
      />

      <ActivityEvidenceDrawer
        item={selectedActivity}
        eventId={eventId}
        isOpen={isActivityDrawerOpen}
        onClose={() => setIsActivityDrawerOpen(false)}
      />
    </div>
  );
}
