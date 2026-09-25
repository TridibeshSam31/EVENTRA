"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Sparkles,
  Settings,
  Building2,
  CalendarCheck,
  CheckSquare,
  Clock,
  DollarSign,
  Users,
  Radio,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  BarChart3,
  History,
  FileText,
  Compass,
} from "lucide-react";
import { EventSwitcher } from "./EventSwitcher";

export function DesktopSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  const isCurrentEventPath = pathname.startsWith(`/events/${eventId}`);

  const globalNav = [
    { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { label: "Events", href: "/events", icon: Layers },
  ];

  const eventNav = [
    { label: "Overview", href: `/events/${eventId}`, icon: Sparkles },
    { label: "Execution Plan", href: `/events/${eventId}/execution-plan`, icon: Compass },
    { label: "Setup", href: `/events/${eventId}/setup`, icon: Settings },
    { label: "Venue", href: `/events/${eventId}/venue`, icon: Building2 },
    { label: "Plan", href: `/events/${eventId}/plan`, icon: CalendarCheck },
    { label: "Tasks", href: `/events/${eventId}/tasks`, icon: CheckSquare },
    { label: "Schedule", href: `/events/${eventId}/schedule`, icon: Clock },
    { label: "Budget", href: `/events/${eventId}/budget`, icon: DollarSign },
    { label: "Providers", href: `/events/${eventId}/vendors`, icon: Users },
    {
      label: "Live Operations",
      href: `/events/${eventId}/live`,
      icon: Radio,
      isLive: true,
    },
    { label: "Incidents", href: `/events/${eventId}/incidents`, icon: AlertTriangle },
    { label: "Recovery", href: `/events/${eventId}/recovery`, icon: RotateCcw },
    { label: "Approvals", href: `/events/${eventId}/approvals`, icon: ShieldCheck },
    { label: "Analytics", href: `/events/${eventId}/analytics`, icon: BarChart3 },
    { label: "Activity", href: `/events/${eventId}/activity`, icon: History },
    { label: "Audit", href: `/events/${eventId}/audit`, icon: FileText },
  ];

  return (
    <aside className="w-64 border-r border-slate-800 bg-[#090d16] flex flex-col h-screen select-none flex-shrink-0">
      {/* Brand Header */}
      <div className="h-14 border-b border-slate-800 px-4 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center font-bold text-white tracking-widest text-sm shadow-lg shadow-blue-600/30">
            E
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-wider text-slate-100 flex items-center space-x-1.5">
              <span>EVENTRA</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800 font-mono">
                OPS
              </span>
            </div>
            <div className="text-[9px] text-slate-400 font-medium tracking-tight">
              ADAPTIVE OPERATIONS
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Global Nav */}
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2.5 mb-1.5">
            Fleet Control
          </div>
          <div className="space-y-0.5">
            {globalNav.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-2.5 px-3 py-2 rounded-md text-xs font-medium transition ${
                    active
                      ? "bg-slate-800 text-white font-semibold shadow-inner"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? "text-blue-400" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Current Event Context & Nav */}
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2.5 mb-2 flex items-center justify-between">
            <span>Current Event</span>
            {isCurrentEventPath && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>

          <div className="mb-3">
            <EventSwitcher />
          </div>

          <div className="space-y-0.5">
            {eventNav.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;

              if (item.isLive) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center justify-between px-3 py-2.5 my-1.5 rounded-lg text-xs font-bold transition border ${
                      active
                        ? "bg-emerald-950/40 text-emerald-300 border-emerald-600/60 shadow-lg shadow-emerald-950/50"
                        : "bg-emerald-950/20 text-emerald-400 border-emerald-800/40 hover:bg-emerald-900/30 hover:border-emerald-700"
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className="relative">
                        <Icon className="w-4 h-4 text-emerald-400" />
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
                      </div>
                      <span className="tracking-wide">{item.label}</span>
                    </div>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      LIVE
                    </span>
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    active
                      ? "bg-slate-800 text-blue-300 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/80"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      active ? "text-blue-400" : "text-slate-400"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer System Status */}
      <div className="border-t border-slate-800 p-3 bg-slate-950/70">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>CORE ENGINE</span>
          </div>
          <span className="text-slate-400">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
