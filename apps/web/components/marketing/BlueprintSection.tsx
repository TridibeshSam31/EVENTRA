"use client";

import React from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';

export default function BlueprintSection() {
  const { scrollYProgress } = useScroll();
  // We can add subtle parallax to the layers later if needed

  return (
    <section className="relative w-full bg-[#FBFBFA] text-[#222222] min-h-screen border-t border-t-[#E5E5E5] overflow-hidden selection:bg-[#D6003C] selection:text-white pb-20 sm:pb-0 font-sans">
      
      {/* Light Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.25]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #888 1px, transparent 1px),
            linear-gradient(to bottom, #888 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Top Header Bordered */}
      <div className="relative border-b border-[#E5E5E5] flex flex-col md:flex-row justify-between text-[9px] font-bold tracking-[0.2em] uppercase text-[#888] px-6 sm:px-12 backdrop-blur-sm bg-white/50">
        <div className="py-4 md:border-r border-[#E5E5E5] md:pr-12">
          <span className="text-[#D6003C] shadow-[0_0_10px_rgba(214,0,60,0.2)]">01</span> / WHAT WE BELIEVE
        </div>
        <div className="py-4 md:border-l border-[#E5E5E5] md:pl-12">
          ASSEMBLY DWG · 4 LAYERS · SCALE 1:1
        </div>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-2 max-w-[1400px] mx-auto min-h-[70vh]">
        
        {/* Left Column - Text Content */}
        <div className="flex flex-col justify-center px-6 sm:px-12 py-20 lg:py-32 lg:border-r border-[#E5E5E5] relative">
          
          <h2 className="text-[clamp(48px,6vw,90px)] font-bold tracking-tighter leading-[0.95] mb-12">
            <span className="text-black">Mission Control</span><br/>
            <span className="text-[#999999]">for live<br/>events.</span>
          </h2>
          
          <div className="w-full h-px bg-[#E5E5E5] mb-8" />
          
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#0284C7] mb-4 block">LIVE OPERATIONS OS</span>
          
          <div className="max-w-[420px] space-y-6 text-[#555] font-medium text-[15px] sm:text-[17px] leading-relaxed">
            <p>
              We didn't just build an event management tool; we built a military-grade operating system for live environments. 
            </p>
            <p>
              From real-time crowd telemetry and live camera feeds, to AI-driven disaster recovery playbooks that instantly scramble backup vendors when things go wrong. You stay in the loop, authorizing critical changes with a single tap.
            </p>
          </div>

          <div className="mt-16 pt-6 border-t border-[#E5E5E5] w-full max-w-[420px]">
             <Link href="/events/conference_demo/live" className="inline-flex items-center text-[12px] font-bold text-black uppercase tracking-wider group hover:text-[#D6003C] transition-colors">
               Enter Live Command Center <ArrowUpRight className="ml-1 w-4 h-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1 text-[#D6003C]" />
             </Link>
          </div>
        </div>

        {/* Right Column - Isometric Graphic */}
        <div className="flex flex-col items-center justify-center relative py-20 min-h-[500px]">
          
          {/* Connecting Lines & Annotations (Desktop Only) */}
          <div className="hidden xl:block absolute inset-0 pointer-events-none z-20">
            {/* Design Annotation */}
            <div className="absolute top-[32%] left-[15%] text-right">
              <span className="block text-black font-bold text-[15px]">Telemetry</span>
              <span className="block text-[#0284C7] font-mono text-[10px] tracking-widest mt-1">live crowd density & flow</span>
              <div className="absolute right-[-40px] top-[12px] w-[35px] h-px bg-[#C0C0C0]" />
              <div className="absolute right-[-80px] top-[12px] w-px h-[60px] bg-[#C0C0C0]" />
              <div className="absolute right-[-110px] top-[72px] w-[30px] h-px bg-[#C0C0C0]" />
              <div className="absolute right-[-113px] top-[69px] w-1.5 h-1.5 rounded-full bg-[#0284C7] shadow-[0_0_10px_rgba(2,132,199,0.3)]" />
            </div>

            {/* AI Annotation */}
            <div className="absolute top-[20%] right-[15%]">
              <span className="block text-black font-bold text-[15px]">Smart Recovery</span>
              <span className="block text-[#D6003C] font-mono text-[10px] tracking-widest mt-1">ai-driven contingency</span>
              <div className="absolute left-[-40px] top-[12px] w-[35px] h-px bg-[#C0C0C0]" />
              <div className="absolute left-[-80px] top-[12px] w-px h-[30px] bg-[#C0C0C0]" />
              <div className="absolute left-[-110px] top-[42px] w-[30px] h-px bg-[#C0C0C0]" />
              <div className="absolute left-[-113px] top-[39px] w-1.5 h-1.5 rounded-full bg-[#D6003C] shadow-[0_0_10px_rgba(214,0,60,0.3)]" />
            </div>

            {/* Automation Annotation */}
            <div className="absolute top-[50%] right-[10%]">
              <span className="block text-black font-bold text-[15px]">Approvals</span>
              <span className="block text-[#16A34A] font-mono text-[10px] tracking-widest mt-1">human-in-the-loop exec</span>
              <div className="absolute left-[-40px] top-[12px] w-[35px] h-px bg-[#C0C0C0]" />
              <div className="absolute left-[-80px] top-[-30px] w-px h-[42px] bg-[#C0C0C0]" />
              <div className="absolute left-[-110px] top-[-30px] w-[30px] h-px bg-[#C0C0C0]" />
              <div className="absolute left-[-113px] top-[-33px] w-1.5 h-1.5 rounded-full bg-[#16A34A] shadow-[0_0_10px_rgba(22,163,74,0.3)]" />
            </div>
          </div>

          {/* The 3D CSS Layers - Light Mode Neo-Brutalist Refactor */}
          <div className="relative w-[280px] h-[280px] sm:w-[350px] sm:h-[350px] perspective-1000">
             <div className="absolute inset-0 w-full h-full [transform-style:preserve-3d] [transform:rotateX(60deg)_rotateZ(-45deg)] hover:[transform:rotateX(65deg)_rotateZ(-40deg)] transition-transform duration-700 ease-out">
                
                {/* Layer 1 (Bottom) */}
                <div className="absolute inset-0 bg-[#F4F4F4]/90 border-2 border-[#D0D0D0] shadow-[-15px_15px_0px_rgba(0,0,0,0.06)] [transform:translateZ(0px)] backdrop-blur-sm">
                   {/* Grid pattern on the layer */}
                   <div className="w-full h-full bg-[linear-gradient(to_right,#E5E5E5_1px,transparent_1px),linear-gradient(to_bottom,#E5E5E5_1px,transparent_1px)] bg-[size:25%_25%]" />
                </div>
                
                {/* Layer 2 */}
                <div className="absolute inset-0 bg-[#F8F8F8]/90 border-2 border-[#C8C8C8] shadow-[-10px_10px_0px_rgba(0,0,0,0.04)] [transform:translateZ(60px)] backdrop-blur-sm flex items-center justify-center">
                   <div className="w-full h-full bg-[linear-gradient(to_right,#E5E5E5_1px,transparent_1px),linear-gradient(to_bottom,#E5E5E5_1px,transparent_1px)] bg-[size:33.33%_33.33%]" />
                   {/* Circle nodes graphic */}
                   <div className="absolute flex gap-4 [transform:rotateX(0deg)_rotateZ(45deg)] opacity-60">
                      <div className="w-2 h-2 border-2 border-[#0284C7] rounded-full shadow-[0_0_10px_rgba(2,132,199,0.2)] bg-white" />
                      <div className="w-8 border-t-2 border-dashed border-[#0284C7] my-auto" />
                      <div className="w-2 h-2 border-2 border-[#0284C7] rounded-full shadow-[0_0_10px_rgba(2,132,199,0.2)] bg-white" />
                      <div className="w-8 border-t-2 border-dashed border-[#0284C7] my-auto" />
                      <div className="w-2 h-2 border-2 border-[#0284C7] rounded-full shadow-[0_0_10px_rgba(2,132,199,0.2)] bg-white" />
                   </div>
                </div>

                {/* Layer 3 */}
                <div className="absolute inset-0 bg-white/90 border-2 border-[#B0B0B0] shadow-[-5px_5px_0px_rgba(0,0,0,0.08)] [transform:translateZ(120px)] backdrop-blur-md">
                   <div className="w-full h-full bg-[linear-gradient(to_right,#EAEAEA_1px,transparent_1px),linear-gradient(to_bottom,#EAEAEA_1px,transparent_1px)] bg-[size:20%_20%]" />
                </div>

                {/* Layer 4 (Top - Red Highlight) */}
                <div className="absolute inset-0 bg-white/70 border-2 border-[#D6003C] shadow-[-5px_5px_0px_rgba(214,0,60,0.2)] [transform:translateZ(180px)] backdrop-blur-md flex items-center justify-center">
                   {/* Top Layer Graphic */}
                   <div className="absolute w-full h-full bg-[linear-gradient(to_right,rgba(214,0,60,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(214,0,60,0.1)_1px,transparent_1px)] bg-[size:50%_50%]" />
                   <div className="relative w-[40%] h-[40%]">
                     <div className="absolute top-1/2 left-1/2 w-3 h-3 bg-[#D6003C] rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_#D6003C]" />
                     <div className="absolute top-0 left-0 w-1.5 h-1.5 bg-[#D6003C] rounded-full" />
                     <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-[#D6003C] rounded-full" />
                     <div className="absolute bottom-0 right-0 w-1.5 h-1.5 bg-[#D6003C] rounded-full" />
                     
                     {/* Connecting Red Lines */}
                     <svg className="absolute inset-0 w-full h-full" overflow="visible">
                        <line x1="50%" y1="50%" x2="0" y2="0" stroke="#D6003C" strokeWidth="2" strokeOpacity="0.8" />
                        <line x1="50%" y1="50%" x2="100%" y2="0" stroke="#D6003C" strokeWidth="2" strokeOpacity="0.8" />
                        <line x1="50%" y1="50%" x2="100%" y2="100%" stroke="#D6003C" strokeWidth="2" strokeOpacity="0.8" />
                     </svg>
                   </div>
                </div>

             </div>
          </div>
          
        </div>
      </div>

      {/* Bottom Metadata Bar */}
      <div className="absolute bottom-0 left-0 w-full border-t border-[#E5E5E5] backdrop-blur-sm bg-white/50">
        <div className="grid grid-cols-2 md:grid-cols-4 max-w-[1400px] mx-auto text-[9px] uppercase tracking-[0.1em] text-[#888] font-mono">
           <div className="p-4 border-b md:border-b-0 border-r border-[#E5E5E5]">
              <span className="block mb-2 font-sans font-bold text-[8px] text-[#A0A0A0]">PROJECT</span>
              <span className="text-black font-medium">Eventra Fleet Control</span>
           </div>
           <div className="p-4 border-b md:border-b-0 border-r-0 md:border-r border-[#E5E5E5]">
              <span className="block mb-2 font-sans font-bold text-[8px] text-[#A0A0A0]">DRAWING</span>
              <span className="text-black font-medium">Adaptive Infrastructure</span>
           </div>
           <div className="p-4 border-r border-[#E5E5E5]">
              <span className="block mb-2 font-sans font-bold text-[8px] text-[#A0A0A0]">MODULES</span>
              <span className="text-black font-medium">Live Ops OS</span>
           </div>
           <div className="p-4">
              <span className="block mb-2 font-sans font-bold text-[8px] text-[#A0A0A0]">YEARS IN BUILD</span>
              <span className="text-black font-medium">04+</span>
           </div>
        </div>
      </div>

    </section>
  );
}
