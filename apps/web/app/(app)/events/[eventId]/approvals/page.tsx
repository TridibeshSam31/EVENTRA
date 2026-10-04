"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserCheck,
  RefreshCw,
  Loader2,
  Bot,
  Fingerprint,
  Info,
  Clock,
  Inbox,
  AlertCircle,
} from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { listApprovals, approveRequest, rejectRequest } from "@/lib/api/approvals";
import { PushNotificationBanner } from "@/components/notifications";
import type { ApprovalRequestResponse } from "@/types/api";

interface DisplayApproval {
  id: string;
  type: string;
  title: string;
  requestedBy: string;
  time: string;
  severity: "critical" | "warning" | "info";
  description: string;
  aiAnalysis: string;
  status: string;
  raw: ApprovalRequestResponse;
}

function severityFromPriority(priority?: string): "critical" | "warning" | "info" {
  if (!priority) return "info";
  const p = priority.toLowerCase();
  if (p === "critical" || p === "high") return "critical";
  if (p === "medium" || p === "warning") return "warning";
  return "info";
}

function toDisplayItem(r: ApprovalRequestResponse): DisplayApproval {
  const reqAction = (r.requested_action || {}) as Record<string, any>;
  const title =
    (reqAction.title as string) ||
    (reqAction.action as string) ||
    (r.action_type ? r.action_type.replace(/_/g, " ").toUpperCase() : "Approval Request");
  const description =
    (reqAction.description as string) ||
    (reqAction.reason as string) ||
    r.decision_notes ||
    `Target: ${r.target_type || "system"} (${r.target_id || "N/A"})`;
  const aiAnalysis =
    (reqAction.ai_context as string) ||
    (reqAction.reasoning as string) ||
    (reqAction.recommendation as string) ||
    `Agent requested ${r.action_type || "operational action"} on ${r.target_type || "event"}. Impact level: ${r.impact_level}.`;

  return {
    id: r.id,
    type: r.action_type || "Operational Action",
    title,
    requestedBy: r.requester_id || "System AI",
    time: r.created_at ? new Date(r.created_at).toLocaleTimeString() : "",
    severity: severityFromPriority(r.impact_level),
    description,
    aiAnalysis,
    status: r.status as string,
    raw: r,
  };
}

export default function ApprovalsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [items, setItems] = useState<DisplayApproval[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Record<string, "approved" | "denied">>({});
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const fetchApprovals = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError(null);
      setActionError(null);
      const res = await listApprovals(eventId, { status: "PENDING", limit: 50 });
      if (res.items && res.items.length > 0) {
        const mapped = res.items.map(toDisplayItem);
        setItems(mapped);
        if (!activeId || !mapped.some((m) => m.id === activeId)) {
          setActiveId(mapped[0].id);
        }
      } else {
        setItems([]);
        setActiveId(null);
      }
    } catch (err: any) {
      console.error("Failed to fetch approvals:", err);
      setError(err?.message || "Failed to load approval requests from backend.");
      setItems([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, [eventId, activeId]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const activeRequest = items.find((a) => a.id === activeId);
  const resolution = activeId ? resolvedIds[activeId] : undefined;
  const pendingCount = items.filter((i) => !resolvedIds[i.id]).length;

  const handleAction = async (action: "approved" | "denied") => {
    if (!eventId || !activeId) return;
    if (action === "denied" && !showRejectInput) {
      setShowRejectInput(true);
      return;
    }

    setProcessing(true);
    setActionError(null);
    setShowRejectInput(false);

    try {
      if (action === "approved") {
        await approveRequest(eventId, activeId, "Approved via Eventra Operations Console");
      } else {
        await rejectRequest(eventId, activeId, rejectReason || "Rejected by executive operator");
      }

      setResolvedIds((prev) => ({ ...prev, [activeId]: action }));

      // Auto-advance to next pending item
      const next = items.find((i) => i.id !== activeId && !resolvedIds[i.id]);
      if (next) {
        setActiveId(next.id);
      }
    } catch (err: any) {
      console.error("Approval action failed:", err);
      setActionError(err?.message || `Failed to record ${action} decision. Please retry.`);
    } finally {
      setProcessing(false);
      setRejectReason("");
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return "text-rose-700 border-rose-200 bg-rose-50";
      case "warning":
        return "text-amber-700 border-amber-200 bg-amber-50";
      default:
        return "text-blue-700 border-blue-200 bg-blue-50";
    }
  };

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <div className="space-y-6">
        {/* Remote Approval Push Notification Banner */}
        <PushNotificationBanner />

        {/* Header Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Governance Command
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {pendingCount} Pending Sign-offs
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-1 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Human Authorization Queue
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              AI agents propose high-impact operational decisions. Human authority provides final deterministic sign-off.
            </p>
          </div>

          <button
            onClick={() => fetchApprovals()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Queue
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Error Banner */}
        {actionError && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Main Content */}
        {loading && items.length === 0 ? (
          <div className="p-16 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
            <p className="text-xs font-medium text-slate-600">Loading pending authorization requests…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Authorization Queue Clear</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              There are no pending actions requiring executive approval. When an autonomous workflow reaches a financial threshold or recovery trigger, it will appear here for review.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Action Queue */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Requests ({items.length})
                </span>
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                  {pendingCount} Awaiting Decision
                </span>
              </div>

              <div className="space-y-2.5">
                {items.map((req) => {
                  const isActive = activeId === req.id;
                  const status = resolvedIds[req.id];

                  return (
                    <button
                      key={req.id}
                      onClick={() => {
                        setActiveId(req.id);
                        setShowRejectInput(false);
                        setActionError(null);
                      }}
                      className={`w-full text-left p-4 rounded-xl border transition-all text-xs ${
                        isActive
                          ? "bg-white border-[#D6003C] shadow-sm ring-1 ring-[#D6003C]/30"
                          : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        {status === "approved" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Approved
                          </span>
                        ) : status === "denied" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" /> Denied
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getSeverityBadge(
                              req.severity
                            )}`}
                          >
                            <AlertTriangle className="w-3 h-3" /> {req.type}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-slate-400">{req.time}</span>
                      </div>

                      <h4 className="font-bold text-slate-900 leading-snug text-sm mb-1">{req.title}</h4>

                      <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                        <span>Requested by: {req.requestedBy}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Authorization Detail & Decision Dashboard */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {activeRequest ? (
                <div className="flex flex-col">
                  {/* Top Status Header */}
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {activeRequest.id}
                      </span>
                      {resolution ? (
                        <span
                          className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                            resolution === "approved" ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {resolution === "approved" ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-600" />
                          )}
                          Request {resolution}
                        </span>
                      ) : (
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" /> Awaiting Authorization
                        </span>
                      )}
                    </div>

                    <h2 className="text-xl font-bold text-slate-900">{activeRequest.title}</h2>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                        <span>Requester: <strong className="text-slate-800">{activeRequest.requestedBy}</strong></span>
                      </div>
                      <span className="text-slate-300">•</span>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Submitted: {activeRequest.time || "Recent"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-6 space-y-6">
                    {/* Operational Description */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                        Operational Scope &amp; Context
                      </h4>
                      <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                        {activeRequest.description}
                      </p>
                    </div>

                    {/* AI Assessment / Recommendation Box */}
                    <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-5 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800">
                        <Bot className="w-4 h-4 text-emerald-700" />
                        Autonomous Agent Recommendation &amp; Impact Analysis
                      </div>
                      <p className="text-xs text-emerald-950 leading-relaxed">
                        {activeRequest.aiAnalysis}
                      </p>
                    </div>

                    {/* Rejection Note Input */}
                    {showRejectInput && !resolution && (
                      <div className="space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-rose-700">
                          Rejection Rationale (Required for Audit Record)
                        </label>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Provide the reason for denial to record in the governance trace…"
                          rows={3}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                        />
                      </div>
                    )}

                    {/* Resolution Banner */}
                    {resolution && (
                      <div
                        className={`p-6 rounded-xl border text-center space-y-2 ${
                          resolution === "approved"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                            : "bg-rose-50 border-rose-200 text-rose-900"
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full mx-auto flex items-center justify-center bg-white shadow-xs">
                          {resolution === "approved" ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                          ) : (
                            <XCircle className="w-6 h-6 text-rose-600" />
                          )}
                        </div>
                        <h4 className="text-sm font-bold">
                          {resolution === "approved" ? "Authorization Granted" : "Request Denied"}
                        </h4>
                        <p className="text-xs text-slate-600 max-w-sm mx-auto">
                          {resolution === "approved"
                            ? "The action has been authorized and dispatched to the orchestration pipeline."
                            : "The request has been rejected. Relevant operational owners have been notified."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action Footer */}
                  {!resolution && (
                    <div className="p-5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Fingerprint className="w-4 h-4 text-slate-400" />
                        <span>Cryptographically logged to audit trail</span>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() =>
                            showRejectInput ? handleAction("denied") : setShowRejectInput(true)
                          }
                          disabled={processing}
                          className="flex-1 sm:flex-none px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition disabled:opacity-50"
                        >
                          {showRejectInput ? "Confirm Denial" : "Deny Request"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAction("approved")}
                          disabled={processing}
                          className="flex-1 sm:flex-none px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {processing ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Signing…</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Authorize Action</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-16 text-center text-slate-400 text-xs">
                  Select an approval request to inspect context and sign off.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}
