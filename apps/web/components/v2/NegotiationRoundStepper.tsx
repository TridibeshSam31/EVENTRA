"use client";

import React from "react";
import {
  MessageSquare,
  Bot,
  User,
  ArrowDown,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  DollarSign,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface NegotiationRoundItem {
  round_number: number;
  actor: "PROVIDER" | "AGENT" | "OPERATOR" | "SYSTEM";
  actor_name?: string;
  timestamp: string;
  offered_amount?: number | null;
  currency?: string;
  message_text?: string;
  state?: string;
  outcome?: string;
  provenance?: string;
  source_evidence?: string;
}

interface NegotiationRoundStepperProps {
  rounds: NegotiationRoundItem[];
  currentRound?: number | string | null;
  targetAmount?: number | null;
  maxApprovedAmount?: number | null;
  currency?: string;
  className?: string;
}

export function NegotiationRoundStepper({
  rounds,
  currentRound,
  targetAmount,
  maxApprovedAmount,
  currency = "INR",
  className = "",
}: NegotiationRoundStepperProps) {
  if (!rounds || rounds.length === 0) {
    return (
      <div className={`p-6 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-400 ${className}`}>
        <Clock className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-600">Negotiation has not started</p>
        <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
          No counter-offers or structured negotiation rounds have been exchanged with this provider yet.
        </p>
      </div>
    );
  }

  const curr = currency === "INR" ? "₹" : `${currency} `;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header telemetry if targets exist */}
      {(targetAmount != null || maxApprovedAmount != null) && (
        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Rate</span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {targetAmount != null ? `${curr}${Number(targetAmount).toLocaleString()}` : "UNSET"}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Max Approved Ceiling</span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {maxApprovedAmount != null ? `${curr}${Number(maxApprovedAmount).toLocaleString()}` : "UNSET"}
            </span>
          </div>
        </div>
      )}

      {/* Vertical Stepper Timeline */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
        {rounds.map((round, idx) => {
          const isAgent = round.actor === "AGENT";
          const isProvider = round.actor === "PROVIDER";
          const isLast = idx === rounds.length - 1;

          return (
            <div key={idx} className="relative">
              {/* Timeline Node Dot */}
              <div
                className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white ${
                  isLast
                    ? "border-[#D6003C] text-[#D6003C]"
                    : "border-slate-300 text-slate-400"
                }`}
              >
                <span className="text-[9px] font-mono font-bold">{round.round_number}</span>
              </div>

              {/* Card Surface */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
                {/* Round Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                      Round {round.round_number}
                    </span>

                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                      {isAgent ? (
                        <>
                          <Bot className="w-3.5 h-3.5 text-[#D6003C]" />
                          <span>EVENTRA Agent</span>
                        </>
                      ) : isProvider ? (
                        <>
                          <User className="w-3.5 h-3.5 text-slate-600" />
                          <span>{round.actor_name || "Provider"}</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{round.actor_name || "Operator"}</span>
                        </>
                      )}
                    </span>

                    {round.provenance && (
                      <ProvenanceBadge source={round.provenance} size="sm" />
                    )}
                  </div>

                  <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                    {new Date(round.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Offer / Counter Value */}
                {round.offered_amount != null && (
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="text-xs text-slate-500">Proposal:</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {curr}{Number(round.offered_amount).toLocaleString()}
                    </span>
                    {round.state && (
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {round.state}
                      </span>
                    )}
                  </div>
                )}

                {/* Message Body */}
                {round.message_text && (
                  <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 italic leading-relaxed whitespace-pre-wrap">
                    "{round.message_text}"
                  </p>
                )}

                {/* Source Evidence Reference */}
                {round.source_evidence && (
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 pt-1">
                    <MessageSquare className="w-3 h-3 text-slate-400" />
                    <span>Evidence: {round.source_evidence}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
