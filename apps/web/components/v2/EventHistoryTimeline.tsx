"use client";

import React, { useState } from "react";
import {
  Clock,
  ShieldCheck,
  Activity,
  Bot,
  User,
  PhoneCall,
  Search,
  Filter,
  ArrowRight,
  ExternalLink,
  Lock,
  Layers,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { ActivityLogItem } from "@/types/activityLog";
import type { AuditRecordResponse } from "@/types/api";

export type TimelineItemType = "ACTIVITY" | "AUDIT";

export interface UnifiedTimelineItem {
  id: string;
  sourceType: TimelineItemType;
  timestamp: string;
  actor: string;
  actorType: string;
  action: string;
  title: string;
  categoryOrType: string;
  provenance: string;
  refId?: string | null;
  rawActivity?: ActivityLogItem;
  rawAudit?: AuditRecordResponse;
}

interface EventHistoryTimelineProps {
  eventId: string;
  activityItems: ActivityLogItem[];
  auditItems: AuditRecordResponse[];
  onSelectActivity?: (item: ActivityLogItem) => void;
  onSelectAudit?: (item: AuditRecordResponse) => void;
  className?: string;
}

export function EventHistoryTimeline({
  eventId,
  activityItems,
  auditItems,
  onSelectActivity,
  onSelectAudit,
  className = "",
}: EventHistoryTimelineProps) {
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "ACTIVITY" | "AUDIT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Map activity items to unified representation
  const unifiedActivity: UnifiedTimelineItem[] = activityItems.map((act) => ({
    id: `ACT-${act.id}`,
    sourceType: "ACTIVITY",
    timestamp: act.timestamp,
    actor: act.actor || "UNKNOWN ACTOR",
    actorType: act.actor || "UNKNOWN",
    action: act.action,
    title: act.summary || act.action,
    categoryOrType: act.category,
    provenance:
      act.actor === "AGENT"
        ? "AGENT"
        : act.actor === "ORGANIZER"
        ? "HUMAN"
        : act.actor === "VENDOR"
        ? "SOURCE"
        : "UNKNOWN",
    refId: act.ref_id,
    rawActivity: act,
  }));

  // Map audit items to unified representation
  const unifiedAudit: UnifiedTimelineItem[] = auditItems.map((aud) => ({
    id: `AUD-${aud.id}`,
    sourceType: "AUDIT",
    timestamp: aud.created_at,
    actor: aud.actor_id || aud.actor_type || "UNKNOWN ACTOR",
    actorType: aud.actor_type || "UNKNOWN",
    action: aud.action,
    title: aud.action,
    categoryOrType: aud.action_type,
    provenance:
      aud.actor_type === "AGENT"
        ? "AGENT"
        : aud.actor_type === "HUMAN"
        ? "HUMAN"
        : aud.actor_type === "ENGINE"
        ? "ENGINE"
        : aud.execution_id
        ? "EXECUTED"
        : "UNKNOWN",
    refId: aud.target_id || aud.approval_id || aud.execution_id,
    rawAudit: aud,
  }));

  // Combine and sort in reverse chronological order
  const allItems = [...unifiedActivity, ...unifiedAudit].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime() || 0;
    const timeB = new Date(b.timestamp).getTime() || 0;
    return timeB - timeA;
  });

  const filteredItems = allItems.filter((item) => {
    if (sourceFilter !== "ALL" && item.sourceType !== sourceFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${item.title} ${item.action} ${item.actor} ${item.categoryOrType} ${item.refId || ""}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const getActorIcon = (actorType: string) => {
    switch (actorType?.toUpperCase()) {
      case "AGENT":
        return <Bot className="w-3.5 h-3.5 text-blue-600" />;
      case "HUMAN":
      case "ORGANIZER":
      case "USER":
        return <User className="w-3.5 h-3.5 text-emerald-600" />;
      case "VENDOR":
        return <PhoneCall className="w-3.5 h-3.5 text-purple-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            onClick={() => setSourceFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              sourceFilter === "ALL"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All Stream ({allItems.length})
          </button>
          <button
            onClick={() => setSourceFilter("ACTIVITY")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              sourceFilter === "ACTIVITY"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Activity className="w-3 h-3" />
            Activity Only ({unifiedActivity.length})
          </button>
          <button
            onClick={() => setSourceFilter("AUDIT")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              sourceFilter === "AUDIT"
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Lock className="w-3 h-3" />
            Audit Only ({unifiedAudit.length})
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search timeline..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 bg-slate-50"
          />
        </div>
      </div>

      {/* Timeline List */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100 overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-600">No events found in timeline</p>
            <p className="text-[11px]">
              {searchQuery ? "No records matched your search query." : "No activity or audit records recorded yet."}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isActivity = item.sourceType === "ACTIVITY";
            const dateObj = new Date(item.timestamp);
            const timeStr = isNaN(dateObj.getTime())
              ? item.timestamp
              : dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            const dateStr = isNaN(dateObj.getTime())
              ? ""
              : dateObj.toLocaleDateString([], { month: "short", day: "numeric" });

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isActivity && item.rawActivity && onSelectActivity) {
                    onSelectActivity(item.rawActivity);
                  } else if (!isActivity && item.rawAudit && onSelectAudit) {
                    onSelectAudit(item.rawAudit);
                  }
                }}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors cursor-pointer group"
              >
                {/* Left: Source Tag + Timestamp + Title */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Source indicator */}
                  <div className="mt-0.5 flex flex-col items-center">
                    <span
                      className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded uppercase border font-mono ${
                        isActivity
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-slate-100 text-slate-700 border-slate-300"
                      }`}
                    >
                      {item.sourceType}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 mt-1 whitespace-nowrap">
                      {timeStr}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {item.title}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {item.categoryOrType}
                      </span>
                      <ProvenanceBadge provenance={item.provenance} size="sm" />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <div className="flex items-center gap-1">
                        {getActorIcon(item.actorType)}
                        <span className="font-medium text-slate-700 truncate max-w-[160px]">
                          {item.actor}
                        </span>
                      </div>
                      {item.refId && (
                        <div className="font-mono text-[10px] text-slate-400">
                          Ref: {item.refId}
                        </div>
                      )}
                      {dateStr && (
                        <div className="text-[10px] text-slate-400">
                          {dateStr}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Inspection Action */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <span className="text-xs font-semibold text-slate-400 group-hover:text-slate-900 transition flex items-center gap-1">
                    Details
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
