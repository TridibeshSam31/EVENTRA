"use client";

/**
 * Event report — what happened, what it cost, what went wrong and how it was fixed.
 * Renders GET /events/{id}/report exactly; missing sections are simply omitted.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Download, FileBarChart, RefreshCw } from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { PageHeader, Panel, Stat, EmptyState, CueChip, Meter, type CueTone } from "@/components/ds";
import { AnimatedNumber, Reveal } from "@/components/ds/motion";
import { getEventReport, type EventReport } from "@/lib/api/report";
import { formatMoney, humanizeCategory, humanizeCode } from "@/lib/humanize";

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export default function EventReportPage() {
  const params = useParams();
  const eventId = params?.eventId as string;
  const [report, setReport] = useState<EventReport | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getEventReport(eventId);
      setReport(r);
      setMissing(r === null);
    } catch (err: any) {
      setError(/fetch|network/i.test(err?.message || "") ? "EVENTRA's server isn't reachable right now." : err?.message || "Couldn't load the report.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const currency = report?.budget?.currency || "INR";
  const money = (v: number | null | undefined) => formatMoney(n(v), currency);

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Wrap-up"
          title="Event report"
          description="What was booked, what it cost, what went wrong and how it was handled — straight from the event's records."
          actions={
            <>
              <button onClick={load} disabled={loading} className="btn-secondary">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
              {report && (
                <button onClick={() => window.print()} className="btn-ghost">
                  <Download className="h-3.5 w-3.5" /> Print / save PDF
                </button>
              )}
            </>
          }
        />

        {loading && !report && !missing && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="workspace-shimmer h-24 rounded-xl" />
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-cue-200 bg-cue-50 px-4 py-3 text-[13px] text-cue-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-cue-600" />
            <span className="flex-1">
              <strong className="font-semibold">Couldn&apos;t load the report.</strong> {error}
            </span>
            <button onClick={load} className="btn-ghost h-7 !px-2 text-cue-700">
              Try again
            </button>
          </div>
        )}

        {!loading && missing && !error && (
          <EmptyState
            icon={<FileBarChart className="h-5 w-5" />}
            title="Report available after the event"
            description="Once the event has run, this page summarises bookings, spending, problems and how they were fixed."
            action={
              <Link href={`/events/${eventId}`} className="btn-secondary">
                Back to overview <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        )}

        {report && <ReportBody report={report} money={money} currency={currency} eventId={eventId} />}
      </div>
    </EventShell>
  );
}

function ReportBody({
  report,
  money,
  currency,
  eventId,
}: {
  report: EventReport;
  money: (v: number | null | undefined) => string | null;
  currency: string;
  eventId: string;
}) {
  const b = report.budget;
  const total = n(b?.total);
  const committed = n(b?.committed);
  const inc = report.incidents;
  const tl = report.timeline;
  const ap = report.approvals;
  const comm = report.communication;
  const vendors = report.vendors || [];
  const cats = b?.spent_by_category || [];
  const fmt = (v: number) => formatMoney(Math.round(v), currency) ?? "";

  return (
    <div className="space-y-6">
      {report.event && (
        <div className="surface flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-[13px] text-ink-700">
          <span className="text-[16px] font-semibold text-ink-900">{report.event.name || "This event"}</span>
          {report.event.type && <span>{humanizeCode(report.event.type)}</span>}
          {report.event.location && <span>{report.event.location}</span>}
          {report.event.start && <span>{new Date(report.event.start).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
          {n(report.event.guests) !== null && <span>{n(report.event.guests)!.toLocaleString()} guests</span>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Committed"
          tone={total !== null && committed !== null && committed > total ? "cue" : "go"}
          value={committed !== null ? <AnimatedNumber value={committed} format={fmt} /> : "—"}
          sub={total !== null ? `of ${money(total)} budget` : "Budget not set"}
        />
        <Stat
          label="Vendors booked"
          value={<AnimatedNumber value={vendors.filter((v) => /CONFIRMED|BOOKED|CONTRACTED/i.test(v.status || "")).length} />}
          sub={`${vendors.length} vendor${vendors.length === 1 ? "" : "s"} involved`}
        />
        <Stat
          label="Problems"
          tone={(inc?.open ?? 0) > 0 ? "standby" : "go"}
          value={inc ? <AnimatedNumber value={inc.total ?? 0} /> : "—"}
          sub={inc ? `${inc.resolved ?? 0} resolved · ${inc.open ?? 0} open` : "No data"}
        />
        <Stat
          label="Tasks done"
          value={tl ? <AnimatedNumber value={tl.tasks_done ?? 0} /> : "—"}
          sub={tl ? `of ${tl.tasks_total ?? 0}${n(tl.late) ? ` · ${tl.late} late` : ""}` : "No data"}
        />
      </div>

      {cats.length > 0 && (
        <Reveal>
          <Panel title="Money by category" eyebrow="Budget">
            <ul className="space-y-3">
              {cats.map((c) => {
                const est = n(c.estimated);
                const com = n(c.committed);
                const over = est !== null && com !== null && com > est;
                return (
                  <li key={c.category}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-semibold text-ink-900">{humanizeCategory(c.category)}</span>
                      <span className="tabular-nums text-ink-700">
                        <strong className={over ? "text-cue-700" : "text-ink-900"}>{money(com) ?? "—"}</strong> committed
                        {est !== null && <> · estimated {money(est)}</>}
                      </span>
                    </div>
                    {est !== null && com !== null && <Meter className="mt-1.5" value={com} max={Math.max(est, com)} tone={over ? "cue" : "go"} />}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </Reveal>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {vendors.length > 0 && (
          <Reveal>
            <Panel title="Vendors" eyebrow="Bookings">
              <ul className="ruled">
                {vendors.map((v, i) => (
                  <li key={`${v.name}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-ink-900">{v.name || "Unnamed vendor"}</div>
                      <div className="text-[12px] text-ink-600">{v.category ? humanizeCategory(v.category) : "—"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {v.status && <CueChip tone={statusTone(v.status)}>{humanizeCode(v.status)}</CueChip>}
                      <span className="w-24 text-right text-[13px] font-semibold tabular-nums text-ink-900">{money(v.agreed_cost) ?? "—"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>
        )}

        {inc && (inc.items?.length ?? 0) > 0 && (
          <Reveal>
            <Panel
              title="Problems and how they were handled"
              eyebrow="Incidents"
              actions={
                <Link href={`/events/${eventId}/incidents`} className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900">
                  Open problems
                </Link>
              }
            >
              <ul className="ruled">
                {inc.items!.map((it, i) => (
                  <li key={i} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-ink-900">{it.title || "Problem"}</span>
                      <span className="flex items-center gap-1.5">
                        {it.severity && <CueChip tone={/CRIT|HIGH/i.test(it.severity) ? "cue" : "standby"}>{humanizeCode(it.severity)}</CueChip>}
                        {it.status && <CueChip tone={/RESOLV|CLOSED|VERIFIED/i.test(it.status) ? "go" : "idle"}>{humanizeCode(it.status)}</CueChip>}
                      </span>
                    </div>
                    {it.resolution && <p className="mt-0.5 text-[12.5px] text-ink-700">{it.resolution}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>
        )}
      </div>

      {(ap || comm) && (
        <Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {ap && (
              <Panel title="Decisions" eyebrow="Approvals">
                <Counts
                  rows={[
                    ["Requested", ap.total],
                    ["Approved", ap.approved],
                    ["Declined", ap.rejected],
                    ["Expired", ap.expired],
                  ]}
                />
              </Panel>
            )}
            {comm && (
              <Panel title="Vendor communication" eyebrow="Outreach">
                <Counts
                  rows={[
                    ["Messages sent", comm.messages_sent],
                    ["Calls made", comm.calls_made],
                    ["Replies received", comm.replies],
                  ]}
                />
              </Panel>
            )}
          </div>
        </Reveal>
      )}

      {tl && n(tl.tasks_total) !== null && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-600">
          <CheckCircle2 className="h-3.5 w-3.5 text-go-600" />
          {tl.tasks_done ?? 0} of {tl.tasks_total} tasks done
          {n(tl.on_time) !== null ? ` · ${tl.on_time} on time` : ""}
          {n(tl.late) !== null ? ` · ${tl.late} late` : ""}
        </p>
      )}
    </div>
  );
}

function Counts({ rows }: { rows: Array<[string, number | undefined]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {rows.map(([label, v]) => (
        <div key={label}>
          <dt className="text-[12px] font-semibold text-ink-600">{label}</dt>
          <dd className="font-display text-[22px] font-bold tabular-nums text-ink-900" style={{ fontStretch: "90%" }}>
            {typeof v === "number" ? <AnimatedNumber value={v} /> : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function statusTone(s: string): CueTone {
  if (/CONFIRMED|BOOKED|CONTRACTED|COMPLETED/i.test(s)) return "go";
  if (/CANCEL|DECLIN|REJECT|FAIL/i.test(s)) return "cue";
  return "idle";
}
