"use client";

import React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Wallet, ShieldAlert, ArrowUpRight } from "lucide-react";
import type { BudgetSummaryPlan, BudgetSummaryResponse, BudgetValidationResponse } from "@/types/api";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { AnimatedNumber, StaggerList } from "@/components/ds/motion";
import { humanizeCategory } from "@/lib/humanize";

interface BudgetHealthCardProps {
  planBudget?: BudgetSummaryPlan | null;
  summaryBudget?: BudgetSummaryResponse | null;
  validation?: BudgetValidationResponse | null;
  eventId: string;
  className?: string;
  /** "compact" = summary used inside the plan blueprint; "full" = the Budget page */
  variant?: "compact" | "full";
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Animated fill bar; starts from 0 so changes are visible. */
function Fill({ pct, over }: { pct: number; over: boolean }) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-ink-200/70" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
      <motion.div
        className={`h-full rounded-full ${over ? "bg-cue-600" : clamped > 85 ? "bg-standby-500" : "bg-go-500"}`}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}
      />
    </div>
  );
}

export function BudgetHealthCard({
  planBudget,
  summaryBudget,
  validation,
  eventId,
  className = "",
  variant = "full",
}: BudgetHealthCardProps) {
  if (!planBudget && !summaryBudget) {
    return (
      <div className={`rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 p-8 text-center ${className}`}>
        <Wallet className="mx-auto mb-2 h-6 w-6 text-ink-300" />
        <p className="text-[13.5px] font-semibold text-ink-800">No budget figures yet</p>
        <p className="mt-1 text-[12.5px] text-ink-500">The budget engine hasn&apos;t returned any numbers for this event.</p>
      </div>
    );
  }

  // Authoritative values from backend (prefer planBudget, fallback to summaryBudget)
  const totalBudget = num(planBudget?.total_budget ?? summaryBudget?.total_budget ?? null);
  const committedAmount = num(planBudget?.total_committed ?? summaryBudget?.total_actual ?? null);
  const estimatedAmount = num(planBudget?.total_estimated ?? summaryBudget?.total_estimated ?? null);
  const remainingBudget = num(planBudget?.remaining_budget ?? summaryBudget?.remaining ?? null);
  const currency = planBudget?.currency || "INR";
  const currSym = currency === "INR" ? "₹" : `${currency} `;
  const money = (n: number) => `${currSym}${Math.round(n).toLocaleString(currency === "INR" ? "en-IN" : undefined)}`;

  const isOverBudget = planBudget?.is_over_budget ?? (remainingBudget != null ? remainingBudget < 0 : false);
  const utilization = num(planBudget?.utilization_percent ?? null);

  const categoryMap = planBudget?.category_commitments || summaryBudget?.categories || {};
  const categoryEntries = Object.entries(categoryMap)
    .map(([cat, amount]) => [cat, num(amount) ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const maxCat = categoryEntries.reduce((m, [, v]) => Math.max(m, v), 0);

  const violations = validation && !validation.is_valid ? validation.violations : [];

  const tiles = [
    { label: "Total budget", value: totalBudget, tone: "text-ink-900" },
    { label: "Committed", value: committedAmount, tone: "text-ink-900" },
    { label: "Remaining", value: remainingBudget, tone: isOverBudget ? "text-cue-600" : "text-go-700" },
    ...(variant === "full" ? [{ label: "Estimated", value: estimatedAmount, tone: "text-ink-700" }] : []),
  ];

  return (
    <section className={`surface overflow-hidden ${className}`}>
      {/* Header */}
      <header className="flex flex-col justify-between gap-3 border-b border-ink-200 px-5 py-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="eyebrow">Budget</span>
            <ProvenanceBadge provenance="ENGINE" size="sm" />
            <span
              className={`chip ${
                isOverBudget ? "border-cue-200 bg-cue-50 text-cue-700" : "border-go-200 bg-go-50 text-go-700"
              }`}
            >
              <span className={`cue-light ${isOverBudget ? "bg-cue-600 animate-cue-blink" : "bg-go-500"}`} />
              {isOverBudget ? "Over budget" : "Within budget"}
            </span>
          </div>
          <h3 className="text-[15px] font-semibold text-ink-900">
            {variant === "full" ? "Where the money stands" : "Money so far"}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            Committed spend comes from confirmed bookings; remaining is what&apos;s left of your budget.
          </p>
        </div>
        <Link
          href={`/events/${eventId}/procurement`}
          className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-ink-700 hover:text-cue-700"
        >
          Compare quotes <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* Usage meter */}
      <div className="space-y-2 px-5 pt-4">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span className="text-ink-600">
            {committedAmount != null && totalBudget != null ? (
              <>
                <span className="font-semibold text-ink-900">{money(committedAmount)}</span> of {money(totalBudget)} committed
              </>
            ) : (
              "Commitments not reported"
            )}
          </span>
          <span className="font-mono text-[12px] font-semibold text-ink-700">
            {utilization != null ? (
              <AnimatedNumber value={utilization} format={(n) => `${n.toFixed(1)}%`} />
            ) : (
              "—"
            )}
          </span>
        </div>
        <Fill pct={utilization ?? 0} over={isOverBudget} />
      </div>

      {/* Figures */}
      <div className={`grid gap-3 p-5 ${variant === "full" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-ink-200 bg-ink-50/50 px-3.5 py-3">
            <div className="eyebrow">{t.label}</div>
            <div
              className={`mt-1 font-display text-[22px] font-bold leading-none tabular-nums ${t.tone}`}
              style={{ fontStretch: "90%" }}
            >
              {t.value != null ? <AnimatedNumber value={t.value} format={(n) => money(n)} /> : <span className="text-ink-400">—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Violations */}
      {violations.length > 0 && (
        <div className="mx-5 mb-5 space-y-2 rounded-lg border border-cue-200 bg-cue-50/50 p-3.5">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-cue-800">
            <ShieldAlert className="h-4 w-4 text-cue-600" />
            {violations.length === 1 ? "1 budget limit broken" : `${violations.length} budget limits broken`}
          </div>
          <ul className="space-y-1.5">
            {violations.map((v, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-3 rounded-md border border-cue-200 bg-[#FDFCFA] px-3 py-2 text-[12.5px] text-cue-900"
              >
                <span>
                  <span className="mr-2 font-semibold">{humanizeCategory(v.category)}</span>
                  {v.description}
                </span>
                <span className="shrink-0 font-mono font-semibold">{money(Number(v.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Category breakdown */}
      {categoryEntries.length > 0 && (
        <div className="px-5 pb-5">
          <div className="eyebrow mb-2">By category</div>
          <StaggerList className="space-y-2">
            {categoryEntries.map(([catName, amount]) => (
              <div key={catName} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[12.5px] sm:grid-cols-[160px_1fr_auto]">
                <span className="truncate font-semibold text-ink-800">{humanizeCategory(catName)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-ink-200/70">
                  <span
                    className="block h-full rounded-full bg-ink-700"
                    style={{ width: `${maxCat > 0 ? Math.max(2, (amount / maxCat) * 100) : 0}%` }}
                  />
                </span>
                <span className="font-mono font-semibold text-ink-900">{money(amount)}</span>
              </div>
            ))}
          </StaggerList>
        </div>
      )}
    </section>
  );
}
