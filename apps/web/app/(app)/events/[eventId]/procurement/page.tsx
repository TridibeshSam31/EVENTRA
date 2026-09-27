"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  DollarSign,
  Users,
  ShieldCheck,
  RotateCcw,
  Loader2,
  Sparkles,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import { getAssignmentsForEvent } from "@/lib/api/vendors";
import { getConversations } from "@/lib/api/conversations";
import { getBudgetSummary } from "@/lib/api/budget";
import { getVendorOutcomes } from "@/lib/api/vendors";
import {
  negotiateWithProvider,
  requestEngagementApproval,
  confirmProviderEngagement,
} from "@/lib/api/negotiation";

import type { VendorAssignmentResponse, EventResponse, BudgetSummaryResponse } from "@/types/api";
import type { Conversation } from "@/types/communication";

import { EventShell } from "@/components/v2/EventShell";
import {
  QuoteComparisonTable,
} from "@/components/v2/QuoteComparisonTable";
import {
  QuoteEvidenceDrawer,
  QuoteEvidenceItem,
} from "@/components/v2/QuoteEvidenceDrawer";
import { NegotiationCommand } from "@/components/v2/NegotiationCommand";

type TabMode = "COMPARISON" | "NEGOTIATION";

export default function ProcurementPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [activeTab, setActiveTab] = useState<TabMode>("COMPARISON");
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [assignments, setAssignments] = useState<VendorAssignmentResponse[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Selected quote for drawer or negotiation workspace
  const [selectedQuote, setSelectedQuote] = useState<QuoteEvidenceItem | null>(null);
  const [activeNegotiationId, setActiveNegotiationId] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // 1. Load All Procurement Data
  const loadProcurementData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [evRes, assignRes, convRes, budgetRes] = await Promise.allSettled([
        getEvent(eventId),
        getAssignmentsForEvent(eventId),
        getConversations(eventId),
        getBudgetSummary(eventId),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }

      if (assignRes.status === "fulfilled" && Array.isArray(assignRes.value)) {
        setAssignments(assignRes.value);
      }

      if (convRes.status === "fulfilled" && convRes.value?.items) {
        setConversations(convRes.value.items);
      }

      if (budgetRes.status === "fulfilled" && budgetRes.value) {
        setBudgetSummary(budgetRes.value);
      }
    } catch (err) {
      console.error("Failed to load procurement data:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadProcurementData();
  }, [loadProcurementData]);

  // 2. Map Assignments & Conversations into Structured Quote Items
  const quoteItems: QuoteEvidenceItem[] = useMemo(() => {
    return assignments.map((a) => {
      const vendor = a.vendor;
      const matchingConv = conversations.find(
        (c) => c.vendor_id === a.vendor_id || c.vendor_name === vendor?.name
      );

      const latestMsg = matchingConv?.latest_message;
      const facts = latestMsg?.extracted_facts;

      // Authoritative quoted amount
      const quoted = a.quoted_amount ?? facts?.quoted_amount ?? null;

      return {
        assignmentId: a.id,
        vendorId: a.vendor_id,
        vendorName: vendor?.name || "Provider",
        category: a.category || "VENDOR",
        quotedAmount: quoted,
        targetAmount: a.target_amount,
        maxApprovedAmount: a.max_approved_amount,
        currency: a.currency || "INR",
        advanceRequired: a.advance_required,
        availabilityConfirmed: facts?.available ?? (a.status === "CONFIRMED" ? true : null),
        coverageStart: a.coverage_start,
        coverageEnd: a.coverage_end,
        providerCount: a.provider_count,
        negotiationStatus: a.negotiation_status || a.status || "SHORTLISTED",
        negotiationRound: a.negotiation_round,
        verificationStatus: (a as any).verification_status || (facts ? "UNVERIFIED" : null),
        confidence: facts?.confidence || null,
        provenance: (vendor as any)?.source_tag || "LIVE_SCRAPE",
        sourceText: latestMsg?.raw_text || a.notes || null,
        quoteTimestamp: latestMsg?.timestamp || a.updated_at || a.created_at,
        notes: a.notes,
        approvalId: a.approval_id,
        approvalStatus: a.approval_id ? "PENDING" : null,
        raw: vendor,
      };
    });
  }, [assignments, conversations]);

  // Actions from Drawer or Table
  const handleNegotiate = (quote: QuoteEvidenceItem) => {
    setActiveNegotiationId(quote.assignmentId);
    setActiveTab("NEGOTIATION");
    setSelectedQuote(null);
  };

  const handleRequestApproval = async (quote: QuoteEvidenceItem) => {
    try {
      setActionInProgress(quote.assignmentId);
      setStatusMessage(`Requesting formal approval for ${quote.vendorName} quote...`);
      await requestEngagementApproval(quote.assignmentId);
      setStatusMessage(`Approval requested for ${quote.vendorName}.`);
      await loadProcurementData();
    } catch (err: any) {
      console.error("Approval request failed:", err);
      setStatusMessage(err.message || "Failed to submit approval request.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleConfirmQuote = async (quote: QuoteEvidenceItem) => {
    try {
      setActionInProgress(quote.assignmentId);
      setStatusMessage(`Locking and confirming contract with ${quote.vendorName}...`);
      await confirmProviderEngagement(quote.assignmentId);
      setStatusMessage(`Contract confirmed with ${quote.vendorName}.`);
      await loadProcurementData();
    } catch (err: any) {
      console.error("Confirmation failed:", err);
      setStatusMessage(err.message || "Engagement confirmation failed.");
    } finally {
      setActionInProgress(null);
    }
  };

  const curr = eventData?.currency === "INR" || !eventData?.currency ? "₹" : `${eventData?.currency} `;

  return (
    <EventShell eventId={eventId} currentStage="PLAN">
      <div className="space-y-4">
        {/* Top Control Bar & Telemetry Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Procurement & Negotiation Command
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {quoteItems.length} Sourced Quotes
                </span>
              </div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
                Commercial Matrix & Supplier Contracting
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Side-by-side commercial comparison, deterministic counter-offers, and governance-backed contract execution.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Tab Switcher */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold">
                <button
                  onClick={() => {
                    setActiveTab("COMPARISON");
                    setActiveNegotiationId(null);
                  }}
                  className={`px-3 py-1.5 rounded-md transition ${
                    activeTab === "COMPARISON"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Quote Matrix
                </button>
                <button
                  onClick={() => {
                    if (quoteItems.length > 0 && !activeNegotiationId) {
                      setActiveNegotiationId(quoteItems[0].assignmentId);
                    }
                    setActiveTab("NEGOTIATION");
                  }}
                  className={`px-3 py-1.5 rounded-md transition ${
                    activeTab === "NEGOTIATION"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Active Negotiation
                </button>
              </div>

              <button
                onClick={loadProcurementData}
                disabled={loading}
                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                title="Refresh"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Status Alert Banner */}
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

          {/* Event Budget Constraint Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-slate-100 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Event Budget</span>
              <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                {eventData?.total_budget != null ? `${curr}${Number(eventData.total_budget).toLocaleString()}` : "UNSET"}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Committed Spend</span>
              <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                {budgetSummary?.total_actual != null
                  ? `${curr}${Number(budgetSummary.total_actual).toLocaleString()}`
                  : `${curr}0`}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Remaining Budget</span>
              <span className="font-mono font-bold text-emerald-700 text-sm mt-0.5 block">
                {budgetSummary?.remaining != null
                  ? `${curr}${Number(budgetSummary.remaining).toLocaleString()}`
                  : "UNSET"}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Quotes Received</span>
              <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                {quoteItems.filter((q) => q.quotedAmount != null).length} of {quoteItems.length}
              </span>
            </div>
          </div>
        </div>

        {/* View 1: Side-by-Side Comparison Table */}
        {activeTab === "COMPARISON" ? (
          <div>
            <QuoteComparisonTable
              quotes={quoteItems}
              currency={eventData?.currency || "INR"}
              onSelectQuote={(q) => setSelectedQuote(q)}
              onOpenNegotiation={handleNegotiate}
              onRequestApproval={handleRequestApproval}
              onConfirmQuote={handleConfirmQuote}
            />

            {/* Slide-Over Evidence Drawer */}
            <QuoteEvidenceDrawer
              quote={selectedQuote}
              eventId={eventId}
              onClose={() => setSelectedQuote(null)}
              onNegotiate={handleNegotiate}
              onRequestApproval={handleRequestApproval}
              onConfirm={handleConfirmQuote}
              isActionInProgress={actionInProgress === selectedQuote?.assignmentId}
            />
          </div>
        ) : (
          /* View 2: Active Negotiation Command Workspace */
          <div>
            {activeNegotiationId ? (
              <NegotiationCommand
                eventId={eventId}
                assignmentId={activeNegotiationId}
                onBack={() => {
                  setActiveTab("COMPARISON");
                  setActiveNegotiationId(null);
                }}
              />
            ) : (
              <div className="p-16 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="font-semibold text-slate-600">No Active Negotiation Selected</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Select a supplier quote from the Quote Matrix to open the negotiation console.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </EventShell>
  );
}
