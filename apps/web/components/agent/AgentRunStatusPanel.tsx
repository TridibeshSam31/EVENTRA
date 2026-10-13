"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Hand,
  Loader2,
  Navigation,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { deriveRunView, describeEvent, isExecuting, type RunLifecycle, type RunView } from "@/lib/agentRun/view";

const LIFECYCLE_LABEL: Record<RunLifecycle, string> = {
  idle: "No agent run",
  running: "Agent running",
  cancelling: "Cancelling…",
  awaiting_selection: "Awaiting your selection",
  awaiting_approval: "Approval required",
  completed: "Run completed",
  failed: "Run failed",
  cancelled: "Run cancelled",
  paused: "Run paused",
};

const LIFECYCLE_TONE: Record<RunLifecycle, string> = {
  idle: "bg-slate-50 text-slate-600 border-slate-200",
  running: "bg-blue-50 text-blue-700 border-blue-200",
  cancelling: "bg-slate-100 text-slate-700 border-slate-300",
  awaiting_selection: "bg-amber-50 text-amber-800 border-amber-200",
  awaiting_approval: "bg-amber-50 text-amber-800 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-300",
  paused: "bg-slate-100 text-slate-700 border-slate-300",
};

function LifecycleIcon({ lifecycle }: { lifecycle: RunLifecycle }) {
  switch (lifecycle) {
    case "running":
    case "cancelling":
      return <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />;
    case "awaiting_selection":
    case "awaiting_approval":
      return <Hand className="w-3.5 h-3.5" aria-hidden="true" />;
    case "completed":
      return <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />;
    case "failed":
      return <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />;
    case "cancelled":
    case "paused":
      return <CircleSlash className="w-3.5 h-3.5" aria-hidden="true" />;
    default:
      return <Bot className="w-3.5 h-3.5" aria-hidden="true" />;
  }
}

function formatTime(ts?: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const STATUS_TEXT: Record<string, string> = {
  idle: "Not started",
  searching: "Searching…",
  completed: "Done",
  empty: "No results",
  failed: "Did not finish",
};

function WorkflowSummary({ view, eventId }: { view: RunView; eventId: string }) {
  const rows: { key: string; label: string; status: string; detail?: string; href: string }[] = [];
  if (view.venue.status !== "idle") {
    rows.push({
      key: "venue",
      label: "Venues",
      status: view.venue.status,
      detail: view.venue.status === "completed" ? `${view.venue.candidates.length} recommended` : undefined,
      href: `/events/${eventId}/venue`,
    });
  }
  for (const p of view.providers) {
    rows.push({
      key: p.category,
      label: p.category.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
      status: p.status,
      detail:
        p.status === "completed" && p.counts
          ? `${p.counts.qualified ?? 0} qualified · ${p.counts.pending_verification ?? 0} unverified · ${p.counts.rejected ?? 0} rejected`
          : undefined,
      href: `/events/${eventId}/vendors`,
    });
  }
  for (const c of view.communications) {
    const last = c.updates[c.updates.length - 1];
    rows.push({
      key: `comm-${c.key}`,
      label: c.candidateName ?? "Outreach",
      status: "comm",
      detail: last ? `${last.channel ? `${last.channel}: ` : ""}${last.status.toLowerCase()}` : undefined,
      href: c.assignmentId ? `/events/${eventId}/negotiations/${c.assignmentId}` : `/events/${eventId}/conversations`,
    });
  }
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <Link href={r.href} className="font-semibold text-slate-800 hover:underline truncate">
            {r.label}
          </Link>
          <span className="text-slate-500 text-right">
            {r.status === "comm" ? r.detail : STATUS_TEXT[r.status] ?? r.status}
            {r.status !== "comm" && r.detail ? <span className="block text-[11px] text-slate-400">{r.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * App-level agent status: visible on every page, restores from the backend on
 * load, streams live progress, and drives (non-intrusive) auto-navigation.
 */
export function AgentRunStatusPanel({ eventId }: { eventId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hydrate = useAgentRunStore((s) => s.hydrate);
  const storeEventId = useAgentRunStore((s) => s.eventId);
  const run = useAgentRunStore((s) => s.run);
  const events = useAgentRunStore((s) => s.events);
  const starting = useAgentRunStore((s) => s.starting);
  const connection = useAgentRunStore((s) => s.connection);
  const cancelling = useAgentRunStore((s) => s.cancelling);
  const cancelRun = useAgentRunStore((s) => s.cancelRun);
  const autoNavigate = useAgentRunStore((s) => s.autoNavigate);
  const setAutoNavigate = useAgentRunStore((s) => s.setAutoNavigate);
  const pendingNav = useAgentRunStore((s) => s.pendingNav);
  const resolvePendingNav = useAgentRunStore((s) => s.resolvePendingNav);
  const suggestion = useAgentRunStore((s) => s.suggestion);
  const dismissSuggestion = useAgentRunStore((s) => s.dismissSuggestion);
  const navSuppressed = useAgentRunStore((s) => s.navSuppressed);

  useEffect(() => {
    if (eventId) void hydrate(eventId);
  }, [eventId, hydrate]);

  // Auto-navigation: consume live navigation requests from the run stream.
  useEffect(() => {
    if (!pendingNav) return;
    const path = resolvePendingNav(pathname);
    if (path) router.push(path);
  }, [pendingNav, pathname, resolvePendingNav, router]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const view = useMemo(() => (run ? deriveRunView(run, events) : null), [run, events]);
  const timeline = useMemo(
    () =>
      events
        .map((ev) => ({ ev, text: describeEvent(ev) }))
        .filter((x): x is { ev: typeof x.ev; text: string } => Boolean(x.text))
        .slice(-15)
        .reverse(),
    [events]
  );

  if (storeEventId !== eventId || (!run && !starting)) return null;

  const lifecycle: RunLifecycle = view?.lifecycle ?? "running";
  const pillLabel = starting && !run ? "Starting agent…" : LIFECYCLE_LABEL[lifecycle];
  const phaseLabel = view?.phase?.label;

  return (
    <div className="relative flex items-center gap-2" ref={containerRef}>
      {suggestion && (
        <div className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Navigation className="w-3 h-3" aria-hidden="true" />
          <Link href={suggestion.path} onClick={dismissSuggestion} className="hover:underline">
            Agent is on: {suggestion.label}
          </Link>
          <button onClick={dismissSuggestion} aria-label="Dismiss suggestion" className="ml-0.5 text-indigo-400 hover:text-indigo-700">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Agent status: ${pillLabel}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${LIFECYCLE_TONE[lifecycle]}`}
      >
        <LifecycleIcon lifecycle={starting && !run ? "running" : lifecycle} />
        <span className="max-w-[14rem] truncate">{lifecycle === "running" && phaseLabel ? phaseLabel : pillLabel}</span>
        <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>

      {open && view && run && (
        <div
          role="dialog"
          aria-label="Agent run status"
          className="absolute right-0 top-9 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-50 p-4 space-y-3 text-slate-800"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold">{LIFECYCLE_LABEL[lifecycle]}</p>
              <p className="text-[11px] text-slate-500 font-mono">{run.run_id}</p>
            </div>
            <span
              className="inline-flex items-center gap-1 text-[11px] text-slate-500"
              title="Live progress connection"
            >
              {connection === "live" ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-600" aria-hidden="true" /> Live
                </>
              ) : connection === "connecting" || connection === "reconnecting" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> {connection === "reconnecting" ? "Reconnecting" : "Connecting"}
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" aria-hidden="true" /> Not streaming
                </>
              )}
            </span>
          </div>

          {isExecuting(lifecycle) && phaseLabel && (
            <p className="text-xs text-slate-700">
              {phaseLabel}
              {view.activeTool ? <span className="text-slate-400"> · {view.activeTool.replace(/_/g, " ")}</span> : null}
            </p>
          )}

          {lifecycle === "failed" && view.error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md p-2">{view.error}</p>
          )}

          {lifecycle === "awaiting_selection" && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md p-2">
              Discovery finished. Review the recommendations and select providers; no one has been contacted yet.
            </p>
          )}

          {lifecycle === "awaiting_approval" && (
            <Link
              href={view.approval?.approvalId ? `/events/${eventId}/approvals/${view.approval.approvalId}` : `/events/${eventId}/approvals`}
              className="block text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md p-2 hover:underline"
            >
              The agent is waiting for an approval before it continues.
            </Link>
          )}

          <WorkflowSummary view={view} eventId={eventId} />

          {timeline.length > 0 && (
            <ol className="max-h-48 overflow-y-auto space-y-1 text-[11px]" aria-label="Agent activity">
              {timeline.map(({ ev, text }) => (
                <li key={ev.id} className="flex gap-2">
                  <span className="text-slate-400 font-mono shrink-0">{formatTime(ev.timestamp)}</span>
                  <span className="text-slate-700">{text}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={autoNavigate}
                onChange={(e) => setAutoNavigate(e.target.checked)}
              />
              Follow the agent between pages{navSuppressed && autoNavigate ? " (paused for this run)" : ""}
            </label>
            {isExecuting(lifecycle) && (
              <button
                onClick={() => void cancelRun()}
                disabled={cancelling || lifecycle === "cancelling"}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {lifecycle === "cancelling" ? "Cancelling…" : "Cancel run"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
