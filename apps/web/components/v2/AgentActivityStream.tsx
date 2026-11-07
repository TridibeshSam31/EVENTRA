"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, Bot, User, PhoneCall, RefreshCw, ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getActivityStream } from "@/lib/api/activityStream";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { ActivityLogItem } from "@/types/activityLog";
import { describeFacts, humanizeAction, humanizeCode, stripIds, timeAgo } from "@/lib/humanize";
import { SPRING } from "@/components/ds/motion";

interface AgentActivityStreamProps {
  eventId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  initialItems?: ActivityLogItem[];
  className?: string;
  limit?: number;
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "DISCOVERY", label: "Discovery" },
  { id: "COMMUNICATION", label: "Messages" },
  { id: "APPROVAL", label: "Approvals" },
  { id: "INCIDENT", label: "Problems" },
  { id: "EXECUTION", label: "Execution" },
  { id: "PLANNING", label: "Planning" },
];

const CATEGORY_DOT: Record<string, string> = {
  DISCOVERY: "bg-info-500",
  COMMUNICATION: "bg-agent-500",
  INCIDENT: "bg-cue-600",
  APPROVAL: "bg-standby-500",
  PLANNING: "bg-engine-500",
  EXECUTION: "bg-go-500",
};

const ACTOR: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  AGENT: { label: "Agent", icon: Bot, cls: "text-agent-700" },
  ORGANIZER: { label: "You", icon: User, cls: "text-ink-800" },
  USER: { label: "You", icon: User, cls: "text-ink-800" },
  HUMAN: { label: "You", icon: User, cls: "text-ink-800" },
  VENDOR: { label: "Vendor", icon: PhoneCall, cls: "text-info-700" },
};

/** Rewrite SCREAMING_CODES embedded in a sentence ("…for 'COMMUNICATION_OUTREACH'…") as words. */
function humanizeInline(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/'?([A-Z]{2,}(?:_[A-Z0-9]+)+)'?/g, (_m, code: string) => humanizeAction(code).toLowerCase())
    .replace(/\(Impact: ([A-Z]+)\)/g, (_m, lvl: string) => `(${lvl.charAt(0)}${lvl.slice(1).toLowerCase()} impact)`);
}

/** One readable line for an activity entry's details (never raw JSON). */
function detailLine(details: Record<string, any> | undefined): string {
  if (!details) return "";
  const facts = details.extracted_facts ?? details.facts;
  if (facts) {
    const line = describeFacts(facts);
    if (line) return line;
  }
  const parts: string[] = [];
  if (details.channel) parts.push(humanizeCode(String(details.channel)));
  if (details.status) parts.push(humanizeCode(String(details.status)));
  return parts.join(" · ");
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
  const [openId, setOpenId] = useState<string | null>(null);
  const reduce = useReducedMotion();

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
    if (!autoRefresh) return;

    // The live stream only signals *that* something changed (liveVersion, below); it doesn't
    // deliver this feed. So we always keep polling — just slower while the stream is healthy —
    // otherwise the feed would freeze exactly when the page claims to be "Live".
    const every = sseConnected ? Math.max(refreshInterval, 30000) : refreshInterval;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchStream();
      }
    }, every);

    return () => clearInterval(interval);
  }, [fetchStream, autoRefresh, refreshInterval, sseConnected]);

  // Refetch shortly after any live change (debounced so bursts cost one request).
  const liveVersion = useWorkspaceStore((s) => (s.eventId === eventId ? s.liveVersion : 0));
  useEffect(() => {
    if (!liveVersion || !autoRefresh) return;
    const t = setTimeout(fetchStream, 400);
    return () => clearTimeout(t);
  }, [liveVersion, fetchStream, autoRefresh]);

  const filteredItems = categoryFilter === "ALL" ? items : items.filter((item) => item.category === categoryFilter);

  const getRefLink = (category: string, refId?: string | null) => {
    if (!refId) return null;
    const cat = category.toUpperCase();
    if (cat === "PLANNING" || refId.startsWith("TSK-") || refId.startsWith("TASK-")) return `/events/${eventId}/tasks`;
    if (cat === "INCIDENT" || refId.startsWith("INC-")) return `/events/${eventId}/incidents`;
    if (cat === "APPROVAL" || refId.startsWith("APP-")) return `/events/${eventId}/approvals`;
    if (cat === "COMMUNICATION" || refId.startsWith("CONV-") || refId.startsWith("MSG-")) return `/events/${eventId}/conversations`;
    if (cat === "DISCOVERY" || refId.startsWith("VEN-") || refId.startsWith("VND-")) return `/events/${eventId}/procurement`;
    return null;
  };

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-[#FDFCFA] shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-ink-200 bg-ink-50/50 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="rounded-md border border-ink-200 bg-ink-100 p-1 text-cue-600">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[13.5px] font-semibold text-ink-900">Agent activity</h3>
              {sseConnected && (
                <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-label text-go-700">
                  <span className="cue-light bg-go-500 animate-cue-blink" /> Live
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-500">Everything the agent and engines did, with its source</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/events/${eventId}/activity`}
            className="mr-1 flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-ink-700 hover:text-cue-700"
          >
            <span>See all</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
          <button
            onClick={fetchStream}
            disabled={loading}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            title="Refresh stream"
            aria-label="Refresh activity"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filters — scroll sideways instead of clipping */}
      <div className="relative border-b border-ink-200">
        <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const active = categoryFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setCategoryFilter(f.id)}
                className={`relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                  active ? "text-ink-50" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`activity-filter-${eventId}`}
                    className="absolute inset-0 rounded-full bg-ink-900"
                    transition={SPRING}
                  />
                )}
                <span className="relative">{f.label}</span>
              </button>
            );
          })}
        </div>
        <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#FDFCFA] to-transparent" aria-hidden />
      </div>

      {/* Items */}
      <div className="max-h-[460px] flex-1 overflow-y-auto px-3 py-2">
        {filteredItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-400">
            {loading ? "Loading activity…" : "Nothing recorded here yet."}
          </div>
        ) : (
          <ol className="relative">
            <span className="absolute bottom-3 left-[7px] top-3 w-px bg-ink-200" aria-hidden />
            <AnimatePresence initial={false}>
              {filteredItems.map((item) => {
                const refLink = getRefLink(item.category, item.ref_id);
                const actor = ACTOR[item.actor?.toUpperCase()] || { label: "EVENTRA", icon: Activity, cls: "text-ink-600" };
                const ActorIcon = actor.icon;
                const derivedProvenance =
                  item.actor === "AGENT" ? "AGENT" : item.actor === "ORGANIZER" ? "HUMAN" : item.actor === "VENDOR" ? "SOURCE" : "UNKNOWN";
                const summary = humanizeInline(stripIds(item.summary)) || humanizeAction(item.action);
                const detail = detailLine(item.details);
                const hasTech = !!item.action || !!item.ref_id || (item.details && Object.keys(item.details).length > 0);
                const isOpen = openId === item.id;
                const when = mounted ? timeAgo(item.timestamp) : "";

                return (
                  <motion.li
                    key={item.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
                    transition={SPRING}
                    className="relative flex gap-3 rounded-lg py-2 pl-0 pr-1"
                  >
                    <span
                      className={`relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-[#FDFCFA] ${
                        CATEGORY_DOT[item.category?.toUpperCase()] || "bg-ink-400"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`flex items-center gap-1 text-[11px] font-semibold ${actor.cls}`}>
                          <ActorIcon className="h-3 w-3" />
                          {actor.label}
                          <span className="font-normal text-ink-400">· {humanizeAction(item.action) || humanizeCode(item.category)}</span>
                        </span>
                        <span suppressHydrationWarning className="whitespace-nowrap font-mono text-[10px] text-ink-400" title={item.timestamp}>
                          {when}
                        </span>
                      </div>

                      <p className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink-900">{summary}</p>
                      {detail && <p className="mt-0.5 text-[12px] text-ink-600">{detail}</p>}

                      <div className="mt-1 flex items-center gap-2">
                        <ProvenanceBadge provenance={derivedProvenance} size="sm" />
                        {refLink && (
                          <Link href={refLink} className="text-[11px] font-semibold text-ink-600 hover:text-cue-700">
                            Open →
                          </Link>
                        )}
                        {hasTech && (
                          <button
                            type="button"
                            onClick={() => setOpenId(isOpen ? null : item.id)}
                            aria-expanded={isOpen}
                            className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-ink-400 hover:text-ink-700"
                          >
                            Technical details
                            <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </div>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <dl className="mt-1.5 space-y-0.5 rounded-md border border-ink-200 bg-ink-50 p-2 font-mono text-[10.5px] text-ink-600">
                              {item.action && (
                                <div className="flex justify-between gap-2">
                                  <dt className="text-ink-400">action</dt>
                                  <dd className="truncate">{item.action}</dd>
                                </div>
                              )}
                              {item.ref_id && (
                                <div className="flex justify-between gap-2">
                                  <dt className="text-ink-400">ref</dt>
                                  <dd className="truncate">{item.ref_id}</dd>
                                </div>
                              )}
                              {item.details &&
                                Object.entries(item.details).map(([k, v]) => (
                                  <div key={k} className="flex justify-between gap-2">
                                    <dt className="shrink-0 text-ink-400">{k}</dt>
                                    <dd className="truncate">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                                  </div>
                                ))}
                            </dl>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </div>
  );
}
