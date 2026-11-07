"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flag, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { getOperationalSummary, type OperationalSummary, type OperationalStatus } from "@/lib/api/live";
import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ReportProblem } from "./ReportProblem";
import { EmptyState, Stat } from "@/components/ds";

const FALLBACK_POLL_MS = 15000;
const STALE_AFTER_MS = 60000;

// Cue-light vocabulary: go = on track, standby = at risk, hold = critical.
const STATUS_STYLE: Record<
  OperationalStatus,
  { label: string; cue: string; word: string; dot: string; ring: string }
> = {
  ON_TRACK: { label: "On track", cue: "GO", word: "text-go-400", dot: "bg-go-500", ring: "ring-go-500/30" },
  AT_RISK: { label: "At risk", cue: "STANDBY", word: "text-standby-300", dot: "bg-standby-400", ring: "ring-standby-400/30" },
  CRITICAL: { label: "Critical", cue: "HOLD", word: "text-cue-400", dot: "bg-cue-500", ring: "ring-cue-500/40" },
  UNKNOWN: { label: "Not enough data yet", cue: "NO SIGNAL", word: "text-ink-300", dot: "bg-ink-500", ring: "ring-white/10" },
};

const SEVERITY: Record<string, { dot: string; text: string; pulse?: boolean }> = {
  EMERGENCY: { dot: "bg-cue-600", text: "text-cue-700", pulse: true },
  CRITICAL: { dot: "bg-cue-500", text: "text-cue-700", pulse: true },
  HIGH: { dot: "bg-standby-500", text: "text-standby-800" },
  MEDIUM: { dot: "bg-standby-300", text: "text-standby-700" },
  LOW: { dot: "bg-ink-400", text: "text-ink-600" },
};

const WHATSAPP_LABEL: Record<string, string> = {
  NOT_ATTEMPTED: "Not contacted",
  QUEUED: "Sending",
  SENDING: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  REPLIED: "Replied",
  FAILED: "Failed",
  UNAVAILABLE: "No number",
};
const CALL_LABEL: Record<string, string> = {
  NOT_ATTEMPTED: "Not called",
  QUEUED: "Calling",
  RINGING: "Ringing",
  IN_PROGRESS: "On call",
  COMPLETED: "Call done",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  FAILED: "Failed",
  UNAVAILABLE: "No number",
};
// Commitment is what the vendor is booked for, recorded separately from messages.
const COMMITMENT_LABEL: Record<string, string> = {
  NONE: "Not booked",
  REQUESTED: "Requested",
  ASSIGNED: "Assigned, not confirmed",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

// Channel state -> cue light colour
function channelDot(value: string) {
  if (["REPLIED", "COMPLETED", "READ", "DELIVERED"].includes(value)) return "bg-go-500";
  if (["FAILED", "NO_ANSWER", "BUSY"].includes(value)) return "bg-cue-500";
  if (["QUEUED", "SENDING", "SENT", "RINGING", "IN_PROGRESS"].includes(value)) return "bg-standby-400";
  return "bg-ink-300";
}

function human(map: Record<string, string>, value: string) {
  return map[value] || value.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function parseUtc(iso: string) {
  return new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z"));
}

function timeAgo(iso?: string | null) {
  if (!iso) return null;
  const ms = Date.now() - parseUtc(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

// Run-sheet timecode, e.g. 14:05
function clock(iso?: string | null) {
  if (!iso) return "--:--";
  const d = parseUtc(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function LiveOperationsOverview({ eventId }: { eventId: string }) {
  const { sseConnected } = useEventWorkspace(eventId);
  const liveVersion = useWorkspaceStore((s) => (s.eventId === eventId ? s.liveVersion : 0));
  const [data, setData] = useState<OperationalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const summary = await getOperationalSummary(eventId);
      setData(summary);
      setError(null);
      setLastOk(Date.now());
    } catch (err: any) {
      setError(err?.message || "Could not load the live status.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    load();
  }, [load]);

  // Live frames: refetch shortly after any change (debounced so bursts cost one request).
  useEffect(() => {
    if (!liveVersion) return;
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [liveVersion, load]);

  // Fallback when the live stream is down: poll while the tab is visible.
  useEffect(() => {
    if (sseConnected) return;
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [sseConnected, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    return (
      <div className="surface-ink flex items-center gap-3 px-6 py-10 text-sm text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin text-cue-400" />
        <span className="font-mono text-[12px] uppercase tracking-label">Connecting to the show…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<WifiOff className="h-5 w-5" />}
        title="Live status is unavailable"
        description={error || "Could not load the live status."}
        action={
          <button onClick={load} className="btn-secondary">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        }
      />
    );
  }

  const stale = !!error || (lastOk !== null && now - lastOk > STALE_AFTER_MS);
  const status = STATUS_STYLE[data.status] || STATUS_STYLE.UNKNOWN;
  const confirmed = data.vendors.filter((v) => v.commitment === "CONFIRMED").length;
  const currency = data.budget.currency === "INR" ? "₹" : `${data.budget.currency} `;
  const money = (n: number | null) => (n === null ? "—" : `${currency}${Math.round(n).toLocaleString()}`);
  const blockedOrFailed = data.tasks.blocked + data.tasks.failed;

  return (
    <div className="stagger space-y-5">
      {/* A. Show-caller status board */}
      <section className={`surface-ink relative overflow-hidden ring-1 ${status.ring}`}>
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-label text-ink-400">
              <span className={`cue-light h-2.5 w-2.5 ${status.dot} ${data.status !== "ON_TRACK" ? "animate-cue-blink" : ""}`} />
              Show status
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span
                className={`font-display text-[44px] font-extrabold leading-none tracking-[-0.03em] sm:text-[56px] ${status.word}`}
                style={{ fontStretch: "78%" }}
              >
                {status.cue}
              </span>
              <span className="text-[15px] font-semibold text-ink-100">{status.label}</span>
            </div>
            {data.status_reasons.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {data.status_reasons.map((r) => (
                  <li key={r} className="flex gap-2.5 text-[13px] leading-snug text-ink-300">
                    <span className="mt-[7px] h-px w-3 shrink-0 bg-ink-500" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-row items-end justify-between gap-4 border-t border-white/[0.07] pt-4 lg:flex-col lg:items-end lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="lg:text-right">
              <div className="font-mono text-[10px] uppercase tracking-label text-ink-500">Last update</div>
              <div className="timecode mt-1 text-[28px] font-medium leading-none text-ink-50">
                {lastOk
                  ? new Date(lastOk).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                  : "--:--:--"}
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-ink-400">
                {stale ? (
                  <>
                    <WifiOff className="h-3.5 w-3.5" /> Data may be out of date
                  </>
                ) : sseConnected ? (
                  <>
                    <span className="cue-light bg-go-500 animate-cue-blink" /> Updates automatically
                  </>
                ) : (
                  <>
                    <span className="cue-light bg-standby-400" /> Checking every 15 s
                  </>
                )}
              </div>
            </div>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-semibold text-ink-200 transition hover:bg-white/[0.08]"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        </div>
        {stale && (
          <p className="relative border-t border-standby-400/20 bg-standby-400/10 px-6 py-2.5 text-[12px] text-standby-200">
            {error ? `Last refresh failed: ${error}. ` : ""}Showing what we knew at{" "}
            {lastOk ? new Date(lastOk).toLocaleTimeString() : "the last check"}.
          </p>
        )}
      </section>

      {/* F. Next cue */}
      {data.next_action && (
        <section className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-xl border border-cue-200 bg-[#FDFCFA] p-4 pl-5 shadow-sm sm:flex-row sm:items-center">
          <span className="absolute inset-y-0 left-0 w-1 bg-cue-600" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-label text-cue-700">
              <span className="cue-light bg-cue-600 animate-cue-blink" /> Standing by · next cue
            </div>
            <h3 className="mt-1 text-[15px] font-semibold text-ink-900">{data.next_action.title}</h3>
            {data.next_action.reason && <p className="mt-0.5 text-[13px] text-ink-600">{data.next_action.reason}</p>}
          </div>
          <Link href={data.next_action.href} className="btn-cue shrink-0 self-start sm:self-auto">
            {data.next_action.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      {/* B. Readouts */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tasks done" value={`${data.tasks.completed} / ${data.tasks.total}`} tone="go" />
        <Stat
          label="Blocked / failed"
          value={blockedOrFailed}
          tone={blockedOrFailed > 0 ? "cue" : "default"}
          sub={blockedOrFailed > 0 ? "Needs a decision" : "Nothing stuck"}
        />
        <Stat label="Vendors confirmed" value={`${confirmed} / ${data.vendors.length}`} tone="engine" />
        <Stat
          label="Waiting for your OK"
          value={data.pending_approvals.length}
          tone={data.pending_approvals.length > 0 ? "standby" : "default"}
        />
        <Stat
          label="Budget committed"
          value={<span className="text-[22px]">{money(data.budget.committed)}</span>}
          sub={`of ${money(data.budget.total)}`}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <ReportProblem eventId={eventId} vendors={data.vendors} />

      {/* C. Issues */}
      <section className="surface">
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Flag className="h-4 w-4 text-ink-500" />
            <h3 className="text-[14px] font-semibold text-ink-900">Needs attention</h3>
            <span className="rounded bg-ink-100 px-1.5 py-px font-mono text-[11px] text-ink-600">{data.issues.length}</span>
          </div>
        </header>
        {data.issues.length === 0 ? (
          <div className="flex items-center gap-2.5 px-5 py-6 text-[13px] text-ink-500">
            <span className="cue-light bg-go-500" /> All clear — nothing needs your attention right now.
          </div>
        ) : (
          <ul className="divide-y divide-dashed divide-ink-200">
            {data.issues.map((i) => {
              const sev = SEVERITY[i.severity] || SEVERITY.LOW;
              return (
                <li
                  key={`${i.kind}-${i.id}`}
                  className="grid grid-cols-[auto_1fr] gap-x-3.5 px-5 py-3.5 transition hover:bg-ink-50/60 sm:grid-cols-[auto_1fr_auto]"
                >
                  <span className={`cue-light mt-1.5 h-2.5 w-2.5 ${sev.dot} ${sev.pulse ? "animate-cue-blink" : ""}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={`font-mono text-[10.5px] font-semibold uppercase tracking-label ${sev.text}`}>
                        {i.severity.toLowerCase()}
                      </span>
                      <span className="text-[14px] font-semibold text-ink-900">{i.title}</span>
                      <span className="text-[11.5px] text-ink-400">{human({}, i.status)}</span>
                    </div>
                    {i.evidence && (
                      <p className="mt-1.5 break-words border-l-2 border-ink-200 pl-2.5 text-[12.5px] italic text-ink-600">
                        “{i.evidence}”
                      </p>
                    )}
                    <p className="mt-1 text-[11.5px] text-ink-500">
                      {i.consequence ? `${i.consequence}. ` : ""}
                      {timeAgo(i.updated_at || i.detected_at) ? `Updated ${timeAgo(i.updated_at || i.detected_at)}` : ""}
                    </p>
                  </div>
                  <Link
                    href={i.action.href}
                    className="btn-secondary col-start-2 mt-2 h-8 self-start justify-self-start sm:col-start-3 sm:mt-0"
                  >
                    {i.action.label} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* D. Vendors */}
        <section className="surface flex flex-col">
          <header className="border-b border-ink-200 px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-ink-900">Vendors on the call sheet</h3>
          </header>
          {data.vendors.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-500">No vendors picked yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-label text-ink-400">
                    <th className="px-5 py-2.5 font-medium">Vendor</th>
                    <th className="px-2 py-2.5 font-medium">WhatsApp</th>
                    <th className="px-2 py-2.5 font-medium">Call</th>
                    <th className="px-5 py-2.5 font-medium">Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-ink-200">
                  {data.vendors.map((v) => (
                    <tr key={v.vendor_id} className="hover:bg-ink-50/60">
                      <td className="px-5 py-2.5">
                        <div className="font-semibold text-ink-900">{v.name || "Unnamed vendor"}</div>
                        <div className="text-[11px] capitalize text-ink-500">{(v.category || "").toLowerCase().replace(/_/g, " ")}</div>
                      </td>
                      <td className="px-2 py-2.5 text-ink-700">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`cue-light h-1.5 w-1.5 ${channelDot(v.whatsapp)}`} />
                          {human(WHATSAPP_LABEL, v.whatsapp)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-ink-700">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`cue-light h-1.5 w-1.5 ${channelDot(v.call)}`} />
                          {human(CALL_LABEL, v.call)}
                        </span>
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`chip ${
                            v.commitment === "CONFIRMED"
                              ? "border-go-200 bg-go-50 text-go-700"
                              : v.commitment === "CANCELLED"
                              ? "border-cue-200 bg-cue-50 text-cue-700"
                              : "border-ink-200 bg-ink-100/70 text-ink-600"
                          }`}
                        >
                          {human(COMMITMENT_LABEL, v.commitment)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-auto border-t border-ink-200 px-5 py-2.5 text-[11.5px] text-ink-500">
            A sent or read message does not mean the vendor is booked. Booking shows “Confirmed” only when it is recorded.
          </p>
        </section>

        {/* E. Run of show */}
        <section className="surface">
          <header className="border-b border-ink-200 px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-ink-900">Run of show</h3>
          </header>
          {data.milestones.length > 0 && (
            <div className="border-b border-ink-200 bg-ink-50/60 px-5 py-3">
              <div className="eyebrow mb-2">Coming up · critical</div>
              <ul className="space-y-1.5">
                {data.milestones.map((m) => (
                  <li key={m.task_id} className="grid grid-cols-[64px_1fr] items-baseline gap-2 text-[13px]">
                    <span className="timecode text-[12px] font-semibold text-cue-700">
                      {m.planned_start ? clock(m.planned_start) : "--:--"}
                    </span>
                    <span className="font-medium text-ink-800">
                      {m.name}
                      {m.planned_start && (
                        <span className="ml-1.5 text-[11px] font-normal text-ink-400">
                          {parseUtc(m.planned_start).toLocaleDateString([], { day: "2-digit", month: "short" })}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.timeline.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-500">No activity yet.</p>
          ) : (
            <ol className="relative px-5 py-4">
              <span className="absolute bottom-5 left-[86px] top-5 w-px bg-ink-200" aria-hidden />
              {data.timeline.map((t) => (
                <li key={t.id} className="relative grid grid-cols-[56px_1fr] gap-x-6 pb-3.5 last:pb-0">
                  <span className="timecode pt-px text-[12px] text-ink-500" title={timeAgo(t.at) || undefined}>
                    {clock(t.at)}
                  </span>
                  <span
                    className={`absolute left-[63px] top-[5px] h-2 w-2 rounded-full ring-4 ring-[#FDFCFA] ${
                      t.needs_review ? "bg-standby-500" : "bg-ink-400"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-ink-800">{t.summary}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
                      <span>{t.actor}</span>
                      <span>·</span>
                      <span>{timeAgo(t.at)}</span>
                      {t.needs_review && <span className="font-semibold text-standby-700">needs review</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
