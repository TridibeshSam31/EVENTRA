"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleDashed, Loader, OctagonAlert, Minus } from "lucide-react";
import { useGuideStore } from "@/stores/guideStore";
import { pagePath, type ReadinessGate } from "@/lib/api/guidance";
import { StaggerList } from "@/components/ds/motion";

const GATE_STYLE: Record<
  string,
  { chip: string; icon: React.ComponentType<{ className?: string }>; label: string; dot: string }
> = {
  done: { chip: "border-go-200 bg-go-50 text-go-800", icon: Check, label: "Done", dot: "bg-go-500" },
  in_progress: { chip: "border-standby-200 bg-standby-50 text-standby-800", icon: Loader, label: "In progress", dot: "bg-standby-500" },
  blocked: { chip: "border-cue-200 bg-cue-50 text-cue-800", icon: OctagonAlert, label: "Blocked", dot: "bg-cue-600" },
  not_started: { chip: "border-dashed border-ink-300 bg-transparent text-ink-600", icon: CircleDashed, label: "Not started", dot: "bg-ink-300" },
  not_applicable: { chip: "border-ink-200 bg-ink-100/60 text-ink-500", icon: Minus, label: "Not needed", dot: "bg-ink-300" },
};

const STATUS_COPY: Record<string, { text: string; cls: string }> = {
  NOT_STARTED: { text: "Not started", cls: "text-ink-600" },
  IN_PROGRESS: { text: "On its way", cls: "text-ink-800" },
  AT_RISK: { text: "At risk", cls: "text-standby-700" },
  BLOCKED: { text: "Blocked", cls: "text-cue-700" },
  READY: { text: "Ready", cls: "text-go-700" },
  LIVE: { text: "Live now", cls: "text-go-700" },
  DONE: { text: "Finished", cls: "text-ink-700" },
};

function styleFor(status: string) {
  return GATE_STYLE[status] ?? GATE_STYLE.not_started;
}

function gateHref(eventId: string, gate: ReadinessGate): string | null {
  if (!gate.action) return null;
  return gate.action.path || pagePath(eventId, gate.action.page);
}

/** Compact readiness chips for the event header — the honest progress signal. */
export function ReadinessStrip({ eventId, className = "" }: { eventId: string; className?: string }) {
  const readiness = useGuideStore((s) => (s.eventId === eventId ? s.readiness : null));
  if (!readiness || readiness.gates.length === 0) return null;
  const gates = readiness.gates.filter((g) => g.status !== "not_applicable");
  const done = gates.filter((g) => g.status === "done").length;
  const status = STATUS_COPY[readiness.status] ?? { text: readiness.status, cls: "text-ink-700" };

  return (
    <nav aria-label="Event readiness" className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
        Readiness
        <span className="font-mono text-[12px] text-ink-600">
          {done}/{gates.length}
        </span>
        <span className={`text-[12.5px] ${status.cls}`}>· {status.text}</span>
      </span>
      <ul className="flex flex-wrap items-center gap-1.5">
        {gates.map((g) => {
          const st = styleFor(g.status);
          const Icon = st.icon;
          const href = gateHref(eventId, g);
          const inner = (
            <>
              <Icon className="h-3 w-3" />
              <span>{g.label}</span>
            </>
          );
          const cls = `chip ${st.chip} transition hover:-translate-y-px`;
          return (
            <li key={g.id} title={g.detail || st.label}>
              {href ? (
                <Link href={href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <span className={cls}>{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Full readiness checklist panel (Overview): each gate with detail and its fix. */
export function ReadinessChecklist({ eventId }: { eventId: string }) {
  const readiness = useGuideStore((s) => (s.eventId === eventId ? s.readiness : null));
  if (!readiness || readiness.gates.length === 0) return null;
  const gates = readiness.gates.filter((g) => g.status !== "not_applicable");
  const done = gates.filter((g) => g.status === "done").length;
  const status = STATUS_COPY[readiness.status] ?? { text: readiness.status, cls: "text-ink-700" };
  const pct = gates.length ? Math.round((done / gates.length) * 100) : 0;

  return (
    <section className="surface overflow-hidden" aria-labelledby="readiness-title">
      <header className="flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="readiness-title" className="text-[16px] font-semibold text-ink-900">
            Will this event happen?
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-600">
            {done} of {gates.length} checks are done ·{" "}
            <span className={`font-semibold ${status.cls}`}>{status.text}</span>
            {typeof readiness.days_until_event === "number" && readiness.days_until_event >= 0 && (
              <> · {readiness.days_until_event === 0 ? "today" : `${readiness.days_until_event} days to go`}</>
            )}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-56">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-200/70" aria-hidden>
            <div className="h-full rounded-full bg-go-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[12px] text-ink-600">
            {done}/{gates.length}
          </span>
        </div>
      </header>
      <StaggerList as="ul" className="divide-y divide-dashed divide-ink-200 border-t border-ink-200" gap={0.04}>
        {gates.map((g) => {
          const st = styleFor(g.status);
          const Icon = st.icon;
          const href = gateHref(eventId, g);
          const showAction = g.status !== "done" && g.action && href;
          return (
            <div key={g.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${st.chip}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink-900">{g.label}</span>
                    <span className="text-[12px] text-ink-600">{st.label}</span>
                    {g.progress && g.progress.total > 0 && (
                      <span className="font-mono text-[12px] text-ink-600">
                        {g.progress.done}/{g.progress.total}
                      </span>
                    )}
                  </div>
                  {g.detail && <p className="mt-0.5 text-[13px] text-ink-600">{g.detail}</p>}
                </div>
              </div>
              {showAction && (
                <Link
                  href={href!}
                  className={`${g.status === "blocked" ? "btn-primary" : "btn-secondary"} h-8 shrink-0 self-start px-3 text-[12.5px] sm:self-auto`}
                >
                  {g.action!.label} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          );
        })}
      </StaggerList>
    </section>
  );
}
