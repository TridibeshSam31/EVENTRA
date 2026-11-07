"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SERVICES = [
  {
    id: "01",
    title: "EVENT PLANNING",
    shortText: "Turn requirements into an operational model of tasks, dependencies, resources, deadlines, constraints, and schedules.",
    subItems: [
      { id: "01", title: "TASK GENERATION", desc: "Break the event into actionable operational tasks." },
      { id: "02", title: "DEPENDENCY MAPPING", desc: "Understand what depends on what before execution begins." },
      { id: "03", title: "RESOURCE PLANNING", desc: "Map providers, equipment, staffing, budget, and other requirements." }
    ]
  },
  {
    id: "02",
    title: "REAL-WORLD COORDINATION",
    shortText: "Connect the operational plan to real venues, providers, locations, availability, pricing, and routing.",
    subItems: [
      { id: "01", title: "VENUE DISCOVERY", desc: "Find venues based on location, capacity, facilities, availability, and price." },
      { id: "02", title: "PROVIDER MATCHING", desc: "Discover providers based on capability, location, and availability." },
      { id: "03", title: "DISTANCE & ETA", desc: "Evaluate real-world travel time and operational proximity." }
    ]
  },
  {
    id: "03",
    title: "LIVE OPERATIONS",
    shortText: "One operational view of the event as it unfolds — from tasks and providers to schedule, resources, budget, and event health.",
    subItems: [
      { id: "01", title: "LIVE STATUS", desc: "Track tasks, providers, venues, schedules, budgets, and resources." },
      { id: "02", title: "TIMELINE", desc: "Compare planned execution with what is actually happening." },
      { id: "03", title: "INCIDENT FEED", desc: "Surface operational deviations as they happen." }
    ]
  },
  {
    id: "04",
    title: "INTELLIGENT RESPONSE",
    shortText: "Detect disruptions, understand their impact, assess risk, and recover the event with the right action.",
    subItems: [
      { id: "01", title: "DETECT & UNDERSTAND", desc: "Identify operational deviations and trace dependencies to determine their full impact." },
      { id: "02", title: "RECOVER", desc: "Generate recovery options based on availability, capability, ETA, budget, and feasibility." },
      { id: "03", title: "VERIFY", desc: "Execute permitted actions, confirm the result, and update the event state." }
    ]
  }
];

export default function ServicesSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Auto-cycle effect
  useEffect(() => {
    if (isHovered) return;
    
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % SERVICES.length);
    }, 5000); // 5 seconds per slide
    
    return () => clearInterval(interval);
  }, [isHovered]);

  return (
    <section className="w-full bg-[#FDFCFA] text-ink-900 py-24 sm:py-32 px-6 sm:px-12 font-sans selection:bg-cue-600 selection:text-white">
      <div className="max-w-[1400px] mx-auto">
        
        {/* Section Header */}
        <div className="flex items-center gap-4 mb-16 uppercase tracking-[0.15em] font-mono text-[10px] font-medium text-ink-500">
           <span className="text-cue-600">03</span>
           <span>How it works</span>
        </div>

        {/* Title and Subtitle Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 mb-24">
           <h2 className="font-display text-[clamp(48px,6vw,92px)] font-black tracking-[-0.035em] leading-[0.92]" style={{ fontStretch: "82%" }}>
              Four stages, <span className="text-cue-600">one loop.</span>
           </h2>
           <p className="text-ink-600 text-[16px] sm:text-[18px] leading-relaxed max-w-[500px] lg:mt-4">
              Plan it, source it, run it, recover it. Each stage feeds the next, so a cancelled vendor on the day is handled with the same requirements and budget you set at the start.
           </p>
        </div>

        {/* Accordion Container */}
        <div 
           className="w-full border-t border-ink-200"
           onMouseEnter={() => setIsHovered(true)}
           onMouseLeave={() => setIsHovered(false)}
        >
           {SERVICES.map((service, index) => {
              const isActive = activeIndex === index;

              return (
                 <div 
                   key={service.id}
                   className={`group relative overflow-hidden transition-colors duration-500 cursor-pointer ${isActive ? 'bg-ink-950 text-white' : 'bg-[#FDFCFA] hover:bg-ink-50'}`}
                   onClick={() => setActiveIndex(index)}
                 >
                    {/* Glowing dot for active state */}
                    {isActive && (
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-cue-600 rounded-full blur-[100px] opacity-30 pointer-events-none" />
                    )}

                    {/* Header Row */}
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between p-6 sm:p-10 border-b border-ink-200 group-last:border-b-0">
                       
                       <div className="flex items-center gap-6 sm:gap-16">
                          <span className={`text-[12px] font-bold tracking-[0.1em] ${isActive ? 'text-ink-500' : 'text-ink-400'}`}>
                            {service.id}
                          </span>
                          <h3 style={{ fontStretch: "85%" }} className={`font-display text-[30px] sm:text-[46px] md:text-[62px] font-black tracking-[-0.03em] leading-none transition-colors duration-300 ${isActive ? 'text-white' : 'text-ink-300 group-hover:text-ink-900'}`}>
                             {service.title}
                          </h3>
                       </div>

                       {/* Short description shown only when inactive (desktop) */}
                       <div className={`hidden md:block max-w-[300px] text-right text-[13px] text-ink-500 font-medium transition-opacity duration-300 ${isActive ? 'opacity-0' : 'opacity-100'}`}>
                          {service.shortText}
                       </div>
                    </div>

                    {/* Expanded Content Area */}
                    <AnimatePresence initial={false}>
                       {isActive && (
                          <motion.div
                             initial={{ height: 0, opacity: 0 }}
                             animate={{ height: 'auto', opacity: 1 }}
                             exit={{ height: 0, opacity: 0 }}
                             transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                             className="overflow-hidden border-b border-white/10"
                          >
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-10 p-6 sm:p-10 pt-0 relative z-10">
                                
                                {/* Divider lines between sub-items on desktop */}
                                <div className="hidden md:block absolute top-10 bottom-10 left-[33.33%] w-px bg-white/10" />
                                <div className="hidden md:block absolute top-10 bottom-10 left-[66.66%] w-px bg-white/10" />

                                {service.subItems.map((subItem) => (
                                   <div key={subItem.id} className="flex flex-col gap-4">
                                      <span className="text-[10px] font-bold tracking-[0.15em] text-ink-500">
                                        {subItem.id}
                                      </span>
                                      <h4 className="text-[18px] sm:text-[22px] font-bold text-white tracking-tight">
                                        {subItem.title}
                                      </h4>
                                      <p className="text-[13px] sm:text-[14px] text-ink-500 font-medium leading-relaxed max-w-[280px]">
                                        {subItem.desc}
                                      </p>
                                   </div>
                                ))}
                             </div>
                          </motion.div>
                       )}
                    </AnimatePresence>
                 </div>
              );
           })}
        </div>

      </div>
    </section>
  );
}
