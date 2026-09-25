"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Calendar, Download, MoreVertical, Plus, Filter, Video, Users, CheckCircle2, Circle } from 'lucide-react';

const mockSchedule = [
  { id: 1, time: '08:00 AM', title: 'Venue Doors Open & Load-in', type: 'logistics', duration: '120 min', location: 'Main Entrance & Loading Dock B', status: 'completed' },
  { id: 2, time: '10:00 AM', title: 'Full Tech Rehearsal', type: 'production', duration: '90 min', location: 'Main Stage', status: 'completed' },
  { id: 3, time: '12:00 PM', title: 'VIP Reception', type: 'front-of-house', duration: '60 min', location: 'Sky Lounge', status: 'active' },
  { id: 4, time: '01:00 PM', title: 'Opening Keynote', type: 'show', duration: '45 min', location: 'Main Stage', status: 'upcoming' },
  { id: 5, time: '02:00 PM', title: 'Product Demos', type: 'show', duration: '120 min', location: 'Expo Hall', status: 'upcoming' },
  { id: 6, time: '04:30 PM', title: 'Closing Remarks & Strike Prep', type: 'production', duration: '30 min', location: 'Main Stage', status: 'upcoming' },
];

export default function SchedulePage() {
  const [activeDay, setActiveDay] = useState('Day 1');
  
  return (
    <div className="w-full h-full flex flex-col space-y-8 text-white font-sans">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="text-[#0284C7] w-5 h-5" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#0284C7] uppercase">Master Clock</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight">
            Run of <span className="font-bold">Show</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-black/40 border border-white/10 rounded-full p-1 flex">
            {['Build', 'Day 1', 'Day 2', 'Strike'].map(day => (
              <button 
                key={day}
                onClick={() => setActiveDay(day)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  activeDay === day ? 'bg-[#0284C7] text-white shadow-[0_0_10px_rgba(2,132,199,0.3)]' : 'text-gray-400 hover:text-white'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded-full transition-all">
            <Filter className="w-4 h-4 text-gray-300" />
          </button>
          <button className="bg-white hover:bg-gray-200 text-black flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export Call Sheet</span>
          </button>
        </div>
      </div>

      {/* Main Schedule Container */}
      <div className="flex-1 w-full bg-[#111115] border border-white/5 rounded-3xl p-6 lg:p-10 relative overflow-hidden">
        
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        <div className="max-w-4xl mx-auto relative z-10">
          
          <div className="flex items-center justify-between mb-10 pb-4 border-b border-white/10">
            <h2 className="text-xl font-semibold tracking-tight">{activeDay} Schedule</h2>
            <button className="text-[#0284C7] flex items-center gap-1 text-sm font-medium hover:text-[#0284C7]/80 transition-colors">
               <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          <div className="space-y-6">
            {mockSchedule.map((item, index) => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                key={item.id} 
                className={`flex gap-6 group relative ${item.status === 'active' ? 'opacity-100' : item.status === 'completed' ? 'opacity-60 hover:opacity-100' : 'opacity-90'} transition-opacity duration-300`}
              >
                
                {/* Time Column */}
                <div className="w-24 flex-shrink-0 text-right pt-1">
                  <div className={`text-sm font-bold font-mono tracking-tighter ${item.status === 'active' ? 'text-[#0284C7]' : 'text-gray-400'}`}>
                    {item.time}
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono mt-1">{item.duration}</div>
                </div>

                {/* Timeline Divider */}
                <div className="relative flex flex-col items-center">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center relative z-10 ${
                    item.status === 'completed' ? 'bg-[#16A34A] border-[#16A34A]' : 
                    item.status === 'active' ? 'bg-[#0284C7] border-[#0284C7] shadow-[0_0_15px_rgba(2,132,199,0.5)] ring-4 ring-[#0284C7]/20' : 
                    'bg-[#111115] border-gray-600'
                  }`}>
                    {item.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-white" />}
                    {item.status === 'active' && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
                  </div>
                  {index !== mockSchedule.length - 1 && (
                    <div className={`absolute top-4 bottom-[-24px] w-0.5 ${item.status === 'completed' ? 'bg-[#16A34A]/50' : 'bg-white/10'}`} />
                  )}
                </div>

                {/* Content Column */}
                <div className={`flex-1 bg-black/40 border border-white/5 rounded-2xl p-5 group-hover:border-white/15 transition-all ${item.status === 'active' ? 'border-[#0284C7]/30 bg-[#0284C7]/5 shadow-[0_0_30px_rgba(2,132,199,0.05)]' : ''}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded ${
                        item.type === 'logistics' ? 'bg-purple-500/20 text-purple-400' :
                        item.type === 'production' ? 'bg-amber-500/20 text-amber-400' :
                        item.type === 'show' ? 'bg-[#D6003C]/20 text-[#D6003C]' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {item.type}
                      </span>
                      {item.status === 'active' && (
                        <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-[#0284C7] text-white animate-pulse">
                          Live Now
                        </span>
                      )}
                    </div>
                    <MoreVertical className="w-4 h-4 text-gray-600 hover:text-white cursor-pointer transition-colors" />
                  </div>
                  
                  <h3 className={`text-lg font-medium mb-1 ${item.status === 'completed' ? 'line-through text-gray-400' : 'text-white'}`}>
                    {item.title}
                  </h3>
                  
                  <div className="flex items-center gap-4 text-xs font-mono text-gray-500 mt-4">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{item.location}</span>
                    </div>
                    {item.type === 'production' && (
                      <div className="flex items-center gap-1.5 text-amber-500/70">
                        <Video className="w-3.5 h-3.5" />
                        <span>AV Req</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          
        </div>
      </div>
    </div>
  );
}
