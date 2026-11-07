"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEventStore, getActiveEventId, isRealEventId } from "@/stores/eventStore";
import { Menu, Bell } from "lucide-react";
import { GlassSidebar } from "./GlassSidebar";
import { BrandMark } from "./BrandMark";
import { PushNotificationBanner } from "@/components/notifications";
import { AgentRunStatusPanel } from "@/components/agent/AgentRunStatusPanel";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { DemoModeBanner } from "./DemoModeBanner";
import { GuideLayer } from "@/components/guide/GuideLayer";

// Human names for the current section, shown as a quiet breadcrumb in the top bar.
const SECTION_LABELS: Record<string, string> = {
  dashboard: "My events",
  new: "Plan a new event",
  vendors: "Vendors",
  plan: "Plan & tasks",
  budget: "Budget",
  conversations: "Messages & calls",
  approvals: "Decisions",
  live: "Day-of",
  collaborators: "Team",
  incidents: "Problems",
  report: "Report",
  recovery: "Recovery options",
  schedule: "Schedule",
  tasks: "Tasks",
  venue: "Venue",
  activity: "Activity",
  audit: "History log",
  setup: "Event details",
  negotiations: "Negotiations",
  procurement: "Procurement",
  analytics: "Analytics",
  notifications: "Notifications",
};

function sectionFromPath(pathname: string | null): string {
  if (!pathname) return "";
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "dashboard") return SECTION_LABELS.dashboard;
  if (parts[0] === "events" && parts[1] === "new") return SECTION_LABELS.new;
  if (parts[0] === "events" && parts.length === 2) return "Overview";
  const seg = parts[2];
  return (seg && SECTION_LABELS[seg]) || "";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const activeEventId = useEventStore((state) => state.activeEventId);
  // The event on this route; falls back to the active (real) event for the top bar only — never a demo id.
  const routeEventId = typeof params?.eventId === "string" && isRealEventId(params.eventId) ? params.eventId : null;
  const fallbackId = isRealEventId(activeEventId) ? activeEventId : getActiveEventId() || null;
  const eventId: string | null = routeEventId || fallbackId;
  const liveConnected = useWorkspaceStore((s) => s.sseConnected && s.eventId === eventId);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isApprovalsPage = pathname ? pathname.includes("/approvals") : false;
  const section = sectionFromPath(pathname);

  // Close the mobile drawer on navigation / Escape
  useEffect(() => setMobileMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-ink-950 font-sans text-ink-900">
      {/* Desktop sidebar */}
      <div className="hidden h-full flex-shrink-0 lg:flex">
        <GlassSidebar />
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-ink-950/60 backdrop-blur-sm animate-[workspace-fade-in_200ms_ease-out]"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 flex h-full w-[248px] max-w-[85vw] animate-rise-in shadow-2xl">
            <GlassSidebar onClose={() => setMobileMenuOpen(false)} className="w-full" />
          </div>
        </div>
      )}

      {/* Main column — the paper sheet sits on the ink frame */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden lg:py-2 lg:pr-2">
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-paper lg:rounded-2xl lg:ring-1 lg:ring-black/20">
          {/* Top bar */}
          <header className="relative z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-ink-200/80 bg-paper/85 px-3 backdrop-blur-md sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-md p-2 text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <Link href="/dashboard" className="flex items-center gap-2 lg:hidden" aria-label="EVENTRA">
                <BrandMark className="h-6 w-6" glow={false} />
              </Link>
              {section && (
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <span className="hidden font-mono text-[10.5px] uppercase tracking-label text-ink-400 sm:inline">
                    Eventra
                  </span>
                  <span className="hidden text-ink-300 sm:inline">/</span>
                  <span className="truncate font-semibold text-ink-800">{section}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {eventId && <AgentRunStatusPanel eventId={eventId} />}

              {/* Reflects the real live-update connection, never a hardcoded "active" */}
              {routeEventId && (
              <span
                className={`hidden items-center gap-2 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold sm:inline-flex ${
                  liveConnected
                    ? "border-go-200 bg-go-50 text-go-700"
                    : "border-ink-200 bg-ink-100/70 text-ink-500"
                }`}
                title={
                  liveConnected
                    ? "This page updates automatically"
                    : "Not receiving live updates. Refresh the page to see the latest."
                }
              >
                <span className={`cue-light ${liveConnected ? "bg-go-500 animate-cue-blink" : "bg-ink-400"}`} />
                {liveConnected ? "Live" : "Offline"}
              </span>
              )}

              {routeEventId && (
                <Link
                  href={`/events/${routeEventId}/notifications`}
                  className="rounded-md p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
                  aria-label="Notification settings"
                  title="Notification settings"
                >
                  <Bell className="h-4 w-4" />
                </Link>
              )}

              <div className="ml-0.5 flex items-center gap-2 border-l border-ink-200 pl-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-900 font-display text-[11px] font-bold text-ink-50">
                  OL
                </span>
                <span className="hidden text-[12.5px] font-semibold text-ink-700 md:inline">Operations Lead</span>
              </div>
            </div>
          </header>

          {/* Scrollable workspace */}
          <DemoModeBanner />
          <main className="flex-1 overflow-y-auto">
            {!isApprovalsPage && (
              <div className="mx-auto max-w-7xl px-4 pt-4 empty:hidden sm:px-6">
                <PushNotificationBanner />
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {/* Guided journey: the big "next step" card, the floating pill and coach marks */}
      <GuideLayer eventId={routeEventId} pathname={pathname} />
    </div>
  );
}
