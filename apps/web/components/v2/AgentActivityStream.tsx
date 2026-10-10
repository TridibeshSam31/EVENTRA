"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Bot,
  User,
  PhoneCall,
  RefreshCw,
  ExternalLink,
  Layers,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { getActivityStream } from "@/lib/api/activityStream";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { ActivityLogItem } from "@/types/activityLog";

interface AgentActivityStreamProps {
  eventId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  initialItems?: ActivityLogItem[];
  className?: string;
  limit?: number;
}

export function AgentActivityStream({
  eventId,
  autoRefresh = true,
  refreshInterval = 6000,
  initialItems = [],
  className = "",
  limit = 40,
}: AgentActivityStreamProps) {
  const { sseConnected } = useEventWorkspace(eventId);
  const [items, setItems] = useState<ActivityLogItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchStream = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getActivityStream(eventId, limit);
      if (res && Array.isArray(res.items)) {
        setItems(res.items);
      }
    } catch (err) {
      console.error("Failed to fetch agent activity stream:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, limit]);

  useEffect(() => {
    fetchStream();
    // When SSE is connected, live activity is pushed over SSE; avoid redundant polling
    if (!autoRefresh || sseConnected) return;

    // Guarded polling: pause when tab is hidden to prevent duplicate requests
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchStream();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchStream, autoRefresh, refreshInterval, sseConnected]);

  const filteredItems =
    categoryFilter === "ALL"
      ? items
      : items.filter((item) => item.category === categoryFilter);

  const getActorBadge = (actor: string) => {
    switch (actor?.toUpperCase()) {
      case "AGENT":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            <Bot className="w-2.5 h-2.5" /> Agent
          </span>
        );
      case "ORGANIZER":
      case "USER":
      case "HUMAN":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            <User className="w-2.5 h-2.5" /> Human
          </span>
        );
      case "VENDOR":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
            <PhoneCall className="w-2.5 h-2.5" /> Vendor
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
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

  const getRefLink = (category: string, refId?: string | null) => {
    if (!refId) return null;
    const cat = category.toUpperCase();
    if (cat === "PLANNING" || refId.startsWith("TSK-") || refId.startsWith("TASK-")) {
      return `/events/${eventId}/tasks`;
    }
    if (cat === "INCIDENT" || refId.startsWith("INC-")) {
      return `/events/${eventId}/incidents`;
    }
    if (cat === "APPROVAL" || refId.startsWith("APP-")) {
      return `/events/${eventId}/approvals`;
    }
    if (cat === "COMMUNICATION" || refId.startsWith("CONV-") || refId.startsWith("MSG-")) {
      return `/events/${eventId}/conversations`;
    }
    if (cat === "DISCOVERY" || refId.startsWith("VEN-") || refId.startsWith("VND-")) {
      return `/events/${eventId}/procurement`;
    }
    return null;
  };

  return (
    <div className={`flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-slate-100 text-[#D6003C] border border-slate-200">
            <Activity className="w-4 h-4 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                Agent Activity Stream
              </h3>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-[11px] text-slate-500">
              Live operational event stream with authoritative provenance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/events/${eventId}/activity`}
            className="text-[11px] font-semibold text-[#D6003C] hover:underline flex items-center gap-1 mr-2"
          >
            <span>Full Workspace</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            onClick={fetchStream}
            disabled={loading}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
            title="Refresh stream"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50/30 border-b border-slate-200 overflow-x-auto text-[11px]">
        {["ALL", "DISCOVERY", "COMMUNICATION", "APPROVAL", "INCIDENT", "EXECUTION", "PLANNING"].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2 py-0.5 rounded-full transition-all whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-slate-900 text-white font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Stream Items List */}
      <div className="flex-1 overflow-y-auto max-h-[420px] p-3 space-y-2.5 divide-y divide-slate-100">
        {filteredItems.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            {loading ? "Loading telemetry..." : "No activity events recorded yet."}
          </div>
        ) : (
          filteredItems.map((item) => {
            let timeStr = "";
            if (mounted && item.timestamp) {
              try {
                timeStr = new Date(item.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
              } catch {
                timeStr = "";
              }
            }

            const refLink = getRefLink(item.category, item.ref_id);

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
                className="pt-2.5 first:pt-0 flex items-start gap-2.5 group hover:bg-slate-50 p-1.5 rounded-lg transition"
              >
                <div className="mt-1 flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full ${getCategoryDot(item.category)}`} />
                  <div className="w-px h-full bg-slate-200 mt-1" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      {getActorBadge(item.actor)}
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        {item.category}
                      </span>
                      <ProvenanceBadge provenance={derivedProvenance} size="sm" />
                    </div>
                    <span
                      suppressHydrationWarning
                      className="text-[10px] font-mono text-slate-400 whitespace-nowrap"
                    >
                      {timeStr}
                    </span>
                  </div>

                  <p className="text-xs text-slate-800 font-medium leading-relaxed">
                    {item.summary || item.action}
                  </p>

                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 font-mono">
                    <span>Action: {item.action}</span>
                    {item.ref_id && (
                      refLink ? (
                        <Link
                          href={refLink}
                          className="text-[#D6003C] hover:underline flex items-center gap-0.5"
                        >
                          <span>Ref: {item.ref_id}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      ) : (
                        <span className="text-slate-400">Ref: {item.ref_id}</span>
                      )
                    )}
                  </div>

                  {item.details && Object.keys(item.details).length > 0 && (
                    <div className="mt-1.5 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-600">
                      {Object.entries(item.details).slice(0, 3).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">{k}:</span>
                          <span className="text-slate-800 truncate max-w-[200px]">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
