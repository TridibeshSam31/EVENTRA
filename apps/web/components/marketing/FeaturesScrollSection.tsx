"use client";

import React, { useRef } from "react";
import { motion, useScroll, useTransform, MotionValue } from "framer-motion";

const FEATURES = [
  {
    tag: "PLANNING / ENGINE",
    title: "Intelligent\nEvent Planning",
    description: "Turn event requirements into an operational plan with tasks, dependencies, resources, deadlines, priorities, budgets, and schedules — all structured around how the event actually needs to run.",
    leftBg: "bg-[#FBFBFA]",
    leftText: "text-[#111]",
    rightBg: "bg-[#0A0A0F]",
    graphic: (
      <div className="absolute inset-0 w-full h-full font-mono flex items-center justify-center overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* Connection Lines */}
        <svg className="absolute inset-0 w-full h-full" overflow="visible">
           <path d="M 25% 30% L 45% 55% L 75% 45% L 85% 75%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 45% 55% L 35% 75%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Floating Tags */}
        <div className="absolute top-[25%] left-[20%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-white/20 shadow-[3px_3px_0px_rgba(255,255,255,0.2)]">TASKS</div>
        </div>

        <div className="absolute top-[38%] left-[78%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-[#D6003C] shadow-[3px_3px_0px_#D6003C]">DEPENDENCIES</div>
        </div>

        <div className="absolute top-[75%] left-[30%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-[#0284C7] shadow-[3px_3px_0px_#0284C7]">RESOURCES</div>
        </div>

        <div className="absolute top-[75%] left-[80%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-[#16A34A] shadow-[3px_3px_0px_#16A34A]">SCHEDULE</div>
        </div>

        {/* Nodes */}
        <div className="absolute top-[30%] left-[25%] w-3 h-3 bg-white shadow-[0_0_15px_white] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-[55%] left-[45%] w-3 h-3 bg-white shadow-[0_0_15px_white] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-[45%] left-[75%] w-3 h-3 bg-[#D6003C] shadow-[0_0_15px_#D6003C] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-[75%] left-[35%] w-3 h-3 bg-[#0284C7] shadow-[0_0_15px_#0284C7] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-[75%] left-[85%] w-3 h-3 bg-[#16A34A] shadow-[0_0_15px_#16A34A] -translate-x-1/2 -translate-y-1/2" />
      </div>
    )
  },
  {
    tag: "OPERATIONS / COMMAND",
    title: "Live Event\nCommand Center",
    description: "See the entire event as it happens. Track event health, tasks, providers, venues, schedules, budgets, resources, and live operational updates from one command center.",
    actionText: "VIEW COMMAND CENTER ↗",
    leftBg: "bg-[#F5F5F7]",
    leftText: "text-[#111]",
    rightBg: "bg-[#0A0A0F]",
    graphic: (
      <div className="absolute inset-0 w-full h-full font-mono flex flex-col p-8 overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(214,0,60,0.05)_0%,transparent_70%)]">
         {/* Background Grid */}
         <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:30px_30px]" />
         
         <div className="flex-1 flex flex-col justify-center items-center gap-6 relative z-10 w-full max-w-[400px] mx-auto">
            {/* Main HUD */}
            <div className="w-full h-32 bg-[#111] border border-[#16A34A] shadow-[4px_4px_0px_#16A34A] flex flex-col p-4 relative group hover:-translate-y-1 hover:-translate-x-1 transition-transform">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-[#16A34A]" />
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] text-[#16A34A] font-bold uppercase tracking-widest flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" /> EVENT HEALTH 94%
                  </span>
                </div>
                <div className="flex-1 flex items-end gap-1.5">
                   {[40, 70, 50, 90, 60, 80, 100, 85, 95, 60, 75, 90, 95, 94].map((h, i) => (
                      <div key={i} className="flex-1 bg-[#16A34A]/20 relative h-full">
                         <div className="absolute bottom-0 left-0 w-full bg-[#16A34A] transition-all duration-1000 group-hover:bg-[#4ADE80]" style={{ height: `${h}%` }} />
                      </div>
                   ))}
                </div>
            </div>

            <div className="flex w-full gap-4">
                <div className="flex-1 bg-[#111] border border-[#0284C7] shadow-[4px_4px_0px_#0284C7] p-3 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
                    <span className="block text-[#0284C7] text-xl font-bold mb-1">12</span>
                    <span className="text-[9px] text-white font-bold uppercase tracking-widest">TASKS ACTIVE</span>
                </div>
                <div className="flex-1 bg-[#111] border border-[#D6003C] shadow-[4px_4px_0px_#D6003C] p-3 hover:-translate-y-1 hover:-translate-x-1 transition-transform relative">
                    <div className="absolute top-3 right-3 w-1.5 h-1.5 bg-[#D6003C] rounded-full animate-pulse shadow-[0_0_8px_#D6003C]" />
                    <span className="block text-[#D6003C] text-xl font-bold mb-1">02</span>
                    <span className="text-[9px] text-white font-bold uppercase tracking-widest">INCIDENTS</span>
                </div>
                <div className="flex-1 bg-[#111] border border-white/20 shadow-[4px_4px_0px_rgba(255,255,255,0.2)] p-3 hover:-translate-y-1 hover:-translate-x-1 transition-transform">
                    <span className="block text-white text-xl font-bold mb-1">18</span>
                    <span className="text-[9px] text-white/70 font-bold uppercase tracking-widest">PROVIDERS</span>
                </div>
            </div>
         </div>
      </div>
    )
  },
  {
    tag: "INTELLIGENCE / RISK",
    title: "Detect.\nUnderstand. Respond.",
    description: "Eventra detects delays, no-shows, venue issues, resource shortages, and schedule deviations — then traces their dependencies to understand what the incident could affect.",
    actionText: "EXPLORE FEATURE ↗",
    leftBg: "bg-[#FBFBFA]",
    leftText: "text-[#111]",
    rightBg: "bg-[#0A0A0F]",
    graphic: (
      <div className="absolute inset-0 w-full h-full font-mono flex items-center justify-center overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* Connection Lines (Red propagating effect) */}
        <svg className="absolute inset-0 w-full h-full" overflow="visible">
           <path d="M 15% 30% L 35% 50% L 55% 40% L 75% 60% L 85% 80%" fill="none" stroke="#D6003C" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" />
        </svg>

        {/* Status Labels */}
        <div className="absolute top-[10%] right-[10%] flex flex-col gap-2 z-20">
           <div className="bg-[#D6003C]/10 text-[#D6003C] px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C] shadow-[2px_2px_0px_#D6003C]">INCIDENT DETECTED</div>
           <div className="bg-[#111] text-white/70 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-white/20 shadow-[2px_2px_0px_rgba(255,255,255,0.2)]">IMPACT ANALYSIS</div>
           <div className="bg-[#111] text-white/70 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-white/20 shadow-[2px_2px_0px_rgba(255,255,255,0.2)]">RISK: CRITICAL</div>
        </div>

        {/* Nodes cascading */}
        <div className="absolute top-[30%] left-[15%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 hover:scale-105 transition-transform">
           <div className="w-4 h-4 bg-[#D6003C] shadow-[0_0_15px_#D6003C] animate-pulse border-2 border-white" />
           <div className="bg-[#111] text-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest border border-[#D6003C]">VENDOR DELAY</div>
        </div>

        <div className="absolute top-[50%] left-[35%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 hover:scale-105 transition-transform">
           <div className="w-3 h-3 bg-[#D6003C]/80 shadow-[0_0_10px_#D6003C] border border-white" />
           <div className="bg-[#111] text-white px-2 py-1 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C]/50">SETUP</div>
        </div>

        <div className="absolute top-[40%] left-[55%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 hover:scale-105 transition-transform">
           <div className="w-3 h-3 bg-[#D6003C]/60 shadow-[0_0_10px_#D6003C] border border-white" />
           <div className="bg-[#111] text-white px-2 py-1 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C]/50">SCHEDULE</div>
        </div>

        <div className="absolute top-[60%] left-[75%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 hover:scale-105 transition-transform">
           <div className="w-3 h-3 bg-[#D6003C]/40 border border-[#D6003C]" />
           <div className="bg-[#111] text-white/80 px-2 py-1 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C]/30">MILESTONE</div>
        </div>

        <div className="absolute top-[80%] left-[85%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 hover:scale-105 transition-transform">
           <div className="w-3 h-3 bg-[#D6003C]/20 border border-[#D6003C]" />
           <div className="bg-[#111] text-white/60 px-2 py-1 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C]/20">RISK</div>
        </div>
      </div>
    )
  },
  {
    tag: "RECOVERY / AUTONOMY",
    title: "Recovery\nWithout the Chaos",
    description: "When something goes wrong, Eventra generates recovery options and evaluates real availability, capability, distance, budget, and schedule feasibility before deciding what happens next.",
    actionText: "EXPLORE RECOVERY ↗",
    leftBg: "bg-[#FBFBFA]",
    leftText: "text-[#111]",
    rightBg: "bg-[#0A0A0F]",
    graphic: (
      <div className="absolute inset-0 w-full h-full font-mono overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* SVG connection lines */}
        <svg className="absolute inset-0 w-full h-full" overflow="visible">
           <path d="M 50% 25% L 50% 35% L 16.6% 35% L 16.6% 45%" fill="none" stroke="rgba(2,132,199,1)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 35% L 50% 45%" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 35% L 83.3% 35% L 83.3% 45%" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="4 4" />
           
           <path d="M 16.6% 65% L 16.6% 75% L 50% 75% L 50% 85%" fill="none" stroke="rgba(22,163,74,0.8)" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Top Node */}
        <div className="absolute top-[25%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:scale-105 transition-transform">
           <div className="bg-[#D6003C] text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest shadow-[0_0_15px_#D6003C] animate-pulse">INCIDENT</div>
        </div>
        
        {/* The 3 Cards at 55% height */}
        <div className="absolute top-[55%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[500px] flex justify-between z-10 gap-3">
           {/* Replace Provider - Active Path */}
           <div className="flex-1 bg-[#111] border-2 border-[#0284C7] shadow-[3px_3px_0px_#0284C7] p-3 md:p-4 hover:-translate-y-1 hover:-translate-x-1 transition-transform cursor-default">
               <div className="text-[#0284C7] text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-3 leading-tight">REPLACE<br/>PROVIDER</div>
               <div className="text-white/90 text-[8px] md:text-[9px] font-mono tracking-wider bg-[#0284C7]/20 px-2 py-1.5 inline-block">+₹8,500 &middot; 18 MIN</div>
           </div>

           {/* Reallocate - Discarded Path */}
           <div className="flex-1 bg-[#111] border-2 border-white/20 shadow-[3px_3px_0px_rgba(255,255,255,0.1)] p-3 md:p-4 opacity-50 grayscale hover:opacity-100 transition-opacity">
               <div className="text-white text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-3 leading-tight">REALLOCATE<br/>RESOURCE</div>
               <div className="text-white/50 text-[8px] md:text-[9px] font-mono tracking-wider bg-white/10 px-2 py-1.5 inline-block">₹0 &middot; 12 MIN</div>
           </div>

           {/* Shift Schedule - Discarded Path */}
           <div className="flex-1 bg-[#111] border-2 border-[#D6003C] shadow-[3px_3px_0px_rgba(214,0,60,0.4)] p-3 md:p-4 opacity-50 grayscale hover:opacity-100 transition-opacity">
               <div className="text-[#D6003C] text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-3 leading-tight">SHIFT<br/>SCHEDULE</div>
               <div className="text-[#D6003C]/70 text-[8px] md:text-[9px] font-mono tracking-wider bg-[#D6003C]/10 px-2 py-1.5 inline-block">₹0 &middot; HI IMPACT</div>
           </div>
        </div>

        {/* Ready Node */}
        <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:scale-105 transition-transform">
           <div className="bg-[#16A34A]/20 text-[#16A34A] border-2 border-[#16A34A] px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(22,163,74,0.3)] bg-black">RECOVERY READY</div>
        </div>
      </div>
    )
  },
  {
    tag: "AI / AGENT",
    title: "An AI Agent\nThat Takes Action",
    description: "Eventra's AI agent understands event requirements, reasons over live event state, investigates incidents, recommends recovery, executes permitted actions, and verifies that the operation has recovered.",
    actionText: "MEET THE AGENT ↗",
    leftBg: "bg-[#FBFBFA]",
    leftText: "text-[#111]",
    rightBg: "bg-[#0A0A0F]",
    graphic: (
      <div className="absolute inset-0 w-full h-full font-mono flex flex-col items-center justify-center p-8 overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* SVG connection lines for the network */}
        <svg className="absolute inset-0 w-full h-full" overflow="visible">
           <path d="M 50% 40% L 20% 20%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 40% L 80% 20%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 40% L 15% 50%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 40% L 85% 50%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M 50% 40% L 50% 20%" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* AI Central Node */}
        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:scale-110 transition-transform">
           <div className="bg-[#D6003C] text-white p-4 w-16 h-16 flex items-center justify-center border-2 border-white shadow-[0_0_20px_#D6003C] animate-pulse">
              <span className="text-2xl font-bold">AI</span>
           </div>
        </div>

        {/* Connected Nodes */}
        <div className="absolute top-[20%] left-[20%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-[#0284C7] shadow-[2px_2px_0px_#0284C7]">EVENT STATE</div>
        </div>

        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-[#D6003C] shadow-[2px_2px_0px_#D6003C]">INCIDENTS</div>
        </div>

        <div className="absolute top-[20%] left-[80%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-[#EAB308] shadow-[2px_2px_0px_#EAB308]">TOOLS</div>
        </div>

        <div className="absolute top-[50%] left-[15%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-[#16A34A] shadow-[2px_2px_0px_#16A34A]">RECOVERY</div>
        </div>

        <div className="absolute top-[50%] left-[85%] -translate-x-1/2 -translate-y-1/2 z-10 hover:-translate-y-1 transition-transform">
           <div className="bg-[#111] text-white px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-white/40 shadow-[2px_2px_0px_rgba(255,255,255,0.4)]">HUMAN</div>
        </div>

        {/* Execution Flow */}
        <div className="absolute bottom-[15%] left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] flex justify-between items-center z-10">
           <div className="flex flex-col items-center gap-3 group">
              <div className="w-2.5 h-2.5 bg-white group-hover:scale-150 transition-transform shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
              <div className="text-white text-[8px] md:text-[9px] font-bold uppercase tracking-widest">UNDERSTAND</div>
           </div>
           
           <div className="flex-1 h-[1px] bg-white/20 mx-2" />
           
           <div className="flex flex-col items-center gap-3 group">
              <div className="w-2.5 h-2.5 bg-white group-hover:scale-150 transition-transform shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
              <div className="text-white text-[8px] md:text-[9px] font-bold uppercase tracking-widest">INVESTIGATE</div>
           </div>

           <div className="flex-1 h-[1px] bg-white/20 mx-2" />
           
           <div className="flex flex-col items-center gap-3 group">
              <div className="w-2.5 h-2.5 bg-[#D6003C] shadow-[0_0_10px_#D6003C] group-hover:scale-150 transition-transform" />
              <div className="text-[#D6003C] text-[8px] md:text-[9px] font-bold uppercase tracking-widest">ACT</div>
           </div>

           <div className="flex-1 h-[1px] bg-[#16A34A]/50 mx-2" />
           
           <div className="flex flex-col items-center gap-3 group">
              <div className="w-2.5 h-2.5 bg-[#16A34A] shadow-[0_0_10px_#16A34A] group-hover:scale-150 transition-transform" />
              <div className="text-[#16A34A] text-[8px] md:text-[9px] font-bold uppercase tracking-widest">VERIFY</div>
           </div>
        </div>

      </div>
    )
  }
];

interface CardProps {
  index: number;
  feature: typeof FEATURES[0];
  progress: MotionValue<number>;
  totalCards: number;
}

const Card = ({ index, feature, progress, totalCards }: CardProps) => {
  // Start the animation when progress hits (index * 0.2)
  const rangeStart = index * (1 / totalCards);
  // Enter phase is the 0.2 segment before its start
  const enterStart = index === 0 ? 0 : rangeStart - (1 / totalCards);
  
  // Y position: Slides up from 100vh to 0vh during its enter phase
  const y = useTransform(
    progress,
    index === 0 ? [0, 1] : [enterStart, rangeStart],
    index === 0 ? ["0vh", "0vh"] : ["100vh", "0vh"]
  );

  // Scale: Shrinks from 1 down to ~0.8 as user continues scrolling past it
  const scale = useTransform(
    progress,
    [rangeStart, 1],
    [1, 1 - (totalCards - index) * 0.04]
  );

  // Dim overlay: gets darker as it goes back
  const dimOpacity = useTransform(
    progress,
    [rangeStart, rangeStart + (1 / totalCards)],
    [0, 0.3]
  );

  return (
    <motion.div
      style={{ y, scale }}
      className="absolute top-0 left-0 w-full h-full flex items-center justify-center origin-top pt-[10vh]"
    >
      <div className={`w-[90%] max-w-[1100px] h-[65vh] min-h-[500px] rounded-[12px] flex flex-col md:flex-row overflow-hidden shadow-[12px_12px_0px_rgba(0,0,0,0.4)] border-2 border-white/10`}>
        
        {/* Left Side (Text) */}
        <div className={`w-full md:w-1/2 p-10 md:p-16 flex flex-col justify-center ${feature.leftBg} ${feature.leftText} relative`}>
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-black/50 mb-8 block">
            {feature.tag}
          </span>
          <h3 className="text-5xl md:text-6xl font-bold tracking-tighter leading-[0.95] mb-8 whitespace-pre-line">
            {feature.title}
          </h3>
          <p className="text-[15px] sm:text-[17px] font-medium leading-relaxed opacity-70 max-w-[400px]">
            {feature.description}
          </p>

          <div className="mt-12">
             <button className="text-[11px] font-bold uppercase tracking-wider border-b-2 border-black/20 pb-1 hover:border-black transition-colors">
               {(feature as any).actionText || "Explore Feature ↗"}
             </button>
          </div>
        </div>

        {/* Right Side (Graphic) */}
        <div className={`w-full md:w-1/2 ${feature.rightBg} relative flex items-center justify-center p-10`}>
          {feature.graphic}
        </div>
        
        {/* Dim Overlay for depth effect when pushed back */}
        <motion.div 
          style={{ opacity: dimOpacity }}
          className="absolute inset-0 bg-black pointer-events-none"
        />
      </div>
    </motion.div>
  );
};

export default function FeaturesScrollSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Track scroll progress through the massive 500vh container
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  return (
    <section ref={containerRef} className="relative w-full bg-[#0A0A0F] h-[500vh]">
      <div className="sticky top-0 left-0 w-full h-screen overflow-hidden flex items-center justify-center">
        {FEATURES.map((feature, index) => (
          <Card 
            key={index} 
            index={index} 
            feature={feature} 
            progress={scrollYProgress} 
            totalCards={FEATURES.length}
          />
        ))}
      </div>
    </section>
  );
}
