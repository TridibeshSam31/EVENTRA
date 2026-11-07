"use client";

/**
 * QuoteBoard — compare vendor quotes per category and take the one next step.
 *
 * Data: GET /events/{id}/quotes (UX v3 §4), falling back to vendor assignments.
 * Actions use existing endpoints only:
 *   quoted, not yet approved  → Request booking   (POST /vendors/assignments/{id}/request-approval)
 *   waiting for approval      → open the decision (Approvals)
 *   approved                  → Confirm booking   (POST /vendors/assignments/{id}/confirm)
 * Nothing here is estimated: unknown values show as "—" or "not given".
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { EmptyState, CueChip, type CueTone } from "@/components/ds";
import { PopCard, StaggerList, Toast, AnimatedNumber } from "@/components/ds/motion";
import { getEventQuotes, type QuoteItem, type QuotesResponse } from "@/lib/api/quotes";
import { requestEngagementApproval, confirmProviderEngagement } from "@/lib/api/negotiation";
import { formatMoney, humanizeCategory, clockTime } from "@/lib/humanize";
import { JOURNEY_LABEL, JOURNEY_HELP } from "@/lib/journey";

type QuoteState =
  | "booked"
  | "approved"
  | "awaiting_approval"
  | "quoted"
  | "negotiating"
  | "no_reply"
  | "requested"
  | "declined"
  | "not_requested";

const STATE: Record<QuoteState, { label: string; tone: CueTone; order: number }> = {
  booked: { label: "Booked", tone: "go", order: 0 },
  approved: { label: "Approved — confirm booking", tone: "go", order: 1 },
  awaiting_approval: { label: "Waiting for your approval", tone: "standby", order: 2 },
  quoted: { label: "Quote received", tone: "info", order: 3 },
  negotiating: { label: "Negotiating", tone: "agent", order: 4 },
  no_reply: { label: "No reply", tone: "standby", order: 5 },
  requested: { label: "Quote requested", tone: "idle", order: 6 },
  not_requested: { label: "Not contacted yet", tone: "idle", order: 7 },
  declined: { label: "Declined", tone: "idle", order: 8 },
};

export function quoteState(q: QuoteItem): QuoteState {
  const s = (q.status || "").toUpperCase();
  if (["CONFIRMED", "CONTRACTED", "BOOKED", "COMPLETED"].includes(s)) return "booked";
  if (s === "APPROVED") return "approved";
  if (["AWAITING_APPROVAL", "PENDING_APPROVAL", "APPROVAL_REQUESTED"].includes(s)) return "awaiting_approval";
  if (["DECLINED", "REJECTED", "CANCELLED", "CANCELED", "UNAVAILABLE"].includes(s)) return "declined";
  if (["NO_RESPONSE", "NO_REPLY", "TIMED_OUT"].includes(s)) return "no_reply";
  if (["NEGOTIATING", "COUNTER_OFFERED", "COUNTERED"].includes(s)) return q.quoted_amount !== null ? "negotiating" : "requested";
  if (q.quoted_amount !== null || s === "QUOTED") return "quoted";
  if (["ENGAGED", "CONTACTED", "OUTREACH", "QUOTE_REQUESTED", "AWAITING_RESPONSE", "IN_PROGRESS"].includes(s)) return "requested";
  return "not_requested";
}

function coverage(q: QuoteItem): string | null {
  const a = clockTime(q.coverage_start);
  const b = clockTime(q.coverage_end);
  if (a && b) return `${a} – ${b}`;
  return a || b || null;
}

const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? "—" : v ? yes : no);

export function QuoteBoard({ eventId, className = "" }: { eventId: string; className?: string }) {
  const [data, setData] = useState<QuotesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<QuoteItem | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "go" | "cue" | "ink" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getEventQuotes(eventId));
    } catch (err: any) {
      setError(/fetch|network/i.test(err?.message || "") ? "EVENTRA's server isn't reachable right now." : err?.message || "Couldn't load quotes.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, QuoteItem[]>();
    for (const q of data?.items || []) {
      const key = (q.category || "OTHER").toUpperCase();
      map.set(key, [...(map.get(key) || []), q]);
    }
    return Array.from(map.entries())
      .map(([category, items]) => ({
        category,
        items: [...items].sort((a, b) => {
          const d = STATE[quoteState(a)].order - STATE[quoteState(b)].order;
          if (d !== 0) return d;
          return (a.quoted_amount ?? Infinity) - (b.quoted_amount ?? Infinity);
        }),
        summary: data?.by_category?.[category] ?? data?.by_category?.[category.toLowerCase()] ?? null,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [data]);

  const quotedCount = (data?.items || []).filter((q) => q.quoted_amount !== null).length;

  // The first "Request booking" on the board is the step the guide points at.
  const guideTarget = useMemo(() => {
    for (const g of groups) for (const q of g.items) if (quoteState(q) === "quoted" && q.within_cap !== false) return q.assignment_id;
    for (const g of groups) for (const q of g.items) if (quoteState(q) === "quoted") return q.assignment_id;
    return null;
  }, [groups]);

  const requestBooking = async (q: QuoteItem) => {
    setBusy(q.assignment_id);
    try {
      await requestEngagementApproval(q.assignment_id);
      setToast({ msg: `Booking request for ${q.vendor_name || "this vendor"} sent to Decisions`, tone: "go" });
      await load();
    } catch (err: any) {
      setToast({ msg: err?.message || "Couldn't request the booking. Please try again.", tone: "cue" });
    } finally {
      setBusy(null);
    }
  };

  const confirmBooking = async (q: QuoteItem) => {
    setConfirming(null);
    setBusy(q.assignment_id);
    try {
      await confirmProviderEngagement(q.assignment_id);
      setToast({ msg: `${q.vendor_name || "Vendor"} booked`, tone: "go" });
      await load();
    } catch (err: any) {
      setToast({ msg: err?.message || "Couldn't confirm the booking. Please try again.", tone: "cue" });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[0, 1].map((i) => (
          <div key={i} className="workspace-shimmer h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-cue-200 bg-cue-50 px-4 py-3 text-[13px] text-cue-800 ${className}`}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-cue-600" />
        <span className="flex-1">
          <strong className="font-semibold">Couldn&apos;t load quotes.</strong> {error}
        </span>
        <button onClick={load} className="btn-ghost h-7 !px-2 text-cue-700">
          Try again
        </button>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <EmptyState
        className={className}
        icon={<MessageSquare className="h-5 w-5" />}
        title="No quotes yet"
        description="Quotes appear here once vendors you've contacted reply with a price. Pick vendors and approve contacting them to get started."
        action={
          <Link href={`/events/${eventId}`} className="btn-secondary">
            Go to overview <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
    );
  }

  return (
    <div className={`space-y-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-600">
          <strong className="font-semibold text-ink-900">{quotedCount}</strong> quote{quotedCount === 1 ? "" : "s"} across{" "}
          {groups.length} categor{groups.length === 1 ? "y" : "ies"}. Nothing is booked until you approve it.
        </p>
        <button onClick={load} disabled={loading} className="btn-ghost h-8 text-[12.5px]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <StaggerList className="space-y-5">
        {groups.map((g) => {
          const lowest = g.summary?.lowest ?? null;
          const budget = g.summary?.category_budget ?? null;
          const currency = g.items[0]?.currency || "INR";
          return (
            <section key={g.category} className="surface overflow-hidden">
              <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-900">{humanizeCategory(g.category)}</h3>
                  <p className="text-[12.5px] text-ink-600">
                    {g.items.length} vendor{g.items.length === 1 ? "" : "s"}
                    {lowest !== null ? <> · lowest {formatMoney(lowest, currency)}</> : null}
                  </p>
                </div>
                {budget !== null && (
                  <div className="text-right">
                    <div className="text-[12px] font-semibold text-ink-600">Category budget</div>
                    <div className="font-display text-[20px] font-bold tabular-nums text-ink-900" style={{ fontStretch: "90%" }}>
                      <AnimatedNumber value={budget} format={(n) => formatMoney(Math.round(n), currency) ?? ""} />
                    </div>
                  </div>
                )}
              </header>

              <ul className="divide-y divide-ink-200">
                {g.items.map((q, idx) => {
                  const st = quoteState(q);
                  const cfg = STATE[st];
                  const isLowest = lowest !== null && q.quoted_amount === lowest && g.items.filter((x) => x.quoted_amount !== null).length > 1;
                  const cov = coverage(q);
                  const changed = q.previous_amount !== null && q.quoted_amount !== null && q.previous_amount !== q.quoted_amount;
                  return (
                    <li key={q.assignment_id}>
                      <PopCard index={idx} interactive={false} className="px-5 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                          {/* who + state */}
                          <div className="min-w-0 lg:w-[30%]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[14px] font-semibold text-ink-900">{q.vendor_name || "Unnamed vendor"}</span>
                              {q.is_simulation && <span className="chip border-dashed border-ink-300 text-ink-600">Simulated</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <CueChip tone={cfg.tone} pulse={st === "awaiting_approval"}>
                                {cfg.label}
                              </CueChip>
                              {q.negotiation_round !== null && q.negotiation_round > 0 && (
                                <span className="text-[11.5px] text-ink-600">Round {q.negotiation_round}</span>
                              )}
                            </div>
                          </div>

                          {/* quote */}
                          <div className="lg:w-[22%]">
                            <div className="text-[11.5px] font-semibold text-ink-600">Quote</div>
                            {q.quoted_amount !== null ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-display text-[20px] font-bold tabular-nums text-ink-900" style={{ fontStretch: "90%" }}>
                                  {formatMoney(q.quoted_amount, q.currency)}
                                </span>
                                {isLowest && <span className="chip border-go-200 bg-go-50 text-go-700">Lowest</span>}
                              </div>
                            ) : (
                              <div className="text-[13px] text-ink-600">Not given yet</div>
                            )}
                            {changed && (
                              <div
                                className={`mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold ${
                                  (q.quoted_amount as number) > (q.previous_amount as number) ? "text-cue-700" : "text-go-700"
                                }`}
                              >
                                {(q.quoted_amount as number) > (q.previous_amount as number) ? (
                                  <TrendingUp className="h-3 w-3" />
                                ) : (
                                  <TrendingDown className="h-3 w-3" />
                                )}
                                Price changed from {formatMoney(q.previous_amount, q.currency)}
                              </div>
                            )}
                          </div>

                          {/* facts */}
                          <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
                            <Fact label="Available" value={yesNo(q.available, "Yes", "No")} warn={q.available === false} />
                            <Fact label="Hours" value={cov ?? "—"} />
                            <Fact label="Advance" value={yesNo(q.advance_required, "Required", "Not needed")} />
                            <Fact
                              label="Your limit"
                              value={
                                q.within_cap === null
                                  ? q.cap !== null
                                    ? formatMoney(q.cap, q.currency) ?? "—"
                                    : "—"
                                  : q.within_cap
                                  ? "Within limit"
                                  : "Over limit"
                              }
                              warn={q.within_cap === false}
                            />
                          </dl>

                          {/* next step */}
                          <div className="flex shrink-0 items-center justify-end gap-2 lg:w-[180px]">
                            <NextAction
                              q={q}
                              st={st}
                              eventId={eventId}
                              busy={busy === q.assignment_id}
                              disabled={!!busy}
                              isGuideTarget={guideTarget === q.assignment_id}
                              onRequest={() => requestBooking(q)}
                              onConfirm={() => setConfirming(q)}
                            />
                          </div>
                        </div>
                        {q.summary && <p className="mt-2 text-[12.5px] leading-snug text-ink-700">“{q.summary}”</p>}
                      </PopCard>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </StaggerList>

      {data?.source === "assignments" && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-600">
          <Clock className="h-3 w-3" /> Showing the latest quote for each vendor. Price history will appear here when available.
        </p>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md animate-rise-in rounded-2xl border border-ink-200 bg-[#FDFCFA] p-6 shadow-2xl">
            <h4 className="text-[16px] font-semibold text-ink-900">Confirm booking with {confirming.vendor_name || "this vendor"}?</h4>
            <dl className="mt-3 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-600">Amount</dt>
                <dd className="font-semibold tabular-nums text-ink-900">{formatMoney(confirming.quoted_amount, confirming.currency) ?? "Not given"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Advance</dt>
                <dd className="font-semibold text-ink-900">{yesNo(confirming.advance_required, "Required", "Not needed")}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] leading-snug text-ink-700">
              EVENTRA records the booking at this price and sends the vendor a confirmation message.{" "}
              <strong className="text-cue-700">This can&apos;t be undone here.</strong>
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="btn-ghost">
                Cancel
              </button>
              <button onClick={() => confirmBooking(confirming)} className="btn-cue">
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm booking
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast?.msg ?? null} tone={toast?.tone ?? "ink"} onDone={() => setToast(null)} />
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold text-ink-600">{label}</dt>
      <dd className={`truncate font-medium ${warn ? "text-cue-700" : "text-ink-900"}`}>{value}</dd>
    </div>
  );
}

function NextAction({
  q,
  st,
  eventId,
  busy,
  disabled,
  isGuideTarget,
  onRequest,
  onConfirm,
}: {
  q: QuoteItem;
  st: QuoteState;
  eventId: string;
  busy: boolean;
  disabled: boolean;
  isGuideTarget: boolean;
  onRequest: () => void;
  onConfirm: () => void;
}) {
  if (st === "booked") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-go-700">
        <CheckCircle2 className="h-4 w-4" /> Booked
      </span>
    );
  }
  if (st === "approved") {
    return (
      <button onClick={onConfirm} disabled={disabled} className="btn-cue h-9">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm booking
      </button>
    );
  }
  if (st === "awaiting_approval") {
    return (
      <Link
        href={q.approval_id ? `/events/${eventId}/approvals/${q.approval_id}` : `/events/${eventId}/approvals`}
        className="btn-secondary h-9"
      >
        Review decision <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  }
  if (st === "quoted" || st === "negotiating") {
    return (
      <button
        onClick={onRequest}
        disabled={disabled}
        title={JOURNEY_HELP.book}
        data-guide-step={isGuideTarget ? "review_quotes" : undefined}
        className="btn-primary h-9"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {JOURNEY_LABEL.book}
      </button>
    );
  }
  if (st === "requested" || st === "no_reply") {
    return (
      <Link href={`/events/${eventId}/conversations`} className="btn-ghost h-9 text-[12.5px]">
        <MessageSquare className="h-3.5 w-3.5" /> Open messages
      </Link>
    );
  }
  if (st === "not_requested") {
    return (
      <Link href={`/events/${eventId}`} className="btn-ghost h-9 text-[12.5px]">
        {JOURNEY_LABEL.contact} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  }
  return null;
}
