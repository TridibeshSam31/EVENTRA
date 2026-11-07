"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { getIncident, listIncidents, recalculateIncident, resolveIncident } from "@/lib/api/incidents";
import { listRecoveryOptions, generateRecoveryOptions, recalculateRecoveryOptions, executeRecoveryOption } from "@/lib/api/recovery";
import { listApprovals } from "@/lib/api/approvals";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import { EmptyState } from "@/components/ds";
import { ProvenanceBadge } from "./ProvenanceBadge";

const STRATEGY: Record<string, { title: string; what: string }> = {
  WAIT: { title: "Wait for the current vendor", what: "Keep the current vendor and absorb the delay." },
  BACKUP: { title: "Switch to a backup vendor", what: "Replace the vendor with another one from your list." },
  REASSIGN: { title: "Give the work to another vendor", what: "Move the affected task to a different vendor." },
  RESCHEDULE: { title: "Move the schedule", what: "Shift the affected tasks to later times." },
  COMPRESS: { title: "Speed up later tasks", what: "Shorten later tasks to win the time back." },
  SCOPE_SHED: { title: "Drop part of the plan", what: "Cancel lower-priority tasks to protect the rest." },
  CAPACITY_ADJUST: { title: "Change guest capacity", what: "Adjust the number of guests the plan supports." },
};

const OPEN = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING"];

const SEV_DOT: Record<string, string> = {
  EMERGENCY: "bg-cue-600 animate-cue-blink",
  CRITICAL: "bg-cue-500 animate-cue-blink",
  HIGH: "bg-standby-500",
  MEDIUM: "bg-standby-300",
  LOW: "bg-ink-400",
};

function fmtMin(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v === 0) return "no change";
  const sign = v > 0 ? "+" : "−";
  const a = Math.abs(v);
  return a >= 60 ? `${sign}${Math.floor(a / 60)} h ${a % 60} min` : `${sign}${a} min`;
}

function when(iso?: string) {
  if (!iso) return "";
  return new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z")).toLocaleString();
}

/** Numbered step in the incident → impact → recovery → verify flow. */
function Step({
  n,
  title,
  aside,
  state = "idle",
  children,
}: {
  n: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  state?: "done" | "active" | "idle" | "alert";
  children: React.ReactNode;
}) {
  const badge =
    state === "done"
      ? "bg-go-500 text-white"
      : state === "active"
      ? "bg-ink-900 text-ink-50"
      : state === "alert"
      ? "bg-cue-600 text-white"
      : "bg-ink-200 text-ink-600";
  return (
    <section className="relative grid grid-cols-[32px_1fr] gap-x-4">
      <div className="flex flex-col items-center">
        <span className={`grid h-8 w-8 place-items-center rounded-lg font-mono text-[11px] font-semibold ${badge}`}>{n}</span>
        <span className="mt-2 w-px flex-1 bg-ink-200" aria-hidden />
      </div>
      <div className="surface mb-5 min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-5 py-3">
          <h3 className="text-[14px] font-semibold text-ink-900">{title}</h3>
          {aside}
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </section>
  );
}

/**
 * The single Problems flow: list of problems → one problem's detail with what happened,
 * engine-calculated impact, ways to fix it, approval, and the result. Used by both
 * /events/[id]/incidents and /events/[id]/recovery so there is one place to handle a crisis.
 */
export function IncidentResponseView({ eventId, incidentId }: { eventId: string; incidentId?: string | null }) {
  useEventWorkspace(eventId); // keeps the live stream connected for this event
  const liveVersion = useWorkspaceStore((s) => (s.eventId === eventId ? s.liveVersion : 0));
  const [incidents, setIncidents] = useState<any[] | null>(null);
  const [incident, setIncident] = useState<any | null>(null);
  const [options, setOptions] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  // Partial-load failures must be visible: "no options" and "couldn't load options" are different.
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      if (!incidentId) {
        const res = await listIncidents(eventId);
        setIncidents(res.items || []);
        return;
      }
      const [inc, opts, apps] = await Promise.allSettled([
        getIncident(eventId, incidentId),
        listRecoveryOptions(eventId, incidentId),
        listApprovals(eventId, { limit: 100 }),
      ]);
      if (inc.status === "rejected") throw inc.reason;
      setIncident(inc.value);
      if (opts.status === "fulfilled") {
        setOptions((opts.value as any)?.items || []);
        setOptionsError(null);
      } else {
        setOptionsError(opts.reason?.message || "The server didn't respond.");
      }
      if (apps.status === "fulfilled") {
        setApprovals((apps.value as any)?.items || []);
        setApprovalsError(null);
      } else {
        setApprovalsError(apps.reason?.message || "The server didn't respond.");
      }
    } catch (err: any) {
      setMessage({ kind: "error", text: err?.message || "Could not load this problem." });
    } finally {
      setLoading(false);
    }
  }, [eventId, incidentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!liveVersion) return;
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [liveVersion, load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: "ok", text: ok });
      await load();
    } catch (err: any) {
      const text: string = err?.message || "That did not work.";
      setMessage({
        kind: "error",
        text: /STALE/i.test(text)
          ? "The event changed since these options were made, so nothing was done. Refresh the options and decide again."
          : /APPROVAL_REQUIRED/i.test(text)
            ? "This option needs an approval first."
            : text,
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 px-2 py-8 font-mono text-[12px] uppercase tracking-label text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin text-cue-600" /> Loading…
      </div>
    );
  }

  // ---- List of problems -------------------------------------------------------
  if (!incidentId) {
    // A failed fetch must not read as "no problems".
    if (incidents === null && message?.kind === "error") {
      return (
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Couldn’t load problems"
          description={message.text}
          action={
            <button
              onClick={() => {
                setMessage(null);
                setLoading(true);
                load();
              }}
              className="btn-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          }
        />
      );
    }
    const list = incidents || [];
    const open = list.filter((i) => OPEN.includes(i.status));
    const closed = list.filter((i) => !OPEN.includes(i.status));
    return (
      <section className="surface">
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5">
          <div>
            <div className="eyebrow">Incident board</div>
            <h2 className="mt-0.5 text-[15px] font-semibold text-ink-900">
              Problems <span className="font-normal text-ink-500">· {open.length} open</span>
            </h2>
          </div>
          {open.length > 0 && (
            <span className="chip border-cue-200 bg-cue-50 text-cue-700">
              <span className="cue-light bg-cue-600 animate-cue-blink" /> Hold
            </span>
          )}
        </header>
        {list.length === 0 ? (
          <div className="flex items-center justify-center gap-2.5 px-5 py-10 text-[13px] text-ink-500">
            <span className="cue-light bg-go-500" /> No problems have been reported for this event.
          </div>
        ) : (
          <ul className="divide-y divide-dashed divide-ink-200">
            {[...open, ...closed].map((i) => {
              const isOpenRow = OPEN.includes(i.status);
              return (
                <li
                  key={i.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-3.5 px-5 py-3 transition hover:bg-ink-50/60 ${
                    isOpenRow ? "" : "opacity-70"
                  }`}
                >
                  <span className={`cue-light h-2.5 w-2.5 ${isOpenRow ? SEV_DOT[i.severity] || SEV_DOT.LOW : "bg-go-500"}`} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-ink-900">{i.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-ink-500">
                      {String(i.severity).toLowerCase()} · {String(i.status).toLowerCase()} · {when(i.detected_at)}
                    </p>
                  </div>
                  <Link
                    href={`/events/${eventId}/incidents?incidentId=${i.id}`}
                    className={`${isOpenRow ? "btn-primary" : "btn-secondary"} h-8`}
                    data-guide-step={isOpenRow ? "resolve_problem" : undefined}
                  >
                    {isOpenRow ? "Respond" : "View"} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  if (!incident) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Couldn’t open this problem"
        description={message?.text || "This problem could not be found."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => {
                setMessage(null);
                setLoading(true);
                load();
              }}
              className="btn-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
            <Link href={`/events/${eventId}/incidents`} className="btn-ghost">
              <ArrowLeft className="h-3.5 w-3.5" /> All problems
            </Link>
          </div>
        }
      />
    );
  }

  // ---- Incident detail --------------------------------------------------------
  const impact = (incident.impact_result || {}) as any;
  const schedule = impact.schedule_impact || {};
  const direct: any[] = impact.directly_affected_tasks || [];
  const downstream: any[] = impact.indirectly_affected_tasks || [];
  const signals: any[] = (incident.evidence_metadata?.signals as any[]) || [];
  const isOpen = OPEN.includes(incident.status);
  const executed = options.find((o) => o.status === "EXECUTED");
  const approvalFor = (optId: string) =>
    approvals
      .filter((a) => a.recovery_option_id === optId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const feasible = options.filter((o) => o.is_feasible && !o.is_stale && o.status !== "STALE");
  const rejected = options.filter((o) => !o.is_feasible);
  const allStale = options.length > 0 && options.every((o) => o.is_stale || o.status === "STALE");
  const sourceLabel =
    incident.source === "INBOUND_WHATSAPP"
      ? "the vendor on WhatsApp"
      : incident.source === "MANUAL"
      ? "your team"
      : String(incident.source || "").toLowerCase();

  // Flow progress strip
  const flow = [
    { k: "Reported", done: true },
    { k: "Impact", done: !!incident.impact_result },
    { k: "Options", done: options.length > 0 },
    { k: "Action", done: !!executed },
    { k: "Verified", done: !isOpen },
  ];

  const impactCells = [
    {
      label: "Expected delay",
      value: schedule.delay_minutes ? `${schedule.delay_minutes} min` : "None calculated",
      alert: !!schedule.delay_minutes,
    },
    { label: "Critical path", value: schedule.critical_path_breached ? "Affected" : "Not affected", alert: !!schedule.critical_path_breached },
    { label: "Tasks affected", value: String(direct.length + downstream.length), alert: false },
    { label: "Event end date", value: schedule.deadline_exceeded ? "At risk" : "Safe", alert: !!schedule.deadline_exceeded },
  ];

  return (
    <div className="space-y-5">
      {/* Navigation + problem-level actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/events/${eventId}/incidents`} className="btn-ghost h-8 px-2">
          <ArrowLeft className="h-3.5 w-3.5" /> All problems
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={!!busy}
            onClick={() =>
              run("impact", () => recalculateIncident(eventId, incident.id), "Impact recalculated against the latest plan.")
            }
            className="btn-secondary h-8"
            title="Re-run the impact calculation against the current plan and live state"
          >
            {busy === "impact" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Recalculate impact
          </button>
          {isOpen &&
            (confirmResolve ? (
              <span className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-[#FDFCFA] px-2 py-1 text-[12.5px] text-ink-700">
                Mark as fixed without using an option?
                <button
                  disabled={!!busy}
                  onClick={async () => {
                    await run(
                      "resolve",
                      () => resolveIncident(eventId, incident.id, "Marked fixed by the organizer from the Problems page"),
                      "Marked as fixed."
                    );
                    setConfirmResolve(false);
                  }}
                  className="btn-primary h-7 px-2.5 text-[12px]"
                >
                  {busy === "resolve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, it's fixed"}
                </button>
                <button onClick={() => setConfirmResolve(false)} className="btn-ghost h-7 px-2 text-[12px]">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmResolve(true)} className="btn-ghost h-8" title="Close this problem if it was handled outside EVENTRA">
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark as fixed
              </button>
            ))}
          <Link
            href={`/events/${eventId}/recovery?incidentId=${incident.id}&view=advanced`}
            className="btn-ghost h-8"
            title="Detailed recovery workspace with backup-vendor search and decision trace"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced view
          </Link>
        </div>
      </div>

      {/* Incident banner */}
      <section className="surface-ink relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-60" aria-hidden />
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip border-white/10 ${isOpen ? "bg-cue-600/20 text-cue-200" : "bg-go-500/15 text-go-300"}`}>
              <span className={`cue-light ${isOpen ? "bg-cue-500 animate-cue-blink" : "bg-go-400"}`} />
              {isOpen ? "open" : String(incident.status).toLowerCase()}
            </span>
            <span className="chip border-white/10 bg-white/5 text-standby-200">{String(incident.severity).toLowerCase()}</span>
          </div>
          <h2
            className="mt-3 font-display text-[28px] font-extrabold leading-[1.02] tracking-[-0.025em] text-ink-50 sm:text-[34px]"
            style={{ fontStretch: "85%" }}
          >
            {incident.title}
          </h2>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink-400">
            Reported by {sourceLabel} · {when(incident.detected_at)}
          </p>

          <ol className="mt-5 grid grid-cols-5 gap-1">
            {flow.map((f, idx) => (
              <li key={f.k} className="min-w-0">
                <div className={`h-1 rounded-full ${f.done ? "bg-go-500" : "bg-white/10"}`} />
                <div className={`mt-1.5 truncate font-mono text-[10px] uppercase tracking-label ${f.done ? "text-ink-200" : "text-ink-500"}`}>
                  {String(idx + 1).padStart(2, "0")} {f.k}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div>
        {/* 1. What happened */}
        <Step
          n="01"
          title="What happened"
          state="done"
          aside={<ProvenanceBadge source={incident.source === "MANUAL" ? "HUMAN" : "SOURCE"} size="sm" />}
        >
          {signals.length > 0 ? (
            <ul className="space-y-2">
              {signals.map((s, idx) => (
                <li key={idx} className="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-2.5">
                  <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span className="text-[13.5px] leading-snug text-ink-800">“{s.message}”</span>
                </li>
              ))}
            </ul>
          ) : incident.description ? (
            <p className="text-[13.5px] leading-relaxed text-ink-700">{incident.description}</p>
          ) : (
            <p className="text-[13px] text-ink-400">No message was attached to this report.</p>
          )}
        </Step>

        {/* 2. Impact */}
        <Step
          n="02"
          title="What this affects"
          state={incident.impact_result ? (schedule.critical_path_breached || schedule.deadline_exceeded ? "alert" : "done") : "idle"}
          aside={<ProvenanceBadge source="ENGINE" size="sm" />}
        >
          {!incident.impact_result ? (
            <p className="rounded-lg border border-standby-200 bg-standby-50 px-3 py-2 text-[12.5px] text-standby-800">
              Impact could not be calculated for this problem. Check the task plan, then refresh.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink-200 bg-ink-200 sm:grid-cols-4">
                {impactCells.map((c) => (
                  <div key={c.label} className="bg-[#FDFCFA] px-3.5 py-3">
                    <p className="eyebrow">{c.label}</p>
                    <p className={`mt-1 text-[15px] font-semibold ${c.alert ? "text-cue-700" : "text-ink-900"}`}>{c.value}</p>
                  </div>
                ))}
              </div>
              {(direct.length > 0 || downstream.length > 0) && (
                <div className="mt-3.5 space-y-2 text-[12.5px] text-ink-700">
                  {direct.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 font-semibold text-ink-900">Directly:</span>
                      {direct.map((t, i) => (
                        <span key={i} className="rounded border border-cue-200 bg-cue-50 px-1.5 py-px text-cue-800">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {downstream.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 font-semibold text-ink-900">Later tasks that depend on it:</span>
                      {downstream.map((t, i) => (
                        <span key={i} className="rounded border border-standby-200 bg-standby-50 px-1.5 py-px text-standby-800">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-3 text-[11.5px] text-ink-400">
                Calculated from your task plan and its dependencies. Tasks without a planned time give a less precise estimate.
              </p>
            </>
          )}
        </Step>

        {message && (
          <p
            role="status"
            className={`mb-5 ml-12 rounded-lg border px-3.5 py-2.5 text-[12.5px] ${
              message.kind === "ok" ? "border-go-200 bg-go-50 text-go-800" : "border-cue-200 bg-cue-50 text-cue-800"
            }`}
          >
            {message.text}
          </p>
        )}

        {/* 3. Options and decision */}
        {isOpen && (
          <Step
            n="03"
            title="Ways to fix it"
            state={executed ? "done" : options.length ? "active" : "idle"}
            aside={
              options.length === 0 ? (
                <button
                  disabled={!!busy}
                  onClick={() => run("gen", () => generateRecoveryOptions(eventId, incident.id), "Options calculated.")}
                  className="btn-cue h-8"
                  data-guide-step="resolve_problem"
                >
                  {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Find options
                </button>
              ) : (
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run("recalc", () => recalculateRecoveryOptions(eventId, incident.id), "Options refreshed against the latest event state.")
                  }
                  className="btn-secondary h-8"
                >
                  {busy === "recalc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh options
                </button>
              )
            }
          >
            {allStale && (
              <p className="mb-3 rounded-lg border border-standby-200 bg-standby-50 px-3 py-2 text-[12.5px] text-standby-800">
                The event changed after these options were made. Refresh them before deciding.
              </p>
            )}
            {options.length > 0 && feasible.length === 0 && !allStale && (
              <p className="mb-3 rounded-lg border border-cue-200 bg-cue-50 px-3 py-2 text-[12.5px] text-cue-800">
                No workable option was found. Contact a replacement vendor yourself or ask your team for help.
              </p>
            )}
            {optionsError ? (
              <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-cue-200 bg-cue-50 px-3 py-2.5 text-[12.5px] text-cue-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">
                  Couldn&apos;t load the saved fix options ({optionsError}). There may already be options — try again before
                  generating new ones.
                </span>
                <button
                  onClick={() => {
                    setLoading(true);
                    load();
                  }}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              options.length === 0 && (
                <p className="py-4 text-center text-[13px] text-ink-600">
                  No fix options yet. Press “Find options” and EVENTRA will work out ways to recover.
                </p>
              )
            )}
            {approvalsError && options.length > 0 && (
              <p className="mb-3 rounded-lg border border-standby-200 bg-standby-50 px-3 py-2 text-[12.5px] text-standby-800">
                Couldn&apos;t load approvals, so approval status for these options may be missing. The server still checks
                approvals before anything runs.
              </p>
            )}

            <ul className="space-y-2.5">
              {feasible.map((o) => {
                const s = STRATEGY[o.strategy_type] || { title: o.strategy_type, what: "" };
                const cost = o.budget_delta || {};
                const costKnown = cost.cost_known !== false;
                const delay = fmtMin((o.schedule_delta || {}).total_delay_change_minutes);
                const approval = approvalFor(o.id);
                // An approval request exists only when policy asked for one; the server enforces it on execution.
                const approved = approval?.status === "APPROVED";
                const waitingApproval = !!approval && !approved;
                const canRun = !executed && !waitingApproval;
                const best = o.rank === 1;
                return (
                  <li
                    key={o.id}
                    className={`rounded-xl border bg-[#FDFCFA] p-4 transition ${
                      best ? "border-ink-900 shadow-md" : "border-ink-200 hover:border-ink-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {o.rank != null && <span className="font-mono text-[11px] text-ink-400">#{o.rank}</span>}
                          <p className="text-[14px] font-semibold text-ink-900">{s.title}</p>
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-ink-600">{s.what}</p>
                      </div>
                      {best && (
                        <span className="chip shrink-0 border-go-200 bg-go-50 text-go-700">
                          <span className="cue-light bg-go-500" /> best fit
                        </span>
                      )}
                    </div>
                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-dashed border-ink-200 pt-3 text-[12.5px]">
                      <div>
                        <dt className="eyebrow">Extra cost</dt>
                        <dd className="mt-0.5 font-semibold text-ink-900">
                          {costKnown ? (
                            `₹${Math.round(Number(cost.additional_cost || 0)).toLocaleString()}`
                          ) : (
                            <span className="text-standby-700">unknown — no quote yet</span>
                          )}
                        </dd>
                      </div>
                      {delay && (
                        <div>
                          <dt className="eyebrow">Timeline</dt>
                          <dd className="timecode mt-0.5 font-semibold text-ink-900">{delay}</dd>
                        </div>
                      )}
                      {approval && (
                        <div>
                          <dt className="eyebrow">Approval</dt>
                          <dd className="mt-0.5 font-semibold capitalize text-ink-900">{String(approval.status).toLowerCase()}</dd>
                        </div>
                      )}
                      <div className="ml-auto self-end">
                        <ProvenanceBadge source="ENGINE" size="sm" />
                      </div>
                    </dl>
                    {(waitingApproval || canRun) && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {waitingApproval && (
                          <Link
                            href={`/events/${eventId}/approvals/${approval.id}`}
                            className="btn h-8 border border-standby-200 bg-standby-50 text-standby-800 hover:bg-standby-100"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />{" "}
                            {approval.status === "PENDING" ? "Review approval" : `Approval ${String(approval.status).toLowerCase()}`}
                          </Link>
                        )}
                        {canRun && (
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              run(o.id, () => executeRecoveryOption(eventId, incident.id, o.id), "Done. EVENTRA applied the change and is checking the result.")
                            }
                            className={`${best ? "btn-cue" : "btn-primary"} h-8`}
                            data-guide-step={best ? "resolve_problem" : undefined}
                          >
                            {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Use this option
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {rejected.length > 0 && (
              <details className="mt-3 rounded-lg border border-dashed border-ink-300 px-3.5 py-2.5">
                <summary className="cursor-pointer text-[12.5px] font-medium text-ink-500 hover:text-ink-800">
                  {rejected.length} option(s) were ruled out
                </summary>
                <ul className="mt-2.5 space-y-2">
                  {rejected.map((o) => (
                    <li key={o.id} className="flex gap-2 text-[12.5px] text-ink-600">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cue-400" />
                      <span>
                        <span className="font-semibold text-ink-800">{STRATEGY[o.strategy_type]?.title || o.strategy_type}:</span>{" "}
                        {((o.feasibility_result || {}).violations || []).join(" ") || "Did not pass the checks."}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Step>
        )}

        {/* 4. After the action */}
        {executed && (
          <Step n={isOpen ? "04" : "03"} title="Result" state={isOpen ? "active" : "done"} aside={<ProvenanceBadge source="EXECUTED" size="sm" />}>
            <div className="flex gap-3">
              {isOpen ? (
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-standby-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-go-600" />
              )}
              <div>
                <p className="text-[14px] font-semibold text-ink-900">
                  {STRATEGY[executed.strategy_type]?.title || executed.strategy_type} was carried out
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
                  {isOpen
                    ? "The change was applied, but the problem is not marked fixed yet because the result has not been verified. Check the result or pick another option."
                    : "The result was verified and this problem is closed."}
                </p>
              </div>
            </div>
          </Step>
        )}
      </div>
    </div>
  );
}
