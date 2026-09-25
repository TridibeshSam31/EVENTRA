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
} from "lucide-react";

export function GlassSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  const setupNav = [
    { label: "Setup", href: `/events/${eventId}/setup`, icon: Settings },
    { label: "Venue", href: `/events/${eventId}/venue`, icon: Building2 },
    { label: "Plan", href: `/events/${eventId}/plan`, icon: CalendarCheck },
    { label: "Tasks", href: `/events/${eventId}/tasks`, icon: CheckSquare },
    { label: "Schedule", href: `/events/${eventId}/schedule`, icon: Clock },
    { label: "Budget", href: `/events/${eventId}/budget`, icon: DollarSign },
    { label: "Providers", href: `/events/${eventId}/vendors`, icon: Users },
  ];

  return (
    <aside className="w-64 h-full hidden lg:flex flex-col border-r border-white/5 bg-[#111115]/40 backdrop-blur-3xl pt-6 px-4">
      {/* Brand */}
      <div className="flex items-center space-x-3 px-2 mb-10">
        <div className="w-8 h-8 rounded-full bg-[#D6003C] flex items-center justify-center shadow-[0_0_15px_rgba(214,0,60,0.5)] border border-transparent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
            <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
            <circle cx="12" cy="12" r="3" fill="white"></circle>
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold tracking-tight text-white leading-none">EVENTRA</span>
          <span className="text-[9px] text-[#D6003C] font-mono tracking-widest mt-1">FLEET CONTROL</span>
        </div>
      </div>

      <div className="flex flex-col space-y-1">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-2">
          Fleet
        </div>
        <Link
          href="/dashboard"
          className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            pathname === "/dashboard"
              ? "bg-[#D6003C]/10 text-[#D6003C]"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Dashboard</span>
        </Link>

      </div>

      <div className="mt-8 flex flex-col space-y-1 flex-1 overflow-y-auto no-scrollbar">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-2 flex items-center justify-between">
          <span>Current Event</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#D6003C] animate-pulse" />
        </div>
        
        {setupNav.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "bg-white/10 text-white shadow-inner"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? "text-white" : "text-gray-400"}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
