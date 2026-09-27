"use client";

import React from "react";
import Link from "next/link";
import {
  X,
  Building2,
  DollarSign,
  CalendarCheck,
  FileText,
  ShieldCheck,
  Clock,
  Sparkles,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Users,
} from "lucide-react";

import type { VendorAssignmentResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface QuoteEvidenceItem {
  assignmentId: string;
  vendorId: string;
  vendorName: string;
  category: string;
  quotedAmount?: number | null;
  targetAmount?: number | null;
  maxApprovedAmount?: number | null;
  currency: string;
  advanceRequired?: boolean | null;
  availabilityConfirmed?: boolean | null;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  providerCount?: number | null;
  negotiationStatus: string;
  negotiationRound?: string | number | null;
  verificationStatus?: string | null;
  confidence?: number | null;
  provenance: string;
  sourceText?: string | null;
  quoteTimestamp?: string | null;
  notes?: string | null;
  approvalId?: string | null;
  approvalStatus?: string | null;
  raw?: any;
}

interface QuoteEvidenceDrawerProps {
  quote: QuoteEvidenceItem | null;
  eventId: string;
  onClose: () => void;
  onNegotiate?: (quote: QuoteEvidenceItem) => void;
  onRequestApproval?: (quote: QuoteEvidenceItem) => void;
  onConfirm?: (quote: QuoteEvidenceItem) => void;
  isActionInProgress?: boolean;
}

export function QuoteEvidenceDrawer({
  quote,
  eventId,
  onClose,
  onNegotiate,
  onRequestApproval,
  onConfirm,
  isActionInProgress = false,
}: QuoteEvidenceDrawerProps) {
  if (!quote) return null;

  const curr = quote.currency === "INR" || !quote.currency ? "₹" : `${quote.currency} `;
  const hasApproval = Boolean(quote.approvalId);
  const isApproved = quote.approvalStatus === "APPROVED";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-start justify-between bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {quote.category} Quote
              </span>
              <ProvenanceBadge source={quote.provenance} size="sm" />
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 font-semibold">
                {quote.negotiationStatus}
              </span>
            </div>

            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              {quote.vendorName}
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Assignment #{quote.assignmentId.slice(0, 8)}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-xs text-slate-700 divide-y divide-slate-100">
          {/* SECTION 1: QUOTE & COMMERCIAL TERMS */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Commercial Terms
            </span>

            <div className="grid grid-cols-2 gap-3">
              {/* Quoted Price */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                  Quoted Amount
                </span>
                <span className="text-base font-mono font-bold text-slate-900 mt-0.5 block">
                  {quote.quotedAmount != null
                    ? `${curr}${Number(quote.quotedAmount).toLocaleString()}`
                    : "UNKNOWN"}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Target: {quote.targetAmount != null ? `${curr}${Number(quote.targetAmount).toLocaleString()}` : "UNSET"}
                </span>
              </div>

              {/* Advance Requirement */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                  Advance Payment
                </span>
                <span className="text-sm font-semibold text-slate-900 mt-1 block">
                  {quote.advanceRequired === true
                    ? "Advance Required"
                    : quote.advanceRequired === false
                    ? "No Advance Required"
                    : "UNKNOWN"}
                </span>
                <span className="text-[10px] text-slate-400">
                  Ceiling: {quote.maxApprovedAmount != null ? `${curr}${Number(quote.maxApprovedAmount).toLocaleString()}` : "UNSET"}
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 2: OPERATIONAL CAPACITY & AVAILABILITY */}
          <div className="space-y-3 pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Operational Scope & Availability
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                  Availability Confirmation
                </span>
                <div className="mt-1 flex items-center gap-1.5 font-semibold">
                  {quote.availabilityConfirmed === true ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Confirmed Available</span>
                    </>
                  ) : quote.availabilityConfirmed === false ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span className="text-rose-700">Unavailable</span>
                    </>
                  ) : (
                    <span className="text-slate-500">UNKNOWN</span>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                  Coverage Window
                </span>
                <span className="text-xs font-mono font-semibold text-slate-900 mt-1 block">
                  {quote.coverageStart || quote.coverageEnd
                    ? `${quote.coverageStart || "TBD"} – ${quote.coverageEnd || "TBD"}`
                    : "UNKNOWN"}
                </span>
                <span className="text-[10px] text-slate-400">
                  Staff Count: {quote.providerCount != null ? `${quote.providerCount} personnel` : "UNKNOWN"}
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 3: SOURCE EVIDENCE & EXTRACTION AUDIT */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Evidence & Verification Audit
              </span>
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border bg-slate-100 border-slate-200 text-slate-600">
                {quote.verificationStatus || "Verification unavailable"}
              </span>
            </div>

            {quote.sourceText ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  Originating Inbound Message
                </span>
                <p className="text-xs text-slate-800 italic leading-relaxed whitespace-pre-wrap">
                  "{quote.sourceText}"
                </p>
                {quote.quoteTimestamp && (
                  <span className="text-[10px] text-slate-400 font-mono block text-right">
                    Received {new Date(quote.quoteTimestamp).toLocaleString()}
                  </span>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-center">
                Direct quote message transcript unavailable.
              </div>
            )}

            {quote.confidence != null && (
              <div className="flex items-center justify-between px-2 text-[11px] text-slate-500">
                <span>Extraction Confidence:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {Math.round(quote.confidence * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* SECTION 4: APPROVAL AUDIT & COMPLIANCE */}
          <div className="space-y-3 pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Governance & Approval Status
            </span>

            {hasApproval ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-800 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    Approval Request Linked
                  </span>
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-700">
                    {quote.approvalStatus || "PENDING"}
                  </span>
                </div>
                <p className="text-[11px] text-amber-700">
                  Contract execution strictly gated by formal human sign-off.
                </p>
                <Link
                  href={`/events/${eventId}/approvals`}
                  className="inline-block text-[11px] font-semibold text-[#D6003C] hover:underline mt-1"
                >
                  Inspect Approval Ticket #{quote.approvalId?.slice(0, 8)} &rarr;
                </Link>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 space-y-1">
                <span className="font-semibold text-slate-700 block">No Formal Approval Requested</span>
                <p className="text-[11px] text-slate-400">
                  Click 'Request Approval' below to submit this quote to the event manager for sign-off.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-white space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {/* Counter-Offer / Negotiate */}
            <button
              onClick={() => onNegotiate && onNegotiate(quote)}
              disabled={isActionInProgress}
              className="py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              <span>Send Counter-Offer</span>
            </button>

            {/* Request Approval */}
            <button
              onClick={() => onRequestApproval && onRequestApproval(quote)}
              disabled={isActionInProgress || hasApproval}
              className="py-2 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
              <span>{hasApproval ? "Approval Submitted" : "Request Approval"}</span>
            </button>
          </div>

          {/* Confirm / Bind Engagement */}
          <button
            onClick={() => onConfirm && onConfirm(quote)}
            disabled={isActionInProgress || !isApproved}
            className="w-full py-2.5 px-4 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={!isApproved ? "Human approval is required before confirmation" : undefined}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              {!isApproved ? "Confirm Engagement (Approval Required)" : "Confirm & Contract Provider"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
