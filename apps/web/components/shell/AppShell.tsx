"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Settings, Bell, UserCircle, Radio, AlertTriangle, RotateCcw, ShieldCheck, BarChart3, History, FileText } from 'lucide-react';
import { BackgroundBeams } from '../ui/background-beams';
import { EventSwitcher } from './EventSwitcher';
import { GlassSidebar } from './GlassSidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  const navItems = [
    { label: "Live Ops", href: `/events/${eventId}/live`, icon: Radio, isLive: true },
    { label: "Incidents", href: `/events/${eventId}/incidents`, icon: AlertTriangle },
    { label: "Recovery", href: `/events/${eventId}/recovery`, icon: RotateCcw },
    { label: "Approvals", href: `/events/${eventId}/approvals`, icon: ShieldCheck },
    { label: "Activity", href: `/events/${eventId}/activity`, icon: History },
    { label: "Audit", href: `/events/${eventId}/audit`, icon: FileText },
  ];

  return (
    <div className="flex h-screen w-screen bg-[#070b12] text-slate-100 font-sans selection:bg-[#D6003C] selection:text-white overflow-hidden">
      
      {/* Custom Glass Sidebar (Left) */}
      <GlassSidebar />

      {/* Main Glassmorphic Application Wrapper (Right) */}
      <div className="flex-1 relative overflow-hidden flex flex-col w-full p-4 md:p-6 lg:p-8">
        
        {/* Premium Background Effects */}
        <BackgroundBeams className="fixed inset-0 z-0 pointer-events-none opacity-30" />
        
        {/* Blueprint Grid Overlay */}
        <div 
          className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(to right, #ffffff 1px, transparent 1px),
              linear-gradient(to bottom, #ffffff 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        />

        {/* The Glassmorphic Container wrapping the entire dashboard */}
        <div className="bg-[#111115]/80 backdrop-blur-2xl border border-white/5 rounded-[32px] md:rounded-[48px] shadow-2xl min-h-full flex flex-col overflow-hidden relative z-10 pb-24">
           
           {/* Top Nav */}
           <header className="w-full flex flex-col xl:flex-row items-center justify-between px-6 md:px-10 py-6 gap-6 xl:gap-0 z-50 relative">
              <div className="flex items-center gap-6 w-full xl:w-auto justify-between xl:justify-start">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-[#D6003C] flex items-center justify-center shadow-[0_0_15px_rgba(214,0,60,0.5)] border border-transparent">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
                        <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
                        <circle cx="12" cy="12" r="3" fill="white"></circle>
                      </svg>
                   </div>
                   <span className="text-2xl font-normal tracking-tight text-white hidden sm:block">Eventra</span>
                 </div>
                 <div className="w-48 hidden sm:block">
                    <EventSwitcher />
                 </div>
              </div>

              {/* Center Nav Pills (Live Ops) */}
              <nav className="flex items-center gap-1 md:gap-2 bg-black/40 border border-white/5 p-1.5 rounded-full overflow-x-auto w-full xl:w-auto no-scrollbar mask-edges">
                 {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;

                    if (item.isLive) {
                      return (
                        <Link 
                          key={item.href} 
                          href={item.href}
                          className={`group relative flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-bold transition-all whitespace-nowrap ${
                            isActive 
                              ? 'bg-[#D6003C] text-white shadow-lg shadow-[#D6003C]/30' 
                              : 'text-[#D6003C] hover:bg-white/5'
                          }`}
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon className="w-4 h-4" />
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white animate-ping opacity-75" />
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white" />
                          </div>
                          <span className="tracking-wider uppercase">{item.label}</span>
                        </Link>
                      )
                    }

                    return (
                      <Link 
                        key={item.href} 
                        href={item.href}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-white/10 text-white shadow-lg shadow-black/30 font-semibold' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                      >
                        <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-gray-400"}`} />
                        <span className="hidden sm:inline">{item.label}</span>
                      </Link>
                    )
                 })}
              </nav>

              {/* Right Utils */}
              <div className="flex items-center gap-3 w-full xl:w-auto justify-end">
                 <button className="p-2.5 rounded-full bg-black/40 border border-white/5 text-gray-400 hover:text-white hover:border-white/20 transition-all shadow-[0_0_15px_rgba(214,0,60,0.1)]">
                    <Bell size={16} />
                 </button>
                 <button className="p-2.5 rounded-full bg-black/40 border border-white/5 text-gray-400 hover:text-white hover:border-white/20 transition-all">
                    <UserCircle size={18} />
                 </button>
              </div>
           </header>

           {/* Main Content Area */}
           <main className="flex-1 w-full px-6 md:px-10 pb-10 z-10 relative overflow-y-auto">
             {children}
           </main>

        </div>
      </div>
    </div>
  );
}
