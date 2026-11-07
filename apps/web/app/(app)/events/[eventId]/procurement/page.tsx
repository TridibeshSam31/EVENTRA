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
import { PageHeader, Segmented, EmptyState, Meter } from "@/components/ds";

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

  const totalBudget = eventData?.total_budget != null ? Number(eventData.total_budget) : null;
  const committed = budgetSummary?.total_actual != null ? Number(budgetSummary.total_actual) : 0;
  const remaining = budgetSummary?.remaining != null ? Number(budgetSummary.remaining) : null;
  const quotedCount = quoteItems.filter((q) => q.quotedAmount != null).length;
  const usedPct = totalBudget ? Math.min(100, (committed / totalBudget) * 100) : 0;

  return (
    <EventShell eventId={eventId} currentStage="PLAN">
      <div className="space-y-5">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              Prepare <span className="text-ink-300">/</span> Procurement
            </span>
          }
          title="Quotes & contracts"
          description="Compare what vendors quoted, negotiate within your limits, then request approval to book."
          actions={
            <>
              <Segmented<TabMode>
                value={activeTab}
                onChange={(v) => {
                  if (v === "COMPARISON") {
                    setActiveTab("COMPARISON");
                    setActiveNegotiationId(null);
                  } else {
                    if (quoteItems.length > 0 && !activeNegotiationId) {
                      setActiveNegotiationId(quoteItems[0].assignmentId);
                    }
                    setActiveTab("NEGOTIATION");
                  }
                }}
                options={[
                  { value: "COMPARISON", label: "Compare quotes", count: quoteItems.length },
                  { value: "NEGOTIATION", label: "Negotiate" },
                ]}
              />
              <button onClick={loadProcurementData} disabled={loading} className="btn-secondary !px-2.5" title="Refresh" aria-label="Refresh">
                <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </>
          }
        />

        {statusMessage && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-info-200 bg-info-50 px-4 py-2.5 text-[13px] text-info-900">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="text-[12px] font-semibold text-info-700 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Budget strip */}
        <section className="surface overflow-hidden">
          <div className="grid grid-cols-2 divide-ink-200 md:grid-cols-4 md:divide-x">
            <Figure label="Event budget" value={totalBudget != null ? `${curr}${totalBudget.toLocaleString()}` : "Not set"} muted={totalBudget == null} />
            <Figure label="Committed" value={`${curr}${committed.toLocaleString()}`} />
            <Figure
              label="Remaining"
              value={remaining != null ? `${curr}${remaining.toLocaleString()}` : "Not set"}
              tone={remaining != null ? (remaining < 0 ? "text-cue-700" : "text-go-700") : undefined}
              muted={remaining == null}
            />
            <Figure label="Quotes in" value={`${quotedCount} / ${quoteItems.length}`} />
          </div>
          {totalBudget ? (
            <div className="border-t border-ink-200 px-5 py-3">
              <div className="flex items-center justify-between font-mono text-[10.5px] text-ink-500">
                <span>budget used</span>
                <span>{Math.round(usedPct)}%</span>
              </div>
              <Meter value={usedPct} tone={usedPct > 90 ? "cue" : usedPct > 70 ? "standby" : "ink"} className="mt-1.5" label="Budget used" />
            </div>
          ) : null}
        </section>

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
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No negotiation selected"
                description="Pick a vendor's quote in Compare quotes to open its negotiation."
              />
            )}
          </div>
        )}
      </div>
    </EventShell>
  );
}

function Figure({ label, value, tone, muted }: { label: string; value: string; tone?: string; muted?: boolean }) {
  return (
    <div className="px-5 py-3.5 [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-ink-200 md:[&:nth-child(n+3)]:border-t-0">
      <div className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">{label}</div>
      <div
        className={`mt-1 font-display text-[22px] font-bold tabular-nums ${muted ? "text-ink-400" : tone || "text-ink-900"}`}
        style={{ fontStretch: "90%" }}
      >
        {value}
      </div>
    </div>
  );
}
