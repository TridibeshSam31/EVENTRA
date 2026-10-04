"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeft,
  Loader2,
  Link as LinkIcon,
  DollarSign,
  Layers,
  FileText,
  User,
  AlertCircle,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { EventShell } from "@/components/v2/EventShell";
import { getApproval, approveRequest, rejectRequest } from "@/lib/api/approvals";
import type { ApprovalRequestResponse } from "@/types/api";

export default function ApprovalDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const eventId = params.eventId as string;
  const approvalId = params.approvalId as string;
  const token = searchParams.get("token") || undefined;

  const [approval, setApproval] = useState<ApprovalRequestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!eventId || !approvalId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getApproval(eventId, approvalId, token);
      setApproval(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load approval request.");
    } finally {
      setLoading(false);
    }
  }, [eventId, approvalId, token]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleApprove = async () => {
    if (!approval) return;
    setActionLoading(true);
    setError(null);
    try {
      const updated = await approveRequest(eventId, approval.id, decisionNotes || undefined);
      setApproval(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to approve request.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!approval || !rejectionReason.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      const updated = await rejectRequest(eventId, approval.id, rejectionReason.trim());
      setApproval(updated);
      setShowRejectModal(false);
    } catch (err: any) {
      setError(err?.message || "Failed to reject request.");
    } finally {
      setActionLoading(false);
    }
  };

  const reqAction = (approval?.requested_action || {}) as Record<string, any>;
  const isPending = approval?.status === "PENDING";
  const isExpired = approval?.status === "EXPIRED";
  const isStale = approval?.status === "STALE";

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <div className="mx-auto max-w-4xl space-y-6 py-6 px-4">
        {/* Navigation Back */}
        <div className="flex items-center justify-between">
          <Link
            href={`/events/${eventId}/approvals`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Approvals</span>
          </Link>
          {approval?.reply_code && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-300">
              <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
              <span>Reply Code: <strong>{approval.reply_code}</strong></span>
            </div>
          )}
        </div>

        {/* Deep Link Token Banner */}
        {token && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3.5 text-xs text-sky-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-sky-400 shrink-0" />
              <span>
                <strong>Secure Deep Link Access:</strong> Viewing details via single-purpose signed token. Authorizing actions requires organizer session permissions.
              </span>
            </div>
          </div>
        )}

        {/* Loading / Error States */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mb-3" />
            <p className="text-sm">Loading approval details...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-200 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h5 className="font-semibold">Unable to process approval</h5>
              <p className="mt-0.5 text-xs text-rose-300">{error}</p>
            </div>
          </div>
        )}

        {!loading && approval && (
          <div className="space-y-6">
            {/* Header Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                        approval.impact_level === "CRITICAL"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                          : approval.impact_level === "MAJOR"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {approval.impact_level} IMPACT
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        approval.status === "APPROVED"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : approval.status === "REJECTED"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                          : approval.status === "EXPIRED"
                          ? "bg-slate-700 text-slate-300 border border-slate-600"
                          : approval.status === "STALE"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30"
                      }`}
                    >
                      {approval.status}
                    </span>
                  </div>

                  <h1 className="text-xl font-bold text-slate-100">
                    {approval.action_type.replace(/_/g, " ").toUpperCase()}
                  </h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Ticket ID: <span className="font-mono text-slate-300">{approval.id}</span>
                  </p>
                </div>

                {approval.expires_at && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                    <Clock className="h-4 w-4 text-amber-400" />
                    <div>
                      <div className="text-[10px] text-slate-400">EXPIRES AT</div>
                      <div>{new Date(approval.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Description & Data */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800 pt-5">
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
                    <Layers className="h-4 w-4 text-indigo-400" />
                    Target Scope
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    {approval.target_type}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                    {approval.target_id || "Global / Event-wide"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    Cost Differential
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    {reqAction.cost_delta !== undefined
                      ? `₹${Number(reqAction.cost_delta).toLocaleString()}`
                      : reqAction.proposed_cost !== undefined
                      ? `₹${Number(reqAction.proposed_cost).toLocaleString()}`
                      : "No Direct Cost Change"}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">Budget Impact</div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
                    <User className="h-4 w-4 text-sky-400" />
                    Requested By
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    {approval.requester_id === "system" ? "Autonomous Agent" : "Event Member"}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                    {approval.requester_id}
                  </div>
                </div>
              </div>

              {/* Proposed Action Payload Details */}
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
                  <FileText className="h-4 w-4 text-indigo-400" />
                  Proposed Operational Mutation
                </div>
                {reqAction.proposed_summary || reqAction.description ? (
                  <p className="text-sm text-slate-200">
                    {reqAction.proposed_summary || reqAction.description}
                  </p>
                ) : (
                  <pre className="text-xs text-slate-300 font-mono overflow-x-auto p-2 bg-slate-900 rounded-lg">
                    {JSON.stringify(reqAction, null, 2)}
                  </pre>
                )}
              </div>
            </div>

            {/* Decision Status Banners */}
            {isStale && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
                <h5 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  STALE ACTION
                </h5>
                <p className="mt-1 text-xs text-amber-300">
                  The event operational state has changed since this approval request was created.
                  The agent aborted automatic mutation to preserve referential integrity.
                </p>
              </div>
            )}

            {isExpired && (
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                <h5 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" />
                  Request Expired
                </h5>
                <p className="mt-1 text-xs text-slate-400">
                  This operational approval timed out without an organizer response. It has been marked EXPIRED.
                  The agent has automatically replanned the operational path.
                </p>
              </div>
            )}

            {/* Decision Panel (Pending Only) */}
            {isPending && (
              <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-6 shadow-xl">
                <h3 className="text-base font-semibold text-slate-100 mb-2">
                  Organizer Decision Authorization
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  Separation of duties enforced. Approving this request will atomically execute the mutation
                  and unblock downstream agent tasks.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Decision Notes (Optional)
                    </label>
                    <textarea
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                      placeholder="Add audit rationale or instructions for the agent..."
                      rows={2}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      onClick={handleApprove}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-all hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 disabled:opacity-50"
                    >
                      {actionLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      <span>Authorize & Execute Action</span>
                    </button>

                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/30 px-5 py-2.5 text-xs font-semibold text-rose-300 transition-all hover:bg-rose-900/40 focus:outline-none disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4 text-rose-400" />
                      <span>Reject Request</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Rejection Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              <h4 className="text-base font-semibold text-slate-100">Reject Approval Request</h4>
              <p className="mt-1 text-xs text-slate-400">
                Please provide a mandatory reason for rejecting this operational action.
              </p>

              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Reason for rejection (e.g. Budget exceeded, choose alternative vendor)..."
                rows={3}
                className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200 focus:border-rose-500 focus:outline-none"
              />

              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  onClick={() => setShowRejectModal(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={actionLoading || !rejectionReason.trim()}
                  className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}
