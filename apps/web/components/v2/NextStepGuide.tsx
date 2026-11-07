"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Loader2,
  Search,
  MousePointerClick,
  ShieldCheck,
  MessageSquare,
  PartyPopper,
  AlertTriangle,
  Phone,
  ChevronDown,
} from "lucide-react";
import { AnimatePresence, PresenceItem, AnimatedNumber } from "@/components/ds/motion";
import { JOURNEY_LABEL } from "@/lib/journey";
import type { NextStep } from "@/lib/api/guidance";

/** One thing the organizer has to decide. Built by the page from real backend state. */
export interface NeedsYouItem {
  id: string;
  kind: "incident" | "contact" | "approval" | "pick";
  title: string;
  detail?: string;
  action: {
    label: string;
    href?: string;
    onClick?: () => void;
    busy?: boolean;
    busyLabel?: string;
    disabled?: boolean;
  };
  error?: string | null;
}

interface NextStepGuideProps {
  eventId: string;
  foundCount: number;
  pickedCount: number;
  pendingApprovalsCount: number;
  contactedCount: number;
  isSearching: boolean;
  /** The decisions waiting on the organizer. When provided the guide becomes the single "Needs you" block. */
  items?: NeedsYouItem[];
  /** Authoritative next step (GET /next-step). When there are no decisions, its title/body/CTA replace the local heuristic. */
  nextStep?: NextStep | null;
}

const STEP_NAMES = ["Find", JOURNEY_LABEL.pick, JOURNEY_LABEL.contact, "Hear back"];

const KIND_STYLE: Record<NeedsYouItem["kind"], { icon: React.ComponentType<{ className?: string }>; dot: string; tag: string }> = {
  incident: { icon: AlertTriangle, dot: "bg-cue-600 text-white", tag: "Problem" },
  contact: { icon: Phone, dot: "bg-standby-500 text-white", tag: "Contact" },
  approval: { icon: ShieldCheck, dot: "bg-standby-500 text-white", tag: "Approval" },
  pick: { icon: MousePointerClick, dot: "bg-ink-900 text-ink-50", tag: JOURNEY_LABEL.pick },
};

const VISIBLE = 5;

/**
 * The single "Needs you" block for an event: where you are in the vendor
 * journey, plus every decision that is waiting on you — each with one action.
 * Handled items animate out as the backend state changes.
 */
export function NextStepGuide({
  eventId,
  foundCount,
  pickedCount,
  pendingApprovalsCount,
  contactedCount,
  isSearching,
  items,
  nextStep,
}: NextStepGuideProps) {
  const [showAll, setShowAll] = useState(false);

  let step: {
    n: number;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    body: string;
    link?: { href: string; label: string };
    done?: boolean;
  };

  if (isSearching) {
    step = { n: 1, icon: Loader2, title: "EVENTRA is looking for vendors", body: "This usually takes a minute or two. You can stay on this page." };
  } else if (foundCount === 0) {
    step = { n: 1, icon: Search, title: "Let EVENTRA find vendors for you", body: "Click “Find vendors for me” below. We search for vendors that fit your city, date and budget." };
  } else if (pickedCount === 0) {
    step = { n: 2, icon: MousePointerClick, title: "Pick the vendors you like", body: `Compare the options below and click “${JOURNEY_LABEL.pick}” on the ones you want.` };
  } else if (pendingApprovalsCount > 0) {
    step = { n: 3, icon: ShieldCheck, title: "Say yes to contact them", body: `EVENTRA only messages or calls a vendor after you click “${JOURNEY_LABEL.contact}”.` };
  } else if (contactedCount > 0) {
    step = {
      n: 4,
      icon: MessageSquare,
      title: "See what the vendors said",
      body: "EVENTRA has reached out. Replies, call results and prices show up on each vendor card.",
      link: { href: `/events/${eventId}/conversations`, label: "Open Messages & Calls" },
    };
  } else {
    step = { n: 4, icon: PartyPopper, title: "You're all set", body: "Your vendors are picked. Check back here for replies and updates.", done: true };
  }

  // Prefer the backend's next step for the headline when nothing is waiting on the user.
  if (nextStep && nextStep.step_id !== "event_done") {
    step = {
      ...step,
      title: nextStep.title,
      body: nextStep.body,
      link: { href: nextStep.path, label: nextStep.cta_label },
      done: false,
    };
  } else if (nextStep && nextStep.step_id === "event_done") {
    step = { ...step, title: nextStep.title, body: nextStep.body, done: true, link: undefined };
  }

  const list = items ?? [];
  const hasItems = list.length > 0;
  const visible = showAll ? list : list.slice(0, VISIBLE);
  const hidden = list.length - visible.length;
  const Icon = step.icon;

  return (
    <section className="surface relative overflow-hidden" aria-label="Needs you">
      {/* Header */}
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ${
              hasItems ? "bg-cue-600" : step.done ? "bg-go-600" : "bg-ink-900"
            }`}
          >
            {hasItems ? (
              <span className="font-display text-[17px] font-bold" style={{ fontStretch: "90%" }}>
                <AnimatedNumber value={list.length} />
              </span>
            ) : (
              <Icon className={`h-5 w-5 ${isSearching ? "animate-spin" : ""}`} />
            )}
            {hasItems && (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#FDFCFA] bg-standby-400 animate-cue-blink" aria-hidden />
            )}
          </span>
          <div>
            <p className={`font-mono text-[10.5px] uppercase tracking-label ${hasItems ? "text-cue-600" : "text-ink-500"}`}>
              {hasItems ? "Needs you" : `Step ${step.n} of 4`}
            </p>
            <h3 className="mt-0.5 text-[15px] font-semibold text-ink-900">
              {hasItems
                ? list.length === 1
                  ? "One decision is waiting on you"
                  : `${list.length} decisions are waiting on you`
                : step.title}
            </h3>
            <p className="mt-0.5 max-w-[62ch] text-[13px] text-ink-600">
              {hasItems ? "Most urgent first. Each one has a single next step; nothing happens until you act." : step.body}
            </p>
          </div>
        </div>
        {!hasItems && step.link && (
          <Link href={step.link.href} className="btn-primary shrink-0 self-start sm:self-auto" data-guide-cta={nextStep?.step_id}>
            {step.link.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Decisions */}
      {hasItems && (
        <div role="list" className="border-t border-ink-200">
          <AnimatePresence initial={false}>
            {visible.map((item, i) => {
              const k = KIND_STYLE[item.kind];
              const KIcon = k.icon;
              const a = item.action;
              const btnCls = item.kind === "incident" ? "btn-cue" : item.kind === "pick" ? "btn-secondary" : "btn-primary";
              // Coach-mark anchor: the first item of the kind the guide is pointing at.
              const guideStep =
                item.kind === "pick" && list.findIndex((x) => x.kind === "pick") === list.indexOf(item)
                  ? "pick_vendors"
                  : item.kind === "contact" && list.findIndex((x) => x.kind === "contact") === list.indexOf(item)
                  ? "approve_requests"
                  : undefined;
              return (
                <PresenceItem key={item.id}>
                  <div role="listitem" className="group flex flex-col gap-3 border-b border-dashed border-ink-200 px-4 py-3 transition-colors last:border-b-0 hover:bg-ink-50/70 sm:flex-row sm:items-center sm:px-5">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-ink-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${k.dot} transition-transform group-hover:scale-110`}>
                        <KIcon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-ink-900">{item.title}</span>
                          <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">{k.tag}</span>
                        </div>
                        {item.detail && <p className="mt-0.5 text-[12.5px] text-ink-500">{item.detail}</p>}
                        {item.error && (
                          <p role="alert" className="mt-1 text-[12px] font-medium text-cue-700">
                            {item.error}
                          </p>
                        )}
                      </div>
                    </div>
                    {a.href ? (
                      <Link href={a.href} data-guide-step={guideStep} className={`${btnCls} h-8 shrink-0 self-start px-3 text-[12.5px] sm:self-auto`}>
                        {a.label} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        data-guide-step={guideStep}
                        onClick={a.onClick}
                        disabled={a.busy || a.disabled}
                        className={`${btnCls} h-8 shrink-0 self-start px-3 text-[12.5px] sm:self-auto`}
                      >
                        {a.busy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {a.busyLabel || "Working…"}
                          </>
                        ) : (
                          a.label
                        )}
                      </button>
                    )}
                  </div>
                </PresenceItem>
              );
            })}
          </AnimatePresence>
          {hidden > 0 && (
            <div className="px-5 py-2">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-600 hover:text-ink-900"
              >
                Show {hidden} more <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Journey progress strip */}
      <ol className="grid grid-cols-4 border-t border-ink-200 bg-ink-100/40" aria-label="Vendor journey">
        {STEP_NAMES.map((label, i) => {
          const n = i + 1;
          const passed = n < step.n || step.done;
          const current = n === step.n && !step.done;
          return (
            <li
              key={label}
              className={`relative flex items-center gap-2 overflow-hidden px-3 py-2 text-[11.5px] sm:px-5 ${i > 0 ? "border-l border-ink-200" : ""} ${
                current ? "font-semibold text-ink-900" : passed ? "text-ink-600" : "text-ink-400"
              }`}
              aria-current={current ? "step" : undefined}
            >
              {current && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-cue-500" aria-hidden />}
              <span className={`cue-light ${current ? "bg-cue-600 animate-cue-blink" : passed ? "bg-go-500" : "bg-ink-300"}`} />
              <span className="truncate">{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
