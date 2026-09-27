"use client";

import React from "react";
import Link from "next/link";
import {
  DollarSign,
  PieChart,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  Layers,
} from "lucide-react";
import type {
  BudgetSummaryPlan,
  BudgetSummaryResponse,
  BudgetValidationResponse,
} from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface BudgetHealthCardProps {
  planBudget?: BudgetSummaryPlan | null;
  summaryBudget?: BudgetSummaryResponse | null;
  validation?: BudgetValidationResponse | null;
  eventId: string;
  className?: string;
}

export function BudgetHealthCard({
  planBudget,
  summaryBudget,
  validation,
  eventId,
  className = "",
}: BudgetHealthCardProps) {
  // Check if budget data exists from backend
  if (!planBudget && !summaryBudget) {
    return (
      <div className={`p-8 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500 shadow-xs ${className}`}>
        <DollarSign className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-700">Financial Telemetry</p>
        <p className="text-slate-400 mt-1">Budget data unavailable from backend.</p>
      </div>
    );
  }

  // Authoritative values from backend (prefer planBudget, fallback to summaryBudget)
  const totalBudget =
    planBudget?.total_budget ?? summaryBudget?.total_budget ?? null;
  const committedAmount =
    planBudget?.total_committed ?? summaryBudget?.total_actual ?? null;
  const estimatedAmount =
    planBudget?.total_estimated ?? summaryBudget?.total_estimated ?? null;
  const remainingBudget =
    planBudget?.remaining_budget ?? summaryBudget?.remaining ?? null;
  const uncommitted = planBudget?.uncommitted_allocation ?? null;
  const currency = planBudget?.currency || "INR";
  const currSym = currency === "INR" ? "₹" : `${currency} `;

  const isOverBudget =
    planBudget?.is_over_budget ??
    (remainingBudget != null ? Number(remainingBudget) < 0 : false);

  const utilization = planBudget?.utilization_percent ?? null;

  // Category commitments/allocations from backend
  const categoryMap =
    planBudget?.category_commitments || summaryBudget?.categories || {};
  const categoryEntries = Object.entries(categoryMap);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
              <DollarSign className="w-3 h-3 text-[#D6003C]" />
              Budget Engine & Governance
            </span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                isOverBudget
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}
            >
              {isOverBudget ? "OVER BUDGET CEILING" : "WITHIN BUDGET LIMIT"}
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Financial Health & Commitments
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Authoritative spend tracking, contract commitments, and constraint validation.
          </p>
        </div>

        <Link
          href={`/events/${eventId}/procurement`}
          className="text-xs font-semibold text-[#D6003C] hover:underline inline-flex items-center gap-1.5 shrink-0"
        >
          <span>Procurement Matrix</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Primary Financial Metric Tiles */}
      <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Budget */}
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Total Event Budget
          </span>
          <span className="text-lg font-bold font-mono text-slate-900">
            {totalBudget != null ? `${currSym}${Number(totalBudget).toLocaleString()}` : "UNSET"}
          </span>
        </div>

        {/* Committed / Actual */}
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Committed Spend
          </span>
          <span className="text-lg font-bold font-mono text-slate-900">
            {committedAmount != null
              ? `${currSym}${Number(committedAmount).toLocaleString()}`
              : `${currSym}0`}
          </span>
        </div>

        {/* Remaining Budget */}
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Remaining Budget
          </span>
          <span
            className={`text-lg font-bold font-mono ${
              isOverBudget ? "text-rose-600" : "text-emerald-700"
            }`}
          >
            {remainingBudget != null
              ? `${currSym}${Number(remainingBudget).toLocaleString()}`
              : "NOT AVAILABLE"}
          </span>
        </div>

        {/* Utilization */}
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
            Budget Utilization
          </span>
          <span className="text-lg font-bold font-mono text-slate-900">
            {utilization != null ? `${Number(utilization).toFixed(1)}%` : "NOT AVAILABLE"}
          </span>
        </div>
      </div>

      {/* Validation Violations from BudgetValidator */}
      {validation && !validation.is_valid && validation.violations.length > 0 && (
        <div className="mx-5 mb-5 p-3.5 rounded-lg border border-rose-200 bg-rose-50/60 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-rose-800 font-bold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            Budget Ceiling Violations ({validation.violations.length})
          </div>
          <div className="space-y-1">
            {validation.violations.map((v, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-white border border-rose-200 text-rose-900 flex items-center justify-between"
              >
                <div>
                  <span className="font-bold mr-2 uppercase text-[10px] bg-rose-100 px-1 rounded">
                    {v.category}
                  </span>
                  <span>{v.description}</span>
                </div>
                <span className="font-mono font-bold shrink-0 ml-2">
                  {currSym}{v.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Breakdown Table */}
      {categoryEntries.length > 0 && (
        <div className="px-5 pb-5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block mb-2">
            Category Breakdown ({categoryEntries.length})
          </span>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 font-sans">
                  <th className="p-2.5 pl-3">Category</th>
                  <th className="p-2.5 text-right pr-3">Committed / Allocated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {categoryEntries.map(([catName, amount]) => (
                  <tr key={catName} className="hover:bg-slate-50/50">
                    <td className="p-2.5 pl-3 font-sans font-medium text-slate-900">
                      {catName}
                    </td>
                    <td className="p-2.5 text-right pr-3 font-semibold text-slate-900">
                      {currSym}{Number(amount).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
