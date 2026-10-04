"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEventStore, getActiveEventId } from "@/stores/eventStore";
import { Menu, X, Bell, UserCircle, Radio, Sparkles } from "lucide-react";
import { EventSwitcher } from "./EventSwitcher";
import { GlassSidebar } from "./GlassSidebar";
import { PushNotificationBanner } from "@/components/notifications";

export function AppShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const activeEventId = useEventStore((state) => state.activeEventId);
  const eventId = (params?.eventId as string) || activeEventId || getActiveEventId() || "conference_demo";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isApprovalsPage = pathname ? pathname.includes("/approvals") : false;

  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex flex-shrink-0 h-full">
        <GlassSidebar />
      </div>

      {/* Mobile Sidebar Overlay Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white shadow-xl z-50 animate-in slide-in-from-left duration-200">
            <GlassSidebar onClose={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Operational Container */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-50">
        {/* Top Operational Bar */}
        <header className="h-14 border-b border-slate-200 bg-white px-4 sm:px-6 flex items-center justify-between flex-shrink-0 z-20">
          <div className="flex items-center space-x-3">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Quick Event Switcher */}
            <div className="w-56 sm:w-64">
              <EventSwitcher />
            </div>
          </div>

          {/* Right Action / System Status */}
          <div className="flex items-center space-x-2">
            <Link
              href={`/events/${eventId}/live`}
              className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
              title="System Operational Status"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>SYSTEM ACTIVE</span>
            </Link>

            <button
              className="p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200 text-xs font-medium text-slate-600">
              <UserCircle className="w-5 h-5 text-slate-400" />
              <span className="hidden md:inline">Operations Lead</span>
            </div>
          </div>
        </header>

        {/* Scrollable Workspace Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          {!isApprovalsPage && (
            <div className="px-4 pt-4 sm:px-6 max-w-7xl mx-auto">
              <PushNotificationBanner />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
