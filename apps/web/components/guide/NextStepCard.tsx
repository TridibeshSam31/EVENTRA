"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  ClipboardList,
  Flag,
  LifeBuoy,
  MessageSquare,
  PartyPopper,
  Radio,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Celebrate } from "@/components/ds/motion";
import { useGuideStore } from "@/stores/guideStore";
import { STAGE_LABEL, STAGE_ORDER, type NextStep } from "@/lib/api/guidance";

const STAGE_ICON: Record<string, LucideIcon> = {
  DEFINE: ClipboardList,
  DISCOVER: Search,
  CONTACT: MessageSquare,
  DECIDE: ShieldCheck,
  PLAN: CalendarCheck,
  READY: Flag,
  LIVE: Radio,
  RECOVER: LifeBuoy,
  DONE: PartyPopper,
};

const SPRING = { type: "spring" as const, stiffness: 380, damping: 30 };

function stepProgress(step: NextStep): { n: number; total: number } {
  if (step.progress && step.progress.total > 0) {
    return { n: Math.min(step.progress.total, step.progress.done + 1), total: step.progress.total };
  }
  const idx = STAGE_ORDER.indexOf(step.stage as (typeof STAGE_ORDER)[number]);
  return { n: idx >= 0 ? idx + 1 : STAGE_ORDER.length, total: STAGE_ORDER.length };
}

/* ── The big card ─────────────────────────────────────────── */

export function NextStepCard() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { nextStep: step, cardOpen, doneTitle, minimize, followCta } = useGuideStore();
  const cardRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // Focus management + Esc to minimise + simple focus trap
  useEffect(() => {
    if (!cardOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ctaRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        minimize();
      } else if (e.key === "Tab" && cardRef.current) {
        const nodes = cardRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])");
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [cardOpen, minimize]);

  if (!step) return null;
  const critical = step.urgency === "critical";
  const Icon = STAGE_ICON[step.stage] ?? Flag;
  const { n, total } = stepProgress(step);

  const go = () => {
    followCta();
    router.push(step.path);
  };

  return (
    <AnimatePresence>
      {cardOpen && (
        <motion.div
          key="guide-overlay"
          className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop — click minimises (never loses the step) */}
          <button
            type="button"
            aria-label="Minimise next step"
            onClick={minimize}
            className="absolute inset-0 cursor-default bg-ink-950/50 backdrop-blur-[3px]"
          />

          <motion.div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            aria-describedby="guide-body"
            className="relative w-full max-w-[560px] overflow-hidden rounded-3xl bg-[#FDFCFA] shadow-[0_40px_100px_-30px_rgba(16,14,12,0.7)] ring-1 ring-black/10"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            transition={SPRING}
          >
            {/* Stage banner */}
            <div
              className={`relative overflow-hidden px-6 pb-6 pt-5 sm:px-8 ${
                critical ? "bg-gradient-to-br from-cue-700 via-cue-800 to-ink-950" : "bg-ink-950"
              }`}
            >
              <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
              <div
                className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-60 blur-2xl"
                style={{
                  background: critical
                    ? "radial-gradient(circle, rgba(255,146,168,0.45), transparent 65%)"
                    : "radial-gradient(circle, rgba(214,0,60,0.35), transparent 65%)",
                }}
                aria-hidden
              />

              <div className="relative flex items-center justify-between">
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-300">
                  <span className={`cue-light ${critical ? "bg-cue-300 animate-cue-blink" : "bg-cue-500 animate-cue-blink"}`} />
                  {critical ? "Needs you now" : "Your next step"}
                </span>
                <button
                  type="button"
                  onClick={minimize}
                  className="rounded-full p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white"
                  aria-label="Not now"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="relative mt-5 flex items-end gap-5">
                <motion.span
                  className={`grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[26px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_18px_40px_-12px_rgba(214,0,60,0.7)] ${
                    critical ? "bg-white/15 ring-1 ring-white/30" : "bg-cue-600"
                  }`}
                  initial={reduce ? false : { rotate: -8, scale: 0.8 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ ...SPRING, delay: 0.08 }}
                >
                  <Icon className="h-10 w-10" strokeWidth={1.8} />
                </motion.span>
                <div className="min-w-0 pb-1">
                  <div className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-ink-400" style={{ fontStretch: "85%" }}>
                    {STAGE_LABEL[step.stage] ?? step.stage}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5" aria-label={`Step ${n} of ${total}`}>
                    {Array.from({ length: total }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                          i < n - 1 ? "w-4 bg-go-400" : i === n - 1 ? "w-7 bg-white" : "w-4 bg-white/20"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 font-mono text-[11px] text-ink-400">
                    Step {n} of {total}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 pb-6 pt-5 sm:px-8 sm:pb-7">
              {doneTitle && (
                <div className="mb-4 flex flex-wrap items-center gap-2.5">
                  <Celebrate show label="Done" />
                  <span className="text-[13px] text-ink-600">{doneTitle}</span>
                </div>
              )}

              <div className="flex items-start justify-between gap-3">
                <h2
                  id="guide-title"
                  className="font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink-900 sm:text-[30px]"
                  style={{ fontStretch: "88%" }}
                >
                  {step.title}
                </h2>
                {typeof step.count === "number" && step.count > 0 && (
                  <span
                    className={`mt-1 grid h-9 min-w-9 shrink-0 place-items-center rounded-full px-2 font-display text-[16px] font-bold ${
                      critical ? "bg-cue-600 text-white" : "bg-standby-100 text-standby-800 ring-1 ring-standby-200"
                    }`}
                    aria-label={`${step.count} items`}
                  >
                    {step.count}
                  </span>
                )}
              </div>
              <p id="guide-body" className="mt-2.5 text-[15px] leading-relaxed text-ink-600">
                {step.body}
              </p>

              <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={minimize} className="btn-ghost h-11 justify-center px-4 text-[14px]">
                  Not now
                </button>
                <button
                  ref={ctaRef}
                  type="button"
                  onClick={go}
                  className="btn-cue h-12 justify-center px-6 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_30px_-12px_rgba(214,0,60,0.65)]"
                >
                  {step.cta_label} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-4 text-center text-[12px] text-ink-500 sm:text-left">
                {critical
                  ? "This stays pinned until it's handled."
                  : "You can reopen this anytime from the button at the bottom right."}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── The floating "Next:" pill ────────────────────────────── */

export function NextStepPill() {
  const reduce = useReducedMotion();
  const { nextStep: step, cardOpen, pillHidden, openCard, hidePill } = useGuideStore();
  const visible = !!step && !cardOpen && (!pillHidden || step.urgency === "critical") && step.step_id !== "event_done";
  const critical = step?.urgency === "critical";

  return (
    <AnimatePresence>
      {visible && step && (
        <motion.div
          key="guide-pill"
          className="fixed bottom-4 right-4 z-[65] flex max-w-[calc(100vw-32px)] items-center sm:bottom-6 sm:right-6"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.95 }}
          transition={SPRING}
        >
          <button
            type="button"
            onClick={openCard}
            className={`group flex min-w-0 items-center gap-2.5 rounded-full py-2 pl-3 pr-4 text-left shadow-[0_18px_40px_-14px_rgba(16,14,12,0.6)] ring-1 transition hover:-translate-y-0.5 ${
              critical ? "bg-cue-600 text-white ring-cue-400" : "bg-ink-900 text-ink-50 ring-white/10"
            }`}
            aria-label={`Next step: ${step.title}`}
          >
            <span className={`cue-light ${critical ? "bg-white animate-cue-blink" : "bg-cue-500 animate-cue-blink"}`} />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] opacity-70">Next</span>
            <span className="min-w-0 truncate text-[13px] font-semibold">{step.title}</span>
            {typeof step.count === "number" && step.count > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] font-bold ${critical ? "bg-white/20" : "bg-white/10"}`}>{step.count}</span>
            )}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
          </button>
          {!critical && (
            <button
              type="button"
              onClick={hidePill}
              className="ml-1.5 grid h-7 w-7 place-items-center rounded-full bg-[#FDFCFA] text-ink-500 shadow-md ring-1 ring-ink-200 transition hover:text-ink-900"
              aria-label="Hide next-step reminder"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
