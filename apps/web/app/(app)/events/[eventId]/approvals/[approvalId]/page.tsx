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
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import { CueChip, type CueTone } from "@/components/ds";
import { getApproval, approveRequest, rejectRequest } from "@/lib/api/approvals";
import type { ApprovalRequestResponse } from "@/types/api";
import { motion, useReducedMotion } from "framer-motion";
import { Celebrate, SPRING } from "@/components/ds/motion";
import { IMPACT, toDisplayItem } from "@/features/approvals/describe";
import { MoneyPanel, Consequences, DecideBy } from "@/features/approvals/DecisionParts";
import { formatMoney, humanizeActor, humanizeCode, timeAgo } from "@/lib/humanize";

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
  const [celebrate, setCelebrate] = useState(false);
  const [confirmNoAmount, setConfirmNoAmount] = useState(false);
  const reduce = useReducedMotion();

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
    // A money decision without an amount needs a second, explicit confirmation.
    const v = toDisplayItem(approval);
    if (v.money.involvesMoney && v.money.amount === null && !confirmNoAmount) {
      setConfirmNoAmount(true);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const updated = await approveRequest(eventId, approval.id, decisionNotes || undefined);
      setApproval(updated);
      if (updated?.status === "APPROVED") {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 1400);
      }
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

  const statusTone: CueTone =
    approval?.status === "APPROVED"
      ? "go"
      : approval?.status === "REJECTED"
      ? "cue"
      : approval?.status === "STALE"
      ? "standby"
      : approval?.status === "EXPIRED"
      ? "idle"
      : "standby";
  // Same reading as the queue, so card and detail always agree (incl. impact).
  const view = approval ? toDisplayItem(approval) : null;
  const impactCfg = view ? IMPACT[view.impact] : null;
  const costLabel =
    (view && view.money.amount !== null ? formatMoney(view.money.amount, view.money.currency) : null) ??
    formatMoney(reqAction.cost_delta, reqAction.currency || "INR") ??
    formatMoney(reqAction.proposed_cost, reqAction.currency || "INR");
  const isAgent = /^(system|agent)/i.test(approval?.requester_id || "");

  return (
    <EventShell eventId={eventId} currentStage="READY">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/events/${eventId}/approvals`}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-900"
          >
            <ArrowLeft className="h-4 w-4" />
            All approvals
          </Link>
          {approval?.reply_code && (
            <span className="chip border-ink-200 bg-[#FDFCFA] text-ink-700">
              <Smartphone className="h-3 w-3 text-ink-500" />
              Reply code <strong className="font-mono">{approval.reply_code}</strong>
            </span>
          )}
        </div>

        {token && (
          <div className="flex items-start gap-2.5 rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-[12.5px] text-info-900">
            <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-info-600" />
            <span>
              <strong>Opened from a secure link.</strong> You can read this request here; approving or declining needs an organizer sign-in.
            </span>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            <div className="workspace-shimmer h-40 rounded-xl" />
            <div className="workspace-shimmer h-28 rounded-xl" />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-cue-200 bg-cue-50 px-4 py-3 text-cue-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-cue-600" />
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold">Couldn&apos;t load this approval</div>
              <p className="mt-0.5 text-[12.5px] text-cue-800">{error}</p>
            </div>
            <button onClick={fetchDetail} className="btn-secondary h-8">
              Retry
            </button>
          </div>
        )}

        {!loading && approval && (
          <div className="space-y-5">
            <section className="surface overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-ink-200 px-6 pb-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {impactCfg && <CueChip tone={impactCfg.tone}>{impactCfg.label}</CueChip>}
                    <CueChip tone={statusTone} pulse={isPending}>
                      {humanize(String(approval.status))}
                    </CueChip>
                  </div>
                  <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.025em] text-ink-900" style={{ fontStretch: "88%" }}>
                    {view?.title || humanize(approval.action_type)}
                  </h1>
                  <p className="mt-1 text-[12.5px] text-ink-500">
                    Asked by <strong className="font-semibold text-ink-700">{humanizeActor(approval.requester_id)}</strong>
                    {approval.created_at ? ` · ${timeAgo(approval.created_at)}` : ""}
                  </p>
                </div>
                {isPending && view?.expiresAt && (
                  <div className="shrink-0 rounded-xl border border-standby-200 bg-standby-50 px-4 py-2.5">
                    <DecideBy iso={view.expiresAt} />
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-1 divide-y divide-ink-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Fact
                  label="Applies to"
                  value={view?.subjectName || view?.category || "Whole event"}
                  sub={view?.subjectName && view?.category ? view.category : null}
                />
                <Fact
                  label="Amount"
                  value={costLabel || (view?.money.involvesMoney ? "Not provided" : "No direct cost")}
                  muted={!costLabel}
                />
                <Fact
                  label="Proposed by"
                  value={humanizeActor(approval.requester_id)}
                  sub={isAgent ? "Automated proposal" : "Event member"}
                  badge={isAgent ? "AGENT" : "HUMAN"}
                />
              </dl>

              {view && (view.money.involvesMoney || view.money.amount !== null) && (
                <div className="border-t border-ink-200 px-6 py-5">
                  <MoneyPanel req={view} />
                </div>
              )}

              <div className="border-t border-ink-200 px-6 py-5">
                <h2 className="eyebrow mb-2">What will happen</h2>
                <p className="text-[14.5px] leading-relaxed text-ink-800">
                  {reqAction.proposed_summary || view?.onApprove || view?.whatHappens}
                </p>
                {view && (
                  <div className="mt-4 rounded-xl border border-agent-200 bg-agent-50/70 p-4">
                    <div className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-label text-agent-700">
                      {view.whyIsDerived ? "Why this needs you" : "✦ Why the agent proposes it"}
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-agent-950">{view.why}</p>
                  </div>
                )}
                <TechnicalDetails approval={approval} action={reqAction} />
              </div>
            </section>

            {isStale && (
              <Notice tone="standby" icon={<AlertTriangle className="h-4 w-4" />} title="This request is out of date">
                The event changed after this request was made, so the agent stopped instead of applying it.
              </Notice>
            )}
            {isExpired && (
              <Notice tone="idle" icon={<Clock className="h-4 w-4" />} title="This request expired">
                Nobody responded in time, so it was marked expired and the agent planned another route.
              </Notice>
            )}
            {approval.status === "APPROVED" && (
              <motion.div initial={reduce ? false : { opacity: 0, scale: 0.97, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING}>
                <Notice tone="go" icon={<CheckCircle2 className="h-4 w-4" />} title="Approved">
                  {approval.decision_notes || "This request was approved."}
                </Notice>
              </motion.div>
            )}
            {approval.status === "REJECTED" && (
              <Notice tone="cue" icon={<XCircle className="h-4 w-4" />} title="Declined">
                {approval.rejection_reason || "This request was declined."}
              </Notice>
            )}

            {isPending && (
              <section className="surface overflow-hidden">
                <div className="px-6 pb-4 pt-5">
                  <h3 className="text-[16px] font-semibold text-ink-900">Your decision</h3>
                  <p className="mt-1 text-[13px] text-ink-500">
                    Approving lets EVENTRA carry out this action and continue the steps waiting on it.
                  </p>
                  {view && (
                    <div className="mt-4">
                      <Consequences req={view} />
                    </div>
                  )}
                  {confirmNoAmount && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-standby-300 bg-standby-50 px-4 py-3 text-[13px] text-standby-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-standby-600" />
                      <span>
                        <strong className="font-semibold">Approve without knowing the amount?</strong> Press the button again to
                        confirm, or decline and ask the vendor for a price first.
                      </span>
                    </div>
                  )}
                  <label htmlFor="decision-notes" className="eyebrow mb-1.5 mt-4 block">
                    Notes (optional)
                  </label>
                  <textarea
                    id="decision-notes"
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Context for the history log or instructions for the agent…"
                    rows={2}
                    className="w-full rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 bg-ink-50/80 px-6 py-4">
                  <button onClick={() => setShowRejectModal(true)} disabled={actionLoading} className="btn-secondary">
                    <XCircle className="h-3.5 w-3.5" />
                    Decline
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="btn-cue px-5"
                    data-guide-step="approve_requests"
                  >
                    {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {confirmNoAmount ? "Yes, approve" : costLabel ? `Approve ${costLabel}` : "Approve and run"}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        <div className="pointer-events-none fixed bottom-20 left-1/2 z-[61] -translate-x-1/2">
          <Celebrate show={celebrate} label="Approved" />
        </div>

        {showRejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md animate-rise-in rounded-2xl border border-ink-200 bg-[#FDFCFA] p-6 shadow-2xl">
              <h4 className="text-[16px] font-semibold text-ink-900">Decline this request</h4>
              <p className="mt-1 text-[13px] text-ink-500">Say why — it is saved to the history log and tells the agent what to try next.</p>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Over budget, pick another vendor"
                rows={3}
                autoFocus
                className="mt-4 w-full rounded-xl border border-ink-200 bg-ink-50 p-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-cue-400 focus:bg-white focus:outline-none"
              />
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowRejectModal(false)} className="btn-ghost">
                  Cancel
                </button>
                <button onClick={handleReject} disabled={actionLoading || !rejectionReason.trim()} className="btn-cue">
                  Decline request
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}

function humanize(s: string) {
  return (s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function Fact({ label, value, sub, muted, badge }: { label: string; value: string; sub?: string | null; muted?: boolean; badge?: string }) {
  return (
    <div className="min-w-0 px-6 py-4">
      <dt className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">{label}</span>
        {badge && <ProvenanceBadge source={badge} size="sm" />}
      </dt>
      <dd className={`mt-1 text-[15px] font-semibold ${muted ? "text-ink-400" : "text-ink-900"}`}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate font-mono text-[11px] text-ink-400">{sub}</dd>}
    </div>
  );
}

function Notice({ tone, icon, title, children }: { tone: CueTone; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const cls: Record<string, string> = {
    standby: "border-standby-200 bg-standby-50 text-standby-900",
    idle: "border-ink-200 bg-ink-100 text-ink-800",
    go: "border-go-200 bg-go-50 text-go-900",
    cue: "border-cue-200 bg-cue-50 text-cue-900",
  };
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 ${cls[tone] || cls.idle}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="text-[13.5px] font-semibold">{title}</div>
        <p className="mt-0.5 text-[12.5px] opacity-85">{children}</p>
      </div>
    </div>
  );
}

/** IDs and raw fields, out of the way but still inspectable. */
function TechnicalDetails({ approval, action }: { approval: ApprovalRequestResponse; action: Record<string, any> }) {
  const rows: Array<[string, string]> = [
    ["Request", approval.id],
    ["Action type", approval.action_type],
    ["Target", [approval.target_type, approval.target_id].filter(Boolean).join(" · ")],
    ...Object.entries(action)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => [humanizeCode(k), String(v)] as [string, string]),
  ];
  return (
    <details className="group mt-4 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-[12.5px]">
      <summary className="cursor-pointer list-none font-semibold text-ink-500 hover:text-ink-800">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Technical details
      </summary>
      <dl className="mt-2 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-500">{k}</dt>
            <dd className="truncate font-mono text-[11.5px] text-ink-700" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
