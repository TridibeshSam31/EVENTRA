"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEventStore, isRealEventId } from "@/stores/eventStore";
import { useGuideStore } from "@/stores/guideStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { GuidePageId } from "@/lib/api/guidance";
import {
  LayoutGrid,
  Plus,
  Compass,
  Building2,
  Users,
  CalendarCheck,
  CheckSquare,
  Clock,
  Wallet,
  MessageSquare,
  Radio,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  History,
  FileText,
  Globe,
  X,
  UsersRound,
  Eye,
  ChevronDown,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { EventSwitcher } from "./EventSwitcher";
import { BrandMark } from "./BrandMark";

interface GlassSidebarProps {
  onClose?: () => void;
  className?: string;
}

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** guide page id — controls progressive disclosure */
  page?: GuidePageId;
  /** always visible regardless of progress */
  always?: boolean;
};

type NavSection = { title: string; items: NavItem[] };

// Stable empty array: zustand selectors must not return a new reference each render.
const EMPTY: any[] = [];

export function GlassSidebar({ onClose, className = "" }: GlassSidebarProps) {
  const pathname = usePathname();
  const params = useParams();
  const reduce = useReducedMotion();
  const activeEventId = useEventStore((state) => state.activeEventId);
  const routeEventId = typeof params?.eventId === "string" ? params.eventId : null;
  const eventId = isRealEventId(routeEventId) ? routeEventId : isRealEventId(activeEventId) ? activeEventId : null;
  const hasEventContext = !!eventId;

  const nextStep = useGuideStore((s) => (s.eventId === eventId ? s.nextStep : null));
  const showAll = useGuideStore((s) => s.showAll);
  const setShowAll = useGuideStore((s) => s.setShowAll);
  const wsIncidents = useWorkspaceStore((s) => (s.eventId === eventId ? s.incidents : EMPTY));
  const [moreOpen, setMoreOpen] = useState(false);

  const base = `/events/${eventId}`;

  const isActive = (href: string) => {
    if (!pathname) return false;
    const clean = href.split("?")[0];
    if (pathname === clean) return true;
    return clean !== base && clean.startsWith("/events/") && pathname.startsWith(clean + "/");
  };

  // ── What's unlocked ─────────────────────────────────────
  const unlocked: Set<string> | null =
    showAll || !nextStep || !Array.isArray(nextStep.unlocked_pages) ? null : new Set(nextStep.unlocked_pages);
  const hasOpenProblem =
    nextStep?.step_id === "resolve_problem" ||
    (wsIncidents || []).some((i: any) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(String(i?.status || "").toUpperCase()));
  const isVisible = (item: NavItem) => {
    if (!item.page || item.always || unlocked === null) return true;
    if (item.page === "problems" && hasOpenProblem) return true;
    if (isActive(item.href)) return true; // never hide the page you're on
    return unlocked.has(item.page);
  };
  const isNext = (item: NavItem) => !!nextStep && !!item.page && item.page === nextStep.page && nextStep.step_id !== "event_done";

  // Grouped along the event lifecycle so the sidebar itself explains the product.
  const eventSections: NavSection[] = hasEventContext
    ? [
        { title: "This event", items: [{ label: "Overview", href: base, icon: Compass, page: "overview", always: true }] },
        {
          title: "Prepare",
          items: [
            { label: "Vendors", href: `${base}/vendors`, icon: Users, page: "vendors" },
            { label: "Venue", href: `${base}/venue`, icon: Building2, page: "venue" },
            { label: "Plan & Tasks", href: `${base}/plan`, icon: CalendarCheck, page: "plan" },
            { label: "Budget", href: `${base}/budget`, icon: Wallet, page: "budget" },
          ],
        },
        {
          title: "Engage",
          items: [
            { label: "Decisions", href: `${base}/approvals`, icon: ShieldCheck, page: "decisions" },
            { label: "Messages & Calls", href: `${base}/conversations`, icon: MessageSquare, page: "conversations" },
          ],
        },
        {
          title: "Run",
          items: [
            { label: "Day-of", href: `${base}/live`, icon: Radio, page: "live" },
            { label: "Problems", href: `${base}/incidents`, icon: AlertTriangle, page: "problems" },
            { label: "Team", href: `${base}/collaborators`, icon: UsersRound, page: "team", always: true },
          ],
        },
      ]
    : [];

  // Secondary pages always live under "More" (operator-level detail).
  const extraItems: NavItem[] = hasEventContext
    ? [
        { label: "Event details", href: `${base}/setup`, icon: ClipboardList, page: "setup" },
        { label: "Report", href: `${base}/report`, icon: BarChart3, page: "report" },
        { label: "Activity", href: `${base}/activity`, icon: History, page: "activity" },
        { label: "History Log", href: `${base}/audit`, icon: FileText, page: "audit" },
        { label: "Recovery Options", href: `${base}/recovery`, icon: RotateCcw },
        { label: "Schedule", href: `${base}/schedule`, icon: Clock },
        { label: "Tasks", href: `${base}/tasks`, icon: CheckSquare },
        { label: "Browser Assistant", href: `/browser-runtime?eventId=${eventId}`, icon: Globe },
      ]
    : [];

  const visibleSections = eventSections
    .map((s) => ({ ...s, items: s.items.filter(isVisible) }))
    .filter((s) => s.items.length > 0);
  const hiddenMain = eventSections.flatMap((s) => s.items).filter((i) => !isVisible(i));
  const moreItems = [...hiddenMain, ...extraItems];
  const moreHasActive = moreItems.some((i) => isActive(i.href));
  const moreExpanded = moreOpen || moreHasActive;

  const workspaceSection: NavSection = {
    title: "",
    items: [
      { label: "My Events", href: "/dashboard", icon: LayoutGrid },
      { label: "Plan a New Event", href: "/events/new", icon: Plus },
    ],
  };

  const renderItem = (item: NavItem, opts?: { dim?: boolean }) => {
    const active = isActive(item.href);
    const next = isNext(item);
    const Icon = item.icon;
    return (
      <motion.li
        key={item.href}
        layout={!reduce}
        initial={reduce ? false : { opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduce ? undefined : { opacity: 0, x: -8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <Link
          href={item.href}
          onClick={onClose}
          aria-current={active ? "page" : undefined}
          className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
            active
              ? "bg-white/[0.08] font-semibold text-ink-50"
              : next
              ? "bg-cue-600/10 font-semibold text-ink-50 ring-1 ring-cue-500/30 hover:bg-cue-600/15"
              : opts?.dim
              ? "font-medium text-ink-400 hover:bg-white/[0.04] hover:text-ink-100"
              : "font-medium text-ink-300 hover:bg-white/[0.04] hover:text-ink-100"
          }`}
        >
          <span
            className={`absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full transition-all ${
              active ? "bg-cue-500 shadow-[0_0_10px_rgba(232,23,79,0.8)]" : "bg-transparent"
            }`}
            aria-hidden
          />
          <Icon className={`h-4 w-4 shrink-0 transition-colors ${active || next ? "text-cue-400" : "text-ink-500 group-hover:text-ink-300"}`} />
          <span className="truncate">{item.label}</span>
          {next && !active && (
            <span className="ml-auto flex items-center gap-1.5 rounded-full bg-cue-600 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-cue-blink" aria-hidden />
              Next
            </span>
          )}
        </Link>
      </motion.li>
    );
  };

  return (
    <aside className={`relative flex h-full w-[248px] select-none flex-col overflow-hidden bg-ink-950 text-ink-300 ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(214,0,60,0.35), transparent 70%)" }}
        aria-hidden
      />

      {/* Brand */}
      <div className="relative flex items-center justify-between px-4 pb-3 pt-4">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="EVENTRA home">
          <BrandMark className="h-7 w-7" />
          <span className="font-display text-[15px] font-extrabold tracking-[0.08em] text-ink-50" style={{ fontStretch: "88%" }}>
            EVENTRA
          </span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-200 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Event context */}
      <div className="relative px-3 pb-2">
        <EventSwitcher tone="dark" />
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 space-y-4 overflow-y-auto px-3 py-3" aria-label="Primary">
        <ul className="space-y-px">
          <AnimatePresence initial={false}>{workspaceSection.items.map((i) => renderItem(i))}</AnimatePresence>
        </ul>

        {visibleSections.map((section) => (
          <div key={section.title}>
            <div className="mb-1 flex items-center gap-2 px-2.5">
              <span className="text-[11px] font-semibold text-ink-500">{section.title}</span>
              <span className="h-px flex-1 bg-white/[0.06]" />
            </div>
            <ul className="space-y-px">
              <AnimatePresence initial={false}>{section.items.map((i) => renderItem(i))}</AnimatePresence>
            </ul>
          </div>
        ))}

        {hasEventContext && unlocked !== null && hiddenMain.length > 0 && (
          <p className="px-2.5 text-[11.5px] leading-snug text-ink-500">
            More pages appear as your event moves forward.
          </p>
        )}

        {moreItems.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreExpanded}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-ink-500 transition hover:bg-white/[0.04] hover:text-ink-200"
            >
              More pages
              <span className="font-mono text-[11px] text-ink-600">{moreItems.length}</span>
              <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${moreExpanded ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {moreExpanded && (
                <motion.ul
                  className="mt-1 space-y-px overflow-hidden"
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduce ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {moreItems.map((i) => renderItem(i, { dim: true }))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </nav>

      {/* Footer */}
      {hasEventContext && (
        <div className="relative border-t border-white/[0.06] p-3">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[12px] font-medium text-ink-400 transition-colors hover:bg-white/[0.04] hover:text-ink-100"
            aria-pressed={showAll}
          >
            <span className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5" />
              Show all pages
            </span>
            <span className={`relative h-[18px] w-8 rounded-full transition-colors ${showAll ? "bg-cue-600" : "bg-white/10"}`}>
              <span className={`absolute top-[3px] h-3 w-3 rounded-full bg-white shadow transition-all ${showAll ? "left-[17px]" : "left-[3px]"}`} />
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
