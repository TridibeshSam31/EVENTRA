"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Bot,
  User,
  ShieldCheck,
  DollarSign,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";

import {
  getNegotiationConversation,
  negotiateWithProvider,
  requestEngagementApproval,
  confirmProviderEngagement,
  NegotiationConversation,
  NegotiationResult,
} from "@/lib/api/negotiation";
import { getBudgetSummary } from "@/lib/api/budget";
import type { BudgetSummaryResponse } from "@/types/api";

import { ProvenanceBadge } from "./ProvenanceBadge";
import {
  NegotiationRoundStepper,
  NegotiationRoundItem,
} from "./NegotiationRoundStepper";
import type { QuoteEvidenceItem } from "./QuoteEvidenceDrawer";

interface NegotiationCommandProps {
  eventId: string;
  assignmentId: string;
  onBack?: () => void;
  className?: string;
}

export function NegotiationCommand({
  eventId,
  assignmentId,
  onBack,
  className = "",
}: NegotiationCommandProps) {
  const [conversationData, setConversationData] =
    useState<NegotiationConversation | null>(null);
  const [budgetSummary, setBudgetSummary] =
    useState<BudgetSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Load negotiation conversation and budget state
  const loadNegotiationData = useCallback(async () => {
    if (!assignmentId) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      const [convRes, budgetRes] = await Promise.allSettled([
        getNegotiationConversation(assignmentId),
        getBudgetSummary(eventId),
      ]);

      if (convRes.status === "fulfilled" && convRes.value) {
        setConversationData(convRes.value);
      } else if (convRes.status === "rejected") {
        setErrorMessage("Could not load negotiation conversation from backend.");
      }

      if (budgetRes.status === "fulfilled" && budgetRes.value) {
        setBudgetSummary(budgetRes.value);
      }
    } catch (err: any) {
      console.error("Negotiation load failed:", err);
      setErrorMessage(err.message || "Failed to load negotiation session.");
    } finally {
      setLoading(false);
    }
  }, [eventId, assignmentId]);

  useEffect(() => {
    loadNegotiationData();
  }, [loadNegotiationData]);

  const assignment = conversationData?.assignment as any;
  const vendor = conversationData?.vendor as any;
  const messages = (conversationData?.messages as any[]) || [];
  const budgetValidation = conversationData?.budget_validation as any;

  // Build Chronological Negotiation Rounds from real backend communication
  const negotiationRounds: NegotiationRoundItem[] = React.useMemo(() => {
    if (!messages || messages.length === 0) {
      // If assignment has a quoted amount or negotiation round recorded on the model:
      if (assignment?.quoted_amount) {
        return [
          {
            round_number: 1,
            actor: "PROVIDER",
            actor_name: vendor?.name || "Provider",
            timestamp: assignment.updated_at || assignment.created_at || new Date().toISOString(),
            offered_amount: assignment.quoted_amount,
            currency: assignment.currency || "INR",
            message_text: assignment.notes || "Initial supplier quote submitted.",
            state: assignment.negotiation_status || "QUOTATION_RECEIVED",
            provenance: (vendor as any)?.source_tag || "LIVE_SCRAPE",
          },
        ];
      }
      return [];
    }

    return messages.map((m: any, idx: number) => {
      const isOutbound = m.direction === "outbound";
      const facts = m.extracted_facts || {};

      return {
        round_number: idx + 1,
        actor: isOutbound ? "AGENT" : "PROVIDER",
        actor_name: isOutbound ? "EVENTRA Autonomous Negotiator" : vendor?.name || "Provider",
        timestamp: m.timestamp || m.created_at || new Date().toISOString(),
        offered_amount: facts.quoted_amount ?? (isOutbound ? assignment?.target_amount : assignment?.quoted_amount),
        currency: facts.currency || assignment?.currency || "INR",
        message_text: m.raw_text || m.message,
        state: m.status || assignment?.negotiation_status,
        provenance: isOutbound ? "AGENT" : (vendor as any)?.source_tag || "LIVE_SCRAPE",
        source_evidence: m.id ? `msg_${m.id.slice(0, 8)}` : undefined,
      };
    });
  }, [messages, assignment, vendor]);

  // Actions
  const handleSendCounterOffer = async () => {
    try {
      setActionInProgress("counter");
      setStatusMessage("Dispatching autonomous counter-offer to provider...");
      setErrorMessage(null);
      const res = await negotiateWithProvider(assignmentId);
      setStatusMessage(res.message || "Counter-offer sent.");
      await loadNegotiationData();
    } catch (err: any) {
      console.error("Counter-offer failed:", err);
      setErrorMessage(err.message || "Failed to dispatch counter-offer.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRequestApproval = async () => {
    try {
      setActionInProgress("approval");
      setStatusMessage("Submitting engagement terms for human manager approval...");
      setErrorMessage(null);
      const res = await requestEngagementApproval(assignmentId);
      setStatusMessage("Approval ticket created. Pending manager review.");
      await loadNegotiationData();
    } catch (err: any) {
      console.error("Approval request failed:", err);
      setErrorMessage(err.message || "Failed to submit approval request.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleConfirmEngagement = async () => {
    try {
      setActionInProgress("confirm");
      setStatusMessage("Executing binding provider contract confirmation...");
      setErrorMessage(null);
      const res = await confirmProviderEngagement(assignmentId);
      setStatusMessage(res.message || "Provider engagement confirmed and locked.");
      await loadNegotiationData();
    } catch (err: any) {
      console.error("Confirmation failed:", err);
      setErrorMessage(err.message || "Engagement confirmation rejected by governance engine.");
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading && !conversationData) {
    return (
      <div className="py-24 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
        Loading negotiation records and budget validation...
      </div>
    );
  }

  const curr = assignment?.currency === "INR" || !assignment?.currency ? "₹" : `${assignment?.currency} `;
  const isAwaitingApproval = assignment?.negotiation_status === "AWAITING_APPROVAL";
  const isConfirmed = assignment?.negotiation_status === "CONFIRMED";
  const hasApprovalId = Boolean(assignment?.approval_id);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 1. Header Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition mt-0.5"
                title="Back to Quote Comparison"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  {assignment?.category || "PROVIDER"} Negotiation
                </span>
                <ProvenanceBadge source={(vendor as any)?.source_tag || "LIVE_SCRAPE"} size="sm" />
                <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                  {assignment?.negotiation_status || "UNKNOWN"}
                </span>
              </div>

              <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
                {vendor?.name || "Provider"} Commercial Terms
              </h2>
              <p className="text-xs text-slate-500">
                Deterministic negotiation engine governed by budget ceilings and mandatory human approval.
              </p>
            </div>
          </div>

          {/* Current Quote Highlight */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                Current Quote
              </span>
              <span className="font-mono font-bold text-slate-900 text-base">
                {assignment?.quoted_amount != null
                  ? `${curr}${Number(assignment.quoted_amount).toLocaleString()}`
                  : "Quote unavailable"}
              </span>
            </div>

            <button
              onClick={loadNegotiationData}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition"
              title="Refresh"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
              {statusMessage}
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-[10px] font-semibold text-blue-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              {errorMessage}
            </span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-[10px] font-semibold text-rose-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* 2. Main Workspace Split: Timeline (Left 7) vs Budget/Governance (Right 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Negotiation Stepper & Rounds (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-[#D6003C]" />
                <span>Negotiation Timeline & Message Audit</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Chronological record of commercial offers, counter-proposals, and terms.
              </p>
            </div>

            <span className="text-[10px] font-mono text-slate-400">
              {negotiationRounds.length} Rounds Logged
            </span>
          </div>

          <NegotiationRoundStepper
            rounds={negotiationRounds}
            targetAmount={assignment?.target_amount}
            maxApprovedAmount={assignment?.max_approved_amount}
            currency={assignment?.currency || "INR"}
          />
        </div>

        {/* Right Column: Commercial Governance & Actions (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Target Constraints Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Negotiation Parameters
            </span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Target Rate</span>
                <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                  {assignment?.target_amount != null
                    ? `${curr}${Number(assignment.target_amount).toLocaleString()}`
                    : "UNSET"}
                </span>
                <span className="text-[10px] text-slate-400">Negotiation goal</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Budget Ceiling</span>
                <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                  {assignment?.max_approved_amount != null
                    ? `${curr}${Number(assignment.max_approved_amount).toLocaleString()}`
                    : "UNSET"}
                </span>
                <span className="text-[10px] text-slate-400">Strict max threshold</span>
              </div>
            </div>
          </div>

          {/* Budget Impact Card (Authoritative from Backend) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Budget Engine Impact
            </span>

            {budgetValidation ? (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Total Event Budget</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {curr}{Number(budgetValidation.total_budget || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Remaining Budget</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {curr}{Number(budgetValidation.remaining_budget || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200">
                  <span className="text-slate-600">Budget Utilization:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {budgetValidation.budget_utilization_percent}%
                  </span>
                </div>

                {budgetValidation.would_exceed_budget && (
                  <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>Proposed quote exceeds available budget allocation!</span>
                  </div>
                )}
              </div>
            ) : budgetSummary ? (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Total Budget</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {curr}{Number(budgetSummary.total_budget).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Remaining</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {curr}{Number(budgetSummary.remaining).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded bg-slate-50 border border-slate-200 text-slate-400 text-center text-xs">
                Budget impact unavailable
              </div>
            )}
          </div>

          {/* Governance & Human Approval Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Governance & Authority
            </span>

            {hasApprovalId ? (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    Approval Request #{assignment.approval_id.slice(0, 8)}
                  </span>
                  <span className="text-[10px] font-mono uppercase bg-amber-100 px-1.5 py-0.2 rounded">
                    {assignment.approval_status || "PENDING"}
                  </span>
                </div>
                <p className="text-[11px] text-amber-700">
                  Agent is strictly prohibited from autonomously confirming quotes. Human sign-off is required.
                </p>
                <Link
                  href={`/events/${eventId}/approvals`}
                  className="inline-block text-[11px] font-semibold text-[#D6003C] hover:underline mt-1"
                >
                  Review Ticket in Approvals Console &rarr;
                </Link>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <span className="font-semibold block">Mandatory Human Sign-Off</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Submit this quote to manager approvals before committing event funds.
                </p>
              </div>
            )}
          </div>

          {/* Action Dispatcher Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Negotiation Actions
            </span>

            <div className="grid grid-cols-2 gap-2">
              {/* Send Counter-Offer */}
              <button
                onClick={handleSendCounterOffer}
                disabled={actionInProgress !== null || isConfirmed}
                className="py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              >
                <span>{actionInProgress === "counter" ? "Dispatching..." : "Send Counter-Offer"}</span>
              </button>

              {/* Request Approval */}
              <button
                onClick={handleRequestApproval}
                disabled={actionInProgress !== null || hasApprovalId || isConfirmed}
                className="py-2 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                <span>{hasApprovalId ? "Approval Requested" : "Request Approval"}</span>
              </button>
            </div>

            {/* Confirm & Bind Contract */}
            <button
              onClick={handleConfirmEngagement}
              disabled={actionInProgress !== null || isConfirmed || !hasApprovalId}
              className="w-full py-2.5 px-4 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasApprovalId ? "Approval required before confirmation" : undefined}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {isConfirmed
                  ? "Engagement Confirmed"
                  : actionInProgress === "confirm"
                  ? "Confirming..."
                  : !hasApprovalId
                  ? "Confirm Engagement (Approval Required)"
                  : "Confirm & Bind Contract"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
