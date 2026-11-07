"use client";

/**
 * Pieces of a decision sheet, shared by the approvals queue and the detail page:
 *  - MoneyPanel: amount, vendor, budget impact, advance — money first
 *  - Consequences: what happens on approve / decline, and whether it can be undone
 *  - DecideBy: deadline with a live countdown
 * Everything renders only what the backend provided; unknowns are said out loud.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, Undo2, Ban, Wallet } from "lucide-react";
import { AnimatedNumber } from "@/components/ds/motion";
import { formatMoney, humanizeCategory } from "@/lib/humanize";
import type { DisplayApproval } from "./describe";

const money = (n: number | null | undefined, currency: string) => formatMoney(n ?? null, currency);

export function MoneyPanel({ req }: { req: DisplayApproval }) {
  const { money: m } = req;
  if (!m.involvesMoney && m.amount === null) return null;

  if (m.amount === null) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-standby-300 bg-standby-50 px-4 py-3.5 text-standby-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-standby-600" />
        <div>
          <div className="text-[14px] font-semibold">Amount not provided</div>
          <p className="mt-0.5 text-[13px] leading-snug">
            This decision involves money, but no price came with it. Ask the vendor for a quote before approving.
          </p>
        </div>
      </div>
    );
  }

  const bi = m.budgetImpact;
  const over = !!bi?.overCategoryBudget;
  return (
    <div className={`overflow-hidden rounded-xl border ${over ? "border-cue-300" : "border-ink-200"} bg-[#FDFCFA]`}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-600">
            <Wallet className="h-3.5 w-3.5" /> You&apos;re approving
          </div>
          <div
            className="mt-0.5 font-display text-[34px] font-extrabold leading-none tracking-[-0.02em] text-ink-900"
            style={{ fontStretch: "90%" }}
          >
            <AnimatedNumber value={m.amount} format={(n) => money(Math.round(n), m.currency) ?? ""} />
          </div>
          {(req.subjectName || req.category) && (
            <div className="mt-1 text-[13px] text-ink-600">
              {req.subjectName ? <strong className="font-semibold text-ink-800">{req.subjectName}</strong> : null}
              {req.subjectName && req.category ? " · " : ""}
              {req.category}
            </div>
          )}
        </div>
        {m.advanceRequired !== null && (
          <span
            className={`chip ${
              m.advanceRequired ? "border-standby-200 bg-standby-50 text-standby-800" : "border-ink-200 bg-ink-100 text-ink-700"
            }`}
          >
            {m.advanceRequired ? "Advance payment required" : "No advance required"}
          </span>
        )}
      </div>

      {bi && (bi.committedBefore !== null || bi.committedAfter !== null || bi.categoryBudget !== null) && (
        <div className={`border-t px-4 py-3 ${over ? "border-cue-200 bg-cue-50/60" : "border-ink-200 bg-ink-50/70"}`}>
          <div className="mb-2 text-[12.5px] font-semibold text-ink-700">
            Budget impact{bi.category ? ` · ${humanizeCategory(bi.category)}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-800">
            <span>
              Committed <strong className="tabular-nums">{money(bi.committedBefore, m.currency) ?? "—"}</strong>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-ink-500" />
            <strong className={`tabular-nums ${over ? "text-cue-700" : "text-ink-900"}`}>
              {money(bi.committedAfter, m.currency) ?? "—"}
            </strong>
            {bi.categoryBudget !== null && (
              <span className="text-ink-600">
                of {money(bi.categoryBudget, m.currency)} for {bi.category ? humanizeCategory(bi.category).toLowerCase() : "this category"}
              </span>
            )}
          </div>
          {bi.categoryBudget !== null && bi.committedAfter !== null && (
            <BudgetBar before={bi.committedBefore ?? 0} after={bi.committedAfter} cap={bi.categoryBudget} over={over} />
          )}
          {over && (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-cue-700">
              <AlertTriangle className="h-3.5 w-3.5" /> This goes over the budget for this category.
            </p>
          )}
          {bi.totalBudget !== null && (
            <p className="mt-1 text-[12px] text-ink-600">Total event budget: {money(bi.totalBudget, m.currency)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetBar({ before, after, cap, over }: { before: number; after: number; cap: number; over: boolean }) {
  const scale = Math.max(cap, after, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <div
      className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-ink-200/80"
      role="img"
      aria-label={`Committed would go from ${before} to ${after} of ${cap}`}
    >
      <div className={`absolute inset-y-0 left-0 ${over ? "bg-cue-300" : "bg-go-300"}`} style={{ width: pct(after) }} />
      <div className="absolute inset-y-0 left-0 bg-ink-500" style={{ width: pct(before) }} />
      {after > cap && <div className="absolute inset-y-0 w-0.5 bg-ink-900" style={{ left: pct(cap) }} title="Category budget" />}
    </div>
  );
}

/** What happens next — shown right above the buttons, never hidden. */
export function Consequences({ req }: { req: DisplayApproval }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-go-200 bg-go-50/60 px-3.5 py-3">
        <div className="text-[12px] font-semibold text-go-800">If you approve</div>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-800">{req.onApprove}</p>
      </div>
      <div className="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3">
        <div className="text-[12px] font-semibold text-ink-700">If you decline</div>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-800">
          {req.onReject ?? "Nothing is carried out for this request. It's saved to the history log."}
        </p>
      </div>
      {req.reversible === false && (
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-cue-700 sm:col-span-2">
          <Ban className="h-3.5 w-3.5" /> This can&apos;t be undone once approved.
        </p>
      )}
      {req.reversible === true && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-600 sm:col-span-2">
          <Undo2 className="h-3.5 w-3.5" /> This can be reversed later.
        </p>
      )}
    </div>
  );
}

function remaining(ms: number) {
  if (ms <= 0) return "time's up";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min left`;
  return `${Math.floor(h / 24)} days left`;
}

/** "Decide by 6:00 pm · 2 h 14 min left"; turns amber under 1 h. */
export function DecideBy({ iso, compact = false }: { iso: string | null; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const left = t - now;
  const urgent = left < 60 * 60 * 1000;
  const when = new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${compact ? "text-[11.5px]" : "text-[12.5px]"} font-semibold ${
        urgent ? "text-cue-700" : "text-standby-800"
      }`}
      title={new Date(t).toLocaleString()}
    >
      <Clock className="h-3.5 w-3.5" />
      Decide by {when} · {remaining(left)}
    </span>
  );
}
