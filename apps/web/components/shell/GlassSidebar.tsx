"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEventStore, getActiveEventId } from "@/stores/eventStore";
import {
  LayoutDashboard,
  PlusCircle,
  Compass,
  Settings,
  Building2,
  Users,
  CalendarCheck,
  CheckSquare,
  Clock,
  DollarSign,
  MessageSquare,
  Radio,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  History,
  FileText,
  X,
} from "lucide-react";

interface GlassSidebarProps {
  onClose?: () => void;
  className?: string;
}


export function GlassSidebar({ onClose, className = "" }: GlassSidebarProps) {
  const pathname = usePathname();
  const params = useParams();
  const activeEventId = useEventStore((state) => state.activeEventId);
  const eventId = (params?.eventId as string) || activeEventId || getActiveEventId() || "conference_demo";
  const hasEventContext = Boolean(params?.eventId) || Boolean(activeEventId);

  const navigationSections = [
    {
      title: "Workspace",
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "Event Overview", href: `/events/${eventId}`, icon: Compass },
        { label: "Team & Permissions", href: `/events/${eventId}/collaborators`, icon: Users },
      ],
    },
    {
      title: "Live Operations",
      items: [
        { label: "Live Command Cockpit", href: `/events/${eventId}/live`, icon: Radio, isLive: true },
        { label: "Comms & Vendor Calls", href: `/events/${eventId}/conversations`, icon: MessageSquare },
        { label: "Incidents & Blast Radius", href: `/events/${eventId}/incidents`, icon: AlertTriangle },
        { label: "Recovery Simulator", href: `/events/${eventId}/recovery`, icon: RotateCcw },
        { label: "Approvals & Sign-Offs", href: `/events/${eventId}/approvals`, icon: ShieldCheck },
      ],
    },
    {
      title: "Planning & Resources",
      items: [
        { label: "Schedule & Critical Path", href: `/events/${eventId}/schedule`, icon: Clock },
        { label: "Tasks & Execution", href: `/events/${eventId}/tasks`, icon: CheckSquare },
        { label: "Budget & Variance", href: `/events/${eventId}/budget`, icon: DollarSign },
        { label: "Venues & Spaces", href: `/events/${eventId}/venue`, icon: Building2 },
        { label: "Vendors & Outreach", href: `/events/${eventId}/vendors`, icon: Users },
      ],
    },
    {
      title: "Telemetry & Audit",
      items: [
        { label: "Activity Stream", href: `/events/${eventId}/activity`, icon: History },
        { label: "Audit Ledger", href: `/events/${eventId}/audit`, icon: FileText },
      ],
    },
  ];

  return (
    <aside
      className={`w-64 h-full flex flex-col bg-white border-r border-slate-200 text-slate-700 select-none ${className}`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <Link href="/" className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#D6003C] flex items-center justify-center text-white shadow-sm">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
              <circle cx="12" cy="12" r="2.5" fill="white"></circle>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-slate-900 leading-none">
              EVENTRA
            </span>
            <span className="text-[9px] text-slate-500 font-medium tracking-wider uppercase mt-1">
              OPERATIONS PLATFORM
            </span>
          </div>
        </Link>

        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navigationSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">
              {section.title}
            </div>
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    active
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${
                        active ? "text-[#D6003C]" : "text-slate-400 group-hover:text-slate-600"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.isLive && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D6003C]" />
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/50">
        <div className="text-[11px] text-slate-500 font-mono truncate">
          {hasEventContext ? `Event: ${eventId.slice(0, 14)}` : "Fleet Management"}
        </div>
      </div>
    </aside>
  );
}
