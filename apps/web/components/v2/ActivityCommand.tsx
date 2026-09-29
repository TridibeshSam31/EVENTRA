"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Filter,
  Search,
  RefreshCw,
  Bot,
  User,
  PhoneCall,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { getActivityStream } from "@/lib/api/activityStream";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { ActivityEvidenceDrawer } from "./ActivityEvidenceDrawer";
import { OperationalTrace } from "./OperationalTrace";
import { AgentToolExecution } from "./AgentToolExecution";
import { EngineStatusCard } from "./EngineStatusCard";
import type { ActivityLogItem } from "@/types/activityLog";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";

interface ActivityCommandProps {
  eventId: string;
}

export function ActivityCommand({ eventId }: ActivityCommandProps) {
  const { sseConnected } = useEventWorkspace(eventId);
  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeViewTab, setActiveViewTab] = useState<"STREAM" | "TOOLS" | "ENGINES">("STREAM");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [actorFilter, setActorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Drawer
  const [selectedItem, setSelectedItem] = useState<ActivityLogItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchActivity = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const res = await getActivityStream(eventId, 100);
      if (res && Array.isArray(res.items)) {
        setItems(res.items);
      } else {
        setItems([]);
      }
    } catch (err: any) {
      console.error("Failed to load activity stream:", err);
      if (!isBackground) {
        setError(err.message || "Failed to load operational activity feed from backend.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchActivity();
    if (sseConnected) return; // SSE delivers live activity to workspace

    // Guarded polling every 8s only when window/tab is visible
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchActivity(true);
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchActivity, sseConnected]);

  // Categories present in backend
  const categories = [
    "ALL",
    "DISCOVERY",
    "PLANNING",
    "COMMUNICATION",
    "APPROVAL",
    "EXECUTION",
    "INCIDENT",
    "SYSTEM",
  ];

  // Actors present in backend
  const actors = ["ALL", "AGENT", "ORGANIZER", "VENDOR", "SYSTEM"];

  const filteredItems = items.filter((item) => {
    if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
      return false;
    }
    if (actorFilter !== "ALL" && item.actor !== actorFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${item.summary} ${item.action} ${item.actor} ${item.category} ${item.ref_id || ""}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const getActorBadge = (actor: string) => {
    switch (actor?.toUpperCase()) {
      case "AGENT":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            <Bot className="w-2.5 h-2.5" /> Agent
          </span>
        );
      case "ORGANIZER":
      case "USER":
      case "HUMAN":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <User className="w-2.5 h-2.5" /> Human
          </span>
        );
      case "VENDOR":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
            <PhoneCall className="w-2.5 h-2.5" /> Vendor
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            <Activity className="w-2.5 h-2.5" /> System
          </span>
        );
    }
  };

  const getCategoryDot = (cat: string) => {
    switch (cat?.toUpperCase()) {
      case "DISCOVERY":
        return "bg-blue-500";
      case "COMMUNICATION":
        return "bg-purple-500";
      case "INCIDENT":
        return "bg-rose-500";
      case "APPROVAL":
        return "bg-amber-500";
      case "PLANNING":
        return "bg-indigo-500";
      case "EXECUTION":
        return "bg-emerald-500";
      default:
        return "bg-slate-400";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Operational Trace Section */}
      <OperationalTrace eventId={eventId} />

      {/* View Mode Switcher */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white border border-slate-200 rounded-xl shadow-xs text-xs font-medium w-max">
        <button
          onClick={() => setActiveViewTab("STREAM")}
          className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeViewTab === "STREAM"
              ? "bg-slate-900 text-white shadow-xs font-semibold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Operational Stream ({items.length})</span>
        </button>
        <button
          onClick={() => setActiveViewTab("TOOLS")}
          className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeViewTab === "TOOLS"
              ? "bg-slate-900 text-white shadow-xs font-semibold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <span>Agent Tools & Registry</span>
        </button>
        <button
          onClick={() => setActiveViewTab("ENGINES")}
          className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeViewTab === "ENGINES"
              ? "bg-slate-900 text-white shadow-xs font-semibold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <span>Deterministic Engines</span>
        </button>
      </div>

      {activeViewTab === "TOOLS" && (
        <AgentToolExecution eventId={eventId} />
      )}

      {activeViewTab === "ENGINES" && (
        <EngineStatusCard />
      )}

      {activeViewTab === "STREAM" && (
        /* Main Activity Workspace Grid */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Filter Panel (Desktop: 3 cols) */}
          <div className="lg:col-span-3 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                  Activity Filters
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {filteredItems.length} of {items.length}
              </span>
            </div>

            {/* Category Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Category
              </label>
              <div className="space-y-1">
                {categories.map((cat) => {
                  const count =
                    cat === "ALL"
                      ? items.length
                      : items.filter((i) => i.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                        categoryFilter === cat
                          ? "bg-slate-900 text-white font-medium"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {cat !== "ALL" && (
                          <span className={`w-1.5 h-1.5 rounded-full ${getCategoryDot(cat)}`} />
                        )}
                        <span>{cat}</span>
                      </div>
                      <span className="text-[10px] opacity-75 font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actor Filter */}
            <div className="space-y-1.5 pt-3 border-t border-slate-100">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Actor Attribution
              </label>
              <div className="space-y-1">
                {actors.map((act) => {
                  const count =
                    act === "ALL"
                      ? items.length
                      : items.filter((i) => i.actor === act).length;
                  return (
                    <button
                      key={act}
                      onClick={() => setActorFilter(act)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                        actorFilter === act
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

        {/* Center / Main Column: Activity Stream (Desktop: 9 cols) */}
        <div className="lg:col-span-9 space-y-4">
          {/* Controls Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search operational activity by summary, action, or ref ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 bg-slate-50"
              />
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => fetchActivity(false)}
                disabled={loading || refreshing}
                className="px-3 py-1.5 text-xs border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 font-medium flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing || loading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Activity Feed Container */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-xs text-slate-400">
                Loading authoritative operational stream...
              </div>
            ) : error ? (
              <div className="py-12 text-center text-xs text-rose-500 space-y-2">
                <AlertCircle className="w-6 h-6 mx-auto text-rose-400" />
                <p className="font-semibold">{error}</p>
                <button
                  onClick={() => fetchActivity(false)}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                >
                  Retry
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-600">No activity recorded for this event.</p>
                <p className="text-[11px]">
                  {searchQuery || categoryFilter !== "ALL" || actorFilter !== "ALL"
                    ? "Try adjusting your search query or filter criteria."
                    : "Operational events will appear here as autonomous discovery, planning, outreach, and tasks execute."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const dateObj = new Date(item.timestamp);
                  const timeStr = isNaN(dateObj.getTime())
                    ? item.timestamp
                    : dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

                  const derivedProvenance =
                    item.actor === "AGENT"
                      ? "AGENT"
                      : item.actor === "ORGANIZER"
                      ? "HUMAN"
                      : item.actor === "VENDOR"
                      ? "SOURCE"
                      : "UNKNOWN";

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedItem(item);
                        setIsDrawerOpen(true);
                      }}
                      className="p-4 flex items-start gap-3 hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* Timeline dot & indicator */}
                      <div className="mt-1 flex flex-col items-center">
                        <span className={`w-2.5 h-2.5 rounded-full ${getCategoryDot(item.category)}`} />
                        <span className="w-px h-full bg-slate-200 mt-1" />
                      </div>

                      {/* Item content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            {getActorBadge(item.actor)}
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {item.category}
                            </span>
                            <ProvenanceBadge provenance={derivedProvenance} size="sm" />
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
                            {timeStr}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-slate-900 leading-snug">
                          {item.summary || item.action}
                        </p>

                        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 font-mono">
                          <span>Action: {item.action}</span>
                          {item.ref_id && (
                            <span className="text-slate-400">Ref: {item.ref_id}</span>
                          )}
                        </div>
                      </div>

                      {/* Right hover action */}
                      <div className="shrink-0 self-center hidden sm:flex items-center text-xs font-semibold text-slate-400 group-hover:text-slate-900 transition gap-1">
                        <span>Inspect</span>
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
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

      {/* Structured Evidence Drawer */}
      <ActivityEvidenceDrawer
        item={selectedItem}
        eventId={eventId}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}
