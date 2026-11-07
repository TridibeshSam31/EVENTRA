"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  MessageSquare,
  PhoneCall,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Building2,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Filter,
} from "lucide-react";

import { getAssignmentsForEvent } from "@/lib/api/vendors";
import { getConversations } from "@/lib/api/conversations";
import { engageProvider, requestEngagementApproval } from "@/lib/api/negotiation";
import type { VendorAssignmentResponse } from "@/types/api";

import type { Conversation } from "@/types/communication";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { WhatsAppDeliveryStatus } from "./WhatsAppDeliveryStatus";
import { motion, useReducedMotion } from "framer-motion";
import { humanizeCategory } from "@/lib/humanize";
import { CallExecutionCard, CallExecutionData } from "./CallExecutionCard";

interface EngagementDashboardProps {
  eventId: string;
  className?: string;
  onSelectConversation?: (conversationId: string) => void;
}

export function EngagementDashboard({
  eventId,
  className = "",
  onSelectConversation,
}: EngagementDashboardProps) {
  const reduceMotion = useReducedMotion();
  const [assignments, setAssignments] = useState<VendorAssignmentResponse[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Active call state tracker for interactive telephony
  const [activeCall, setActiveCall] = useState<CallExecutionData | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [assignmentsRes, convsRes] = await Promise.allSettled([
        getAssignmentsForEvent(eventId),
        getConversations(eventId),
      ]);

      if (assignmentsRes.status === "fulfilled" && Array.isArray(assignmentsRes.value)) {
        setAssignments(assignmentsRes.value);
      }

      if (convsRes.status === "fulfilled" && convsRes.value?.items) {
        setConversations(convsRes.value.items);
      }
    } catch (err) {
      console.error("Failed to load engagement dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Map assignments to authoritative status categories
  const stats = React.useMemo(() => {
    let shortlisted = 0;
    let contacting = 0;
    let awaiting = 0;
    let responded = 0;
    let confirmed = 0;
    let declined = 0;
    let failed = 0;

    assignments.forEach((a) => {
      const s = (a.status || "").toUpperCase();
      const neg = (a.negotiation_status || "").toUpperCase();

      if (s === "CONFIRMED") confirmed++;
      else if (s === "DECLINED" || s === "CANCELLED") declined++;
      else if (s === "FAILED") failed++;
      else if (neg === "QUOTED" || neg === "COUNTER_OFFERED" || neg === "RESPONDED") responded++;
      else if (s === "ENGAGED" || s === "CONTACTED" || neg === "AWAITING_RESPONSE") awaiting++;
      else if (s === "PENDING_ENGAGEMENT" || s === "CONTACTING") contacting++;
      else shortlisted++;
    });

    return {
      total: assignments.length,
      shortlisted,
      contacting,
      awaiting,
      responded,
      confirmed,
      declined,
      failed,
    };
  }, [assignments]);

  // Dispatch initial engagement message / initiate outreach
  const handleInitiateEngagement = async (assignment: VendorAssignmentResponse) => {
    try {
      setActionInProgress(assignment.id);
      setStatusMessage(`Initiating outreach protocol for ${assignment.vendor?.name || "Provider"}...`);
      await engageProvider(assignment.id, {
        target_amount: assignment.target_amount || undefined,
        max_approved_amount: assignment.max_approved_amount || undefined,
        currency: assignment.currency || "INR",
      });
      setStatusMessage(`Outreach initiated for ${assignment.vendor?.name || "Provider"}.`);
      await loadData();
    } catch (err: any) {
      console.error("Outreach initiation failed:", err);
      setStatusMessage(err.message || "Failed to dispatch outreach.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Submit for formal approval
  const handleRequestApproval = async (assignment: VendorAssignmentResponse) => {
    try {
      setActionInProgress(assignment.id);
      setStatusMessage(`Submitting ${assignment.vendor?.name || "Provider"} engagement for approval...`);
      await requestEngagementApproval(assignment.id);
      setStatusMessage(`Approval request submitted for ${assignment.vendor?.name || "Provider"}.`);
      await loadData();
    } catch (err: any) {
      console.error("Approval request failed:", err);
      setStatusMessage(err.message || "Failed to submit approval request.");
    } finally {
      setActionInProgress(null);
    }
  };

  const filteredAssignments = assignments.filter((a) => {

    if (!filterStatus) return true;
    const s = (a.status || "").toUpperCase();
    const neg = (a.negotiation_status || "").toUpperCase();
    if (filterStatus === "CONFIRMED") return s === "CONFIRMED";
    if (filterStatus === "DECLINED") return s === "DECLINED" || s === "CANCELLED";
    if (filterStatus === "RESPONDED") return neg === "QUOTED" || neg === "COUNTER_OFFERED";
    if (filterStatus === "AWAITING") return s === "ENGAGED" || s === "CONTACTED";
    if (filterStatus === "SHORTLISTED") return s === "SHORTLISTED" || s === "";
    return true;
  });

  // The engagement funnel (V2 spec §12): every count comes from backend assignment state.
  const stages: Array<{
    key: string;
    label: string;
    hint: string;
    value: number;
    tone: "ink" | "standby" | "info" | "go";
  }> = [
    { key: "SHORTLISTED", label: "Shortlisted", hint: "Not contacted yet", value: stats.shortlisted, tone: "ink" },
    { key: "AWAITING", label: "Awaiting reply", hint: "Message or call sent", value: stats.awaiting, tone: "standby" },
    { key: "RESPONDED", label: "Responded", hint: "Quote or terms received", value: stats.responded, tone: "info" },
    { key: "CONFIRMED", label: "Confirmed", hint: "Booked for the event", value: stats.confirmed, tone: "go" },
  ];
  const maxStage = Math.max(1, ...stages.map((s) => s.value));
  const toneBar: Record<string, string> = {
    ink: "bg-ink-800",
    standby: "bg-standby-500",
    info: "bg-info-500",
    go: "bg-go-500",
  };
  const toneText: Record<string, string> = {
    ink: "text-ink-900",
    standby: "text-standby-700",
    info: "text-info-700",
    go: "text-go-700",
  };

  return (
    <div className={`space-y-5 ${className}`}>
      {/* ── Funnel ───────────────────────────────────────── */}
      <section className="surface overflow-hidden">
        <header className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="eyebrow">Outreach funnel · {assignments.length} providers</div>
            <h3 className="mt-1 text-[15px] font-semibold text-ink-900">From shortlist to booked</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              WhatsApp and call progress as reported by the backend. Click a stage to filter the list below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className="btn-secondary h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        {statusMessage && (
          <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-lg border border-info-200 bg-info-50 px-3 py-2 text-[12.5px] text-info-900">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="text-[11.5px] font-semibold text-info-700 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 border-t border-ink-200 md:grid-cols-4">
          {stages.map((s, i) => {
            const active = filterStatus === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setFilterStatus(active ? null : s.key)}
                aria-pressed={active}
                className={`group relative flex flex-col gap-2 px-5 py-4 text-left transition ${
                  i > 0 ? "md:border-l md:border-ink-200" : ""
                } ${i % 2 === 1 ? "border-l border-ink-200 md:border-l" : ""} ${i >= 2 ? "border-t border-ink-200 md:border-t-0" : ""} ${
                  active ? "bg-ink-100/80" : "hover:bg-ink-50"
                }`}
              >
                {active && <span className="absolute inset-x-0 top-0 h-[3px] bg-cue-600" />}
                <span className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-ink-400">{String(i + 1).padStart(2, "0")}</span>
                  {i < stages.length - 1 && (
                    <ChevronRight className="hidden h-3.5 w-3.5 text-ink-300 md:block" aria-hidden />
                  )}
                </span>
                <span
                  className={`font-display text-[34px] font-bold leading-none tabular-nums ${s.value ? toneText[s.tone] : "text-ink-300"}`}
                  style={{ fontStretch: "88%" }}
                >
                  {s.value}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink-900">{s.label}</span>
                  <span className="block text-[11.5px] text-ink-500">{s.hint}</span>
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-ink-200/70">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-700 ${toneBar[s.tone]}`}
                    style={{ width: `${(s.value / maxStage) * 100}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-200 bg-ink-50/70 px-5 py-2.5 text-[12px] text-ink-500">
          <button
            onClick={() => setFilterStatus(filterStatus === "DECLINED" ? null : "DECLINED")}
            className={`inline-flex items-center gap-1.5 font-semibold transition ${
              filterStatus === "DECLINED" ? "text-cue-700" : "hover:text-ink-900"
            }`}
          >
            <span className="cue-light bg-cue-500" />
            {stats.declined} declined
          </button>
          {stats.contacting > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="cue-light bg-standby-400 animate-cue-blink" />
              {stats.contacting} being contacted now
            </span>
          )}
          {stats.failed > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="cue-light bg-cue-700" />
              {stats.failed} failed to reach
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            {conversations.length} conversation {conversations.length === 1 ? "thread" : "threads"}
          </span>
          {filterStatus && (
            <button onClick={() => setFilterStatus(null)} className="ml-auto font-semibold text-ink-700 hover:underline">
              Clear filter
            </button>
          )}
        </footer>
      </section>

      {activeCall && <CallExecutionCard call={activeCall} />}

      {/* ── Provider list ────────────────────────────────── */}
      <section className="surface overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
          <div>
            <h3 className="text-[14px] font-semibold text-ink-900">Providers</h3>
            <p className="text-[12px] text-ink-500">
              {filterStatus ? `Filtered: ${filterStatus.toLowerCase()}` : "Everyone on the shortlist or under contract"}
            </p>
          </div>
          <span className="font-mono text-[11px] text-ink-400">{filteredAssignments.length} shown</span>
        </header>

        {loading && assignments.length === 0 ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="workspace-shimmer h-14 rounded-lg" />
            ))}
          </div>
        ) : filteredAssignments.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Users className="mx-auto mb-3 h-6 w-6 text-ink-300" />
            <p className="text-[13.5px] font-semibold text-ink-800">
              {assignments.length === 0 ? "No providers shortlisted yet" : "No providers in this stage"}
            </p>
            <p className="mx-auto mt-1 max-w-[44ch] text-[12.5px] text-ink-500">
              {assignments.length === 0
                ? "Run discovery on the Vendors page; shortlisted providers show up here ready to contact."
                : "Pick another stage above or clear the filter."}
            </p>
            {assignments.length === 0 && (
              <Link href={`/events/${eventId}/vendors`} className="btn-secondary mt-4">
                Go to vendors
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-ink-200 font-mono text-[10px] uppercase tracking-label text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quote</th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredAssignments.map((assignment, rowIdx) => {
                  const vendor = assignment.vendor;
                  const hasPhone = Boolean(vendor?.phone && vendor.phone.trim() !== "");
                  const matchingConv = conversations.find(
                    (c) => c.vendor_id === assignment.vendor_id || c.vendor_name === vendor?.name
                  );
                  const s = (assignment.status || "SHORTLISTED").toUpperCase();
                  const tone =
                    s === "CONFIRMED"
                      ? "go"
                      : s === "DECLINED" || s === "CANCELLED" || s === "FAILED"
                      ? "cue"
                      : s === "ENGAGED" || s === "CONTACTED"
                      ? "standby"
                      : "idle";
                  const chipCls: Record<string, string> = {
                    go: "border-go-200 bg-go-50 text-go-700",
                    cue: "border-cue-200 bg-cue-50 text-cue-700",
                    standby: "border-standby-200 bg-standby-50 text-standby-800",
                    idle: "border-ink-200 bg-ink-100/70 text-ink-600",
                  };
                  const dot: Record<string, string> = {
                    go: "bg-go-500",
                    cue: "bg-cue-600",
                    standby: "bg-standby-500",
                    idle: "bg-ink-400",
                  };
                  const sym = assignment.currency === "INR" || !assignment.currency ? "₹" : `${assignment.currency} `;

                  return (
                    <motion.tr
                      key={assignment.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 380, damping: 30, delay: reduceMotion ? 0 : Math.min(rowIdx, 12) * 0.035 }}
                      className="align-top transition-colors hover:bg-ink-50/80"
                    >
                      <td className="px-5 py-3.5">
                        <div className="text-[13.5px] font-semibold text-ink-900">{vendor?.name || "Provider"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11.5px] font-semibold text-ink-600">{humanizeCategory(assignment.category)}</span>
                          <span className="text-ink-300">·</span>
                          <span className="text-[11.5px] text-ink-500">{vendor?.city || "City unknown"}</span>
                          <ProvenanceBadge source={(vendor as any)?.source_tag || "UNKNOWN"} size="sm" />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {hasPhone ? (
                          <>
                            <div className="font-mono text-[12px] text-ink-800">{vendor?.phone}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-500">
                              <span className="inline-flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" /> WhatsApp
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <PhoneCall className="h-3 w-3" /> Call
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-[12px] italic text-ink-400">No phone on record</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`chip ${chipCls[tone]}`}>
                          <span className={`cue-light ${dot[tone]}`} />
                          {s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                        </span>
                        {assignment.negotiation_status && (
                          <div className="mt-1 font-mono text-[10.5px] text-ink-500">
                            {assignment.negotiation_status.replace(/_/g, " ").toLowerCase()}
                          </div>
                        )}
                        {matchingConv?.latest_message && (
                          <p className="mt-1 max-w-[220px] truncate text-[11.5px] text-ink-500">
                            &ldquo;{matchingConv.latest_message.raw_text}&rdquo;
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {assignment.quoted_amount != null ? (
                          <>
                            <div className="font-display text-[17px] font-bold tabular-nums text-ink-900" style={{ fontStretch: "90%" }}>
                              {sym}
                              {Number(assignment.quoted_amount).toLocaleString()}
                            </div>
                            {assignment.target_amount != null && (
                              <div className="font-mono text-[10.5px] text-ink-400">
                                target {sym}
                                {Number(assignment.target_amount).toLocaleString()}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[12px] text-ink-400">No quote yet</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {matchingConv ? (
                          onSelectConversation ? (
                            <button onClick={() => onSelectConversation(matchingConv.id)} className="btn-secondary h-8">
                              Open thread <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <Link href={`/events/${eventId}/conversations`} className="btn-secondary h-8">
                              Open thread <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          )
                        ) : (
                          <span className="text-[12px] text-ink-400">No thread yet</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
