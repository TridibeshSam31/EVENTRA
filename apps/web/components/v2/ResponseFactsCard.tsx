"use client";

import React from "react";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  DollarSign,
  CalendarCheck,
  FileText,
  ShieldCheck,
  Clock,
  Layers,
} from "lucide-react";
import type { ExtractedFacts } from "@/types/communication";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface ResponseFactsCardProps {
  facts?: ExtractedFacts | null;
  vendorName?: string | null;
  timestamp?: string | null;
  verificationStatus?: string | null;
  provenance?: string | null;
  advanceRequired?: boolean | null;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  className?: string;
}

export function ResponseFactsCard({
  facts,
  vendorName,
  timestamp,
  verificationStatus,
  provenance,
  advanceRequired,
  coverageStart,
  coverageEnd,
  className = "",
}: ResponseFactsCardProps) {
  if (!facts || Object.keys(facts).length === 0) {
    return (
      <div className={`p-4 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-400 ${className}`}>
        <HelpCircle className="w-5 h-5 mx-auto mb-1 text-slate-300" />
        <p className="font-semibold text-slate-600">No Structured Response Facts</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Provider has not sent an inbound reply with interpretable terms yet.
        </p>
      </div>
    );
  }

  const confidencePct =
    facts.confidence != null ? Math.round(facts.confidence * 100) : null;

  const isLowConfidence = confidencePct != null && confidencePct < 70;

  // Verification status normalized
  const normVerification = verificationStatus
    ? verificationStatus.toUpperCase().trim()
    : null;

  return (
    <div
      className={`p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3 ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#D6003C]" />
              Agent Extracted Facts
            </span>
            {provenance && <ProvenanceBadge source={provenance} size="sm" />}
          </div>
          <h4 className="text-xs font-bold text-slate-900 mt-0.5">
            {vendorName || "Provider"} Response Terms
          </h4>
        </div>

        {/* Verification and Confidence Badges */}
        <div className="flex flex-col items-end gap-1">
          {confidencePct != null ? (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 ${
                isLowConfidence
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}
            >
              {isLowConfidence && <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />}
              <span>{confidencePct}% Confidence</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-500 border border-slate-200">
              Confidence UNKNOWN
            </span>
          )}

          {normVerification ? (
            <span
              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                normVerification === "VERIFIED"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : normVerification === "UNVERIFIED"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
            >
              {normVerification}
            </span>
          ) : (
            <span className="text-[9px] font-medium text-slate-400">
              Verification unavailable
            </span>
          )}
        </div>
      </div>

      {/* Grid of Verified / Extracted Fields */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Availability */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
          <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
            <CalendarCheck className="w-3 h-3" />
            Availability
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            {facts.available === true ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-bold text-emerald-700 text-xs">Available</span>
              </>
            ) : facts.available === false ? (
              <>
                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                <span className="font-bold text-rose-700 text-xs">Unavailable</span>
              </>
            ) : (
              <span className="font-bold text-slate-500 text-xs">UNKNOWN</span>
            )}
          </div>
        </div>

        {/* Quoted Price */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
          <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            Quoted Quote
          </span>
          <div className="mt-1">
            {facts.quoted_amount != null ? (
              <span className="font-bold text-slate-900 text-xs font-mono">
                {facts.currency === "INR" || !facts.currency ? "₹" : `${facts.currency} `}
                {Number(facts.quoted_amount).toLocaleString()}
              </span>
            ) : (
              <span className="font-bold text-slate-500 text-xs">UNKNOWN</span>
            )}
          </div>
        </div>

        {/* Advance Required */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            Advance Payment
          </span>
          <div className="mt-1">
            {advanceRequired === true ? (
              <span className="font-semibold text-amber-700 text-xs">Required</span>
            ) : advanceRequired === false ? (
              <span className="font-semibold text-emerald-700 text-xs">No Advance</span>
            ) : (
              <span className="font-semibold text-slate-500 text-xs">UNKNOWN</span>
            )}
          </div>
        </div>

        {/* Coverage Window */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
          <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Coverage Window
          </span>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-700">
            {coverageStart || coverageEnd
              ? `${coverageStart || "TBD"} – ${coverageEnd || "TBD"}`
              : "UNKNOWN"}
          </div>
        </div>
      </div>

      {/* Notes / Special Terms */}
      {facts.notes ? (
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
            <FileText className="w-3 h-3" />
            Extracted Conditions
          </span>
          <p className="text-[11px] text-slate-700 font-medium leading-relaxed">
            "{facts.notes}"
          </p>
        </div>
      ) : (
        <div className="text-[10px] text-slate-400 px-1">
          Conditions / Notes: UNKNOWN
        </div>
      )}

      {/* Field Sources / Provenance */}
      {facts.field_sources && Object.keys(facts.field_sources).length > 0 && (
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
          <span className="font-medium text-slate-400">Sources:</span>
          {Object.entries(facts.field_sources).map(([field, src]) => (
            <span
              key={field}
              className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[9px]"
            >
              {field}: {src}
            </span>
          ))}
        </div>
      )}

      {timestamp && (
        <div className="text-[10px] text-slate-400 text-right font-mono">
          Extracted {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}
