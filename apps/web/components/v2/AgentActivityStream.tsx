"use client";

import React, { useState, useEffect } from "react";
import {
  Activity,
  Bot,
  User,
  PhoneCall,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
} from "lucide-react";
import { getActivityStream } from "@/lib/api/activityStream";
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
  refreshInterval = 4000,
  initialItems = [],
  className = "",
  limit = 40,
}: AgentActivityStreamProps) {
  const [items, setItems] = useState<ActivityLogItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const fetchStream = async () => {
    try {
      setLoading(true);
      const res = await getActivityStream(eventId, limit);
      if (res && res.items) {
        setItems(res.items);
      }
    } catch (err) {
      console.error("Failed to fetch activity stream:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStream();
    if (!autoRefresh) return;
    const interval = setInterval(fetchStream, refreshInterval);
    return () => clearInterval(interval);
  }, [eventId, autoRefresh, refreshInterval]);

  const filteredItems =
    categoryFilter === "ALL"
      ? items
      : items.filter((item) => item.category === categoryFilter);

  const getActorBadge = (actor: string) => {
    switch (actor?.toUpperCase()) {
      case "AGENT":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Bot className="w-2.5 h-2.5" /> Agent
          </span>
        );
      case "ORGANIZER":
      case "USER":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <User className="w-2.5 h-2.5" /> Human
          </span>
        );
      case "VENDOR":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <PhoneCall className="w-2.5 h-2.5" /> Vendor
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            <Activity className="w-2.5 h-2.5" /> System
          </span>
        );
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat?.toUpperCase()) {
      case "DISCOVERY":
        return "text-cyan-400 bg-cyan-950/40 border-cyan-800/40";
      case "COMMUNICATION":
        return "text-purple-400 bg-purple-950/40 border-purple-800/40";
      case "INCIDENT":
        return "text-rose-400 bg-rose-950/40 border-rose-800/40";
      case "APPROVAL":
        return "text-amber-400 bg-amber-950/40 border-amber-800/40";
      case "PLANNING":
        return "text-indigo-400 bg-indigo-950/40 border-indigo-800/40";
      case "EXECUTION":
        return "text-emerald-400 bg-emerald-950/40 border-emerald-800/40";
      default:
        return "text-zinc-400 bg-zinc-950/40 border-zinc-800/40";
    }
  };

  return (
    <div className={`flex flex-col bg-zinc-950/80 border border-zinc-800/60 rounded-xl overflow-hidden backdrop-blur-md ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/40">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Live Agent Activity Stream
            </h3>
            <p className="text-[11px] text-zinc-500">
              Unified cross-lifecycle audit & telemetry log
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchStream}
            disabled={loading}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800/60 transition"
            title="Refresh stream"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900/20 border-b border-zinc-800/40 overflow-x-auto text-[11px]">
        {["ALL", "DISCOVERY", "COMMUNICATION", "APPROVAL", "INCIDENT", "EXECUTION"].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2 py-0.5 rounded-full transition-all whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-zinc-100 text-zinc-900 font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Stream Items List */}
      <div className="flex-1 overflow-y-auto max-h-[420px] p-3 space-y-2.5 divide-y divide-zinc-800/30">
        {filteredItems.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 text-xs">
            {loading ? "Loading telemetry..." : "No activity events recorded yet."}
          </div>
        ) : (
          filteredItems.map((item) => {
            const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={item.id}
                className="pt-2.5 first:pt-0 flex items-start gap-2.5 group hover:bg-zinc-900/30 p-1.5 rounded-lg transition"
              >
                <div className="mt-0.5 flex flex-col items-center">
                  <div
                    className={`w-2 h-2 rounded-full border ${getCategoryColor(
                      item.category
                    )}`}
                  />
                  <div className="w-px h-full bg-zinc-800/40 mt-1" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      {getActorBadge(item.actor)}
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                        {item.category}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">
                      {timeStr}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                    {item.summary}
                  </p>

                  {item.details && Object.keys(item.details).length > 0 && (
                    <div className="mt-1.5 p-2 rounded bg-zinc-900/60 border border-zinc-800/40 text-[11px] font-mono text-zinc-400">
                      {Object.entries(item.details).slice(0, 3).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-zinc-500">{k}:</span>
                          <span className="text-zinc-300 truncate max-w-[200px]">
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
