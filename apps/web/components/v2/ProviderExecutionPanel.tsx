"use client";

import React from "react";
import Link from "next/link";
import {
  Users,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import type { ProviderOperationalSummary } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface ProviderExecutionPanelProps {
  eventId: string;
  providerSummary?: ProviderOperationalSummary | null;
  className?: string;
}

export function ProviderExecutionPanel({
  eventId,
  providerSummary,
  className = "",
}: ProviderExecutionPanelProps) {
  if (!providerSummary || providerSummary.assignments.length === 0) {
    return (
      <div className={`p-8 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <Building2 className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-700">Provider Operational State</p>
        <p className="text-slate-400 mt-1">Provider execution state unavailable from backend.</p>
      </div>
    );
  }

  const {
    total_assignments,
    confirmed_count,
    in_negotiation_count,
    awaiting_approval_count,
    total_committed_cost,
    assignments,
  } = providerSummary;

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <Building2 className="w-3 h-3 text-[#D6003C]" />
              Supplier & Provider State
            </span>
            <ProvenanceBadge source="SOURCE" size="sm" />
            <span className="text-[10px] font-mono text-slate-400">
              {total_assignments} Assigned Suppliers
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Live Provider Execution & Commitments
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Confirmed supplier contracts, ongoing negotiations, and pending approvals.
          </p>
        </div>

        <Link
          href={`/events/${eventId}/procurement`}
          className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1.5 shrink-0"
        >
          <span>Procurement Workspace</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Telemetry Counters Strip */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100 bg-white text-xs">
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
            Confirmed Providers
          </span>
          <span className="text-base font-bold font-mono text-emerald-700">
            {confirmed_count} of {total_assignments}
          </span>
        </div>

        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
            In Negotiation
          </span>
          <span className="text-base font-bold font-mono text-blue-800">
            {in_negotiation_count}
          </span>
        </div>

        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
            Awaiting Approval
          </span>
          <span
            className={`text-base font-bold font-mono ${
              awaiting_approval_count > 0 ? "text-amber-700" : "text-slate-700"
            }`}
          >
            {awaiting_approval_count}
          </span>
        </div>

        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
            Committed Spend
          </span>
          <span className="text-base font-bold font-mono text-slate-900">
            ₹{total_committed_cost.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Providers Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <th className="p-3 pl-5">Supplier</th>
              <th className="p-3">Category</th>
              <th className="p-3">Negotiation Status</th>
              <th className="p-3">Assignment Status</th>
              <th className="p-3 text-right pr-5">Agreed / Quoted Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
            {assignments.map((item) => {
              const isConfirmed =
                item.negotiation_status === "CONFIRMED" || item.status === "CONFIRMED";
              const isAwaitingApproval =
                item.negotiation_status === "AWAITING_APPROVAL";

              return (
                <tr key={item.assignment_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3 pl-5 font-sans font-medium text-slate-900">
                    <div className="flex items-center gap-1.5">
                      <span>{item.vendor_name}</span>
                      {item.is_simulation && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-500">
                          Sandbox
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 block">
                      {item.vendor_id}
                    </span>
                  </td>

                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                      {item.category}
                    </span>
                  </td>

                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        isConfirmed
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : isAwaitingApproval
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}
                    >
                      {item.negotiation_status || "CONTACTED"}
                    </span>
                  </td>

                  <td className="p-3">
                    <span className="text-slate-600 font-sans">{item.status}</span>
                  </td>

                  <td className="p-3 pr-5 text-right font-semibold text-slate-900">
                    {item.agreed_cost != null
                      ? `₹${Number(item.agreed_cost).toLocaleString()}`
                      : item.quoted_amount != null
                      ? `₹${Number(item.quoted_amount).toLocaleString()} (Quoted)`
                      : "TBD"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
