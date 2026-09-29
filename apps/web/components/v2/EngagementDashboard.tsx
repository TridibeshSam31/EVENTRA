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

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Header & Live Telemetry Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Engagement & Outreach Command
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {assignments.length} contracted/shortlisted
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
              Multi-Channel Provider Communications
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live WhatsApp and Twilio telephony state synchronized with backend negotiation state machines.
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
              href={`/events/${eventId}/conversations`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Open Thread Console</span>
            </Link>
          </div>
        </div>

        {/* Status Message Alert */}
        {statusMessage && (
          <div className="mt-4 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-semibold text-blue-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 2. Authoritative State Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-5">
          <button
            onClick={() => setFilterStatus(filterStatus === "SHORTLISTED" ? null : "SHORTLISTED")}
            className={`p-3 rounded-lg border text-left transition ${
              filterStatus === "SHORTLISTED"
                ? "border-[#D6003C] bg-rose-50/30"
                : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/50"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Shortlisted
            </span>
            <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">
              {stats.shortlisted}
            </span>
            <span className="text-[10px] text-slate-500">Awaiting dispatch</span>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === "AWAITING" ? null : "AWAITING")}
            className={`p-3 rounded-lg border text-left transition ${
              filterStatus === "AWAITING"
                ? "border-[#D6003C] bg-rose-50/30"
                : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/50"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block">
              Awaiting Reply
            </span>
            <span className="text-xl font-bold font-mono text-amber-700 mt-0.5 block">
              {stats.awaiting}
            </span>
            <span className="text-[10px] text-slate-500">Outreach dispatched</span>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === "RESPONDED" ? null : "RESPONDED")}
            className={`p-3 rounded-lg border text-left transition ${
              filterStatus === "RESPONDED"
                ? "border-[#D6003C] bg-rose-50/30"
                : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/50"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 block">
              Responded
            </span>
            <span className="text-xl font-bold font-mono text-blue-700 mt-0.5 block">
              {stats.responded}
            </span>
            <span className="text-[10px] text-slate-500">Quotes & terms ready</span>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === "CONFIRMED" ? null : "CONFIRMED")}
            className={`p-3 rounded-lg border text-left transition ${
              filterStatus === "CONFIRMED"
                ? "border-[#D6003C] bg-rose-50/30"
                : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/50"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block">
              Confirmed
            </span>
            <span className="text-xl font-bold font-mono text-emerald-700 mt-0.5 block">
              {stats.confirmed}
            </span>
            <span className="text-[10px] text-slate-500">Locked to schedule</span>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === "DECLINED" ? null : "DECLINED")}
            className={`p-3 rounded-lg border text-left transition ${
              filterStatus === "DECLINED"
                ? "border-[#D6003C] bg-rose-50/30"
                : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/50"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 block">
              Declined
            </span>
            <span className="text-xl font-bold font-mono text-rose-700 mt-0.5 block">
              {stats.declined}
            </span>
            <span className="text-[10px] text-slate-500">Unavailable / rejected</span>
          </button>

          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Active Threads
            </span>
            <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">
              {conversations.length}
            </span>
            <span className="text-[10px] text-slate-500">Synchronized sessions</span>
          </div>
        </div>
      </div>

      {/* Active Call Execution Live Card if Triggered */}
      {activeCall && (
        <CallExecutionCard
          call={activeCall}
        />
      )}


      {/* 3. Shortlist to Engagement Bridge Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#D6003C]" />
              <span>Provider Engagement Registry</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Authoritative review and dispatch console for event candidates and contracted suppliers.
            </p>
          </div>

          {filterStatus && (
            <button
              onClick={() => setFilterStatus(null)}
              className="text-[11px] font-semibold text-[#D6003C] hover:underline"
            >
              Clear filter ({filterStatus})
            </button>
          )}
        </div>

        {loading && assignments.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
            Loading provider engagement states...
          </div>
        ) : filteredAssignments.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            No provider engagements found matching current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Contact Channels</th>
                  <th className="px-4 py-3">Engagement Status</th>
                  <th className="px-4 py-3">Terms / Quote</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssignments.map((assignment) => {
                  const vendor = assignment.vendor;
                  const hasPhone = Boolean(vendor?.phone && vendor.phone.trim() !== "");
                  const matchingConv = conversations.find(
                    (c) => c.vendor_id === assignment.vendor_id || c.vendor_name === vendor?.name
                  );

                  const isCallInProgress =
                    activeCall?.recipient_phone === vendor?.phone &&
                    (activeCall?.status === "RINGING" || activeCall?.status === "CONNECTED");

                  const isBusy = actionInProgress === assignment.id;

                  return (
                    <tr key={assignment.id} className="hover:bg-slate-50/70 transition">
                      {/* Provider Name & Provenance */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{vendor?.name || "Provider"}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ProvenanceBadge source={(vendor as any)?.source_tag || "LIVE_SCRAPE"} size="sm" />
                          <span className="text-[10px] text-slate-400 font-mono">
                            {vendor?.city || "UNKNOWN"}
                          </span>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3 font-semibold text-slate-600 uppercase text-[11px]">
                        {assignment.category}
                      </td>

                      {/* Contact Channels */}
                      <td className="px-4 py-3">
                        {hasPhone ? (
                          <div className="space-y-0.5">
                            <span className="font-mono text-[11px] text-slate-700 block">
                              {vendor?.phone}
                            </span>
                            <span className="text-[10px] text-emerald-600 font-medium">
                              WhatsApp & Voice Enabled
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">
                            No supported contact channel
                          </span>
                        )}
                      </td>

                      {/* Engagement Status */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              assignment.status === "CONFIRMED"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : assignment.status === "DECLINED" || assignment.status === "CANCELLED"
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : assignment.status === "ENGAGED" || assignment.status === "CONTACTED"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {assignment.status || "SHORTLISTED"}
                          </span>
                          {assignment.negotiation_status && (
                            <span className="text-[10px] font-mono text-slate-500">
                              ({assignment.negotiation_status})
                            </span>
                          )}
                        </div>

                        {matchingConv?.latest_message && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[180px] mt-1">
                            Latest: "{matchingConv.latest_message.raw_text}"
                          </div>
                        )}
                      </td>

                      {/* Terms / Quote */}
                      <td className="px-4 py-3">
                        {assignment.quoted_amount != null ? (
                          <div>
                            <span className="font-mono font-bold text-slate-900 text-xs">
                              {assignment.currency === "INR" || !assignment.currency ? "₹" : `${assignment.currency} `}
                              {Number(assignment.quoted_amount).toLocaleString()}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              Target: ₹{Number(assignment.target_amount || 0).toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">UNKNOWN</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Communication Status */}
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-slate-200 bg-slate-100 text-slate-700">
                            {assignment.status === "CONFIRMED" ? "Confirmed" : "Assigned"}
                          </span>


                          {/* View Conversation */}
                          {matchingConv ? (
                            <Link
                              href={`/events/${eventId}/conversations`}
                              className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition inline-flex items-center gap-1"
                            >
                              <span>Thread</span>
                              <ChevronRight className="w-3 h-3 text-slate-400" />
                            </Link>
                          ) : (
                            <button
                              disabled
                              className="px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-slate-100 bg-slate-50/50 cursor-not-allowed"
                            >
                              No Thread
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
