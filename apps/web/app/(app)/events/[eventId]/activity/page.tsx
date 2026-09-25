"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Filter, Radio, ShieldCheck, Truck, Users, Settings, Clock, CheckCircle2, AlertTriangle, Activity, MapPin, Zap } from 'lucide-react';

const INITIAL_LOGS = [
  { id: 'l-10', time: 'Just now', type: 'system', message: 'Smart Recovery protocol completed. Dashboard nominal.', icon: CheckCircle2 },
  { id: 'l-9', time: '2 mins ago', type: 'vendor', message: 'UrbanBites (Backup Catering) dispatched from local HQ.', icon: Truck },
  { id: 'l-8', time: '5 mins ago', type: 'system', message: 'Executive Authorization granted by David M. for catering swap.', icon: ShieldCheck },
  { id: 'l-7', time: '12 mins ago', type: 'security', message: 'Sector 4 crowd density normalized.', icon: Users },
  { id: 'l-6', time: '15 mins ago', type: 'vendor', message: 'Apex Catering flagged as NO-SHOW by automated gate sensors.', icon: AlertTriangle },
  { id: 'l-5', time: '22 mins ago', type: 'av', message: 'Main stage mic check completed. Audio nominal.', icon: Radio },
  { id: 'l-4', time: '35 mins ago', type: 'staff', message: 'Shift change: Registration desk team Bravo clocked in.', icon: Users },
  { id: 'l-3', time: '41 mins ago', type: 'vendor', message: 'SoundMax A/V equipment calibrated for Panel 2.', icon: Settings },
  { id: 'l-2', time: '1 hr ago', type: 'security', message: 'VIP entrance secured and metal detectors online.', icon: ShieldCheck },
  { id: 'l-1', time: '1.5 hrs ago', type: 'system', message: 'Eventra Live Ops OS booted and tracking initiated.', icon: Activity },
];

const VENDORS = [
  { 
    id: 'v-1', 
    name: 'UrbanBites', 
    category: 'Catering (Backup)', 
    status: 'in-transit', 
    progress: 45,
    eta: '14 mins',
    lastUpdate: 'Passing Checkpoint Alpha',
    health: 'good',
    color: 'text-yellow-500'
  },
  { 
    id: 'v-2', 
    name: 'SoundMax', 
    category: 'A/V & Tech', 
    status: 'live', 
    progress: 100,
    eta: 'Active',
    lastUpdate: 'Operating Main Stage',
    health: 'good',
    color: 'text-blue-500'
  },
  { 
    id: 'v-3', 
    name: 'EliteSec', 
    category: 'Private Security', 
    status: 'deployed',
    progress: 100, 
    eta: 'Active',
    lastUpdate: 'Patrolling Perimeter',
    health: 'good',
    color: 'text-green-500'
  },
  { 
    id: 'v-4', 
    name: 'Apex Catering', 
    category: 'Catering (Primary)', 
    status: 'offline', 
    progress: 0,
    eta: 'Unknown',
    lastUpdate: 'Truck breakdown on Route 9',
    health: 'critical',
    color: 'text-[#D6003C]'
  }
];

const RANDOM_EVENTS = [
  { type: 'security', message: 'Routine perimeter sweep completed. All clear.', icon: ShieldCheck },
  { type: 'av', message: 'Adjusting master volume output for Hall B by -2dB.', icon: Settings },
  { type: 'staff', message: 'Water station 3 resupplied by logistics team.', icon: Users },
  { type: 'system', message: 'Live network ping nominal. 12ms latency.', icon: Activity },
  { type: 'vendor', message: 'Merch tent 1 reports 50% stock remaining on hoodies.', icon: Truck }
];

export default function ActivityPage() {
  const [filter, setFilter] = useState('all');
  const [logs, setLogs] = useState(INITIAL_LOGS);

  // Simulate live incoming data to make it feel alive
  useEffect(() => {
    const interval = setInterval(() => {
      const randomEvent = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
      const newLog = {
        id: `l-${Date.now()}`,
        time: 'Just now',
        type: randomEvent.type,
        message: randomEvent.message,
        icon: randomEvent.icon
      };
      
      setLogs(prev => {
        // Update the 'Just now' of previous top log to '1 min ago' just for visual progression
        const updatedPrev = prev.map((log, idx) => {
           if (idx === 0 && log.time === 'Just now') return { ...log, time: '1 min ago' };
           return log;
        });
        return [newLog, ...updatedPrev].slice(0, 50);
      });
    }, 8000); // New log every 8 seconds

    return () => clearInterval(interval);
  }, []);

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.type === filter);

  const getTypeStyle = (type: string) => {
    switch(type) {
      case 'vendor': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'security': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'av': return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'system': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'staff': return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
      default: return 'text-white bg-white/10 border-white/20';
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <Radio className="text-[#38BDF8]" size={28} />
            Event <span className="font-bold text-[#38BDF8]">Matrix</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">Live, immutable ledger of all venue operations.</p>
        </div>
        
        {/* Filters */}
        <div className="flex items-center gap-2 bg-black/40 border border-white/5 p-1.5 rounded-2xl overflow-x-auto no-scrollbar mask-edges backdrop-blur-md">
           <Filter size={14} className="text-gray-500 ml-3 mr-2" />
           {['all', 'vendor', 'security', 'av', 'system', 'staff'].map(f => (
             <button
               key={f}
               onClick={() => setFilter(f)}
               className={`px-4 py-1.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
                 filter === f ? 'bg-white/10 text-white shadow-lg border border-white/10' : 'text-gray-500 hover:text-gray-300 border border-transparent'
               }`}
             >
               {f}
             </button>
           ))}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-hidden pb-20 xl:pb-0">
        
        {/* Left Column: Live Terminal Feed */}
        <div className="xl:col-span-8 flex flex-col h-full bg-[#050505] border border-white/5 rounded-[2rem] overflow-hidden shadow-2xl relative">
           
           {/* Terminal Header */}
           <div className="p-4 md:p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02] flex-shrink-0 z-10 backdrop-blur-md">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] flex items-center gap-3">
                 <div className="relative flex items-center justify-center">
                   <div className="w-2.5 h-2.5 rounded-full bg-[#38BDF8] animate-ping absolute opacity-50" />
                   <div className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" />
                 </div>
                 Live Terminal Stream
              </h3>
              <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono">
                 <Activity size={12} className="text-green-500" />
                 <span>SYS.NOMINAL</span>
              </div>
           </div>

           {/* Glowing background gradient for the terminal */}
           <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-[#38BDF8]/10 blur-[100px] pointer-events-none" />

           {/* Log List */}
           <div className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col gap-3 relative z-10">
              <AnimatePresence initial={false}>
                {filteredLogs.map((log) => (
                   <motion.div 
                     layout
                     key={log.id}
                     initial={{ opacity: 0, y: -20, scale: 0.98 }}
                     animate={{ opacity: 1, y: 0, scale: 1 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     transition={{ duration: 0.3, ease: "easeOut" }}
                     className="group relative flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all overflow-hidden shrink-0"
                   >
                      {/* Hover Gradient line */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-[#38BDF8]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border bg-black/50 backdrop-blur-md ${getTypeStyle(log.type)}`}>
                         <log.icon size={18} />
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 flex flex-col justify-center min-w-0 pt-1">
                         <div className="flex items-center gap-3 mb-1">
                            <span className="text-xs font-mono text-gray-500 w-20 shrink-0">{log.time}</span>
                            <span className={`text-[9px] uppercase font-bold tracking-[0.2em] ${getTypeStyle(log.type).split(' ')[0]}`}>
                               {log.type}
                            </span>
                         </div>
                         <p className="text-gray-300 text-sm md:text-[15px] leading-relaxed break-words">
                            {log.message}
                         </p>
                      </div>
                   </motion.div>
                ))}
              </AnimatePresence>
              
              {filteredLogs.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4 opacity-50">
                  <Filter size={48} strokeWidth={1} />
                  <p className="font-mono text-sm tracking-widest uppercase">No Data Stream</p>
                </div>
              )}
           </div>
        </div>

        {/* Right Column: Tactical Vendor HUD */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
           
           <div className="flex items-center justify-between flex-shrink-0 px-1">
             <h3 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <MapPin size={14} className="text-white" /> Tactical HUD
             </h3>
             <span className="text-[10px] font-mono text-gray-500 tracking-widest">{VENDORS.length} ACTIVE</span>
           </div>
           
           <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
              {VENDORS.map(vendor => (
                 <div key={vendor.id} className="p-6 rounded-[2rem] bg-gradient-to-br from-[#111115] to-[#0A0A0F] border border-white/5 hover:border-white/10 transition-all relative overflow-hidden group shadow-xl">
                    
                    {/* Abstract HUD styling */}
                    <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/[0.02] rounded-full blur-2xl pointer-events-none" />
                    <div className="absolute top-4 right-4 flex gap-1">
                       <div className={`w-1 h-1 rounded-full ${vendor.health === 'critical' ? 'bg-[#D6003C] animate-ping' : 'bg-white/20'}`} />
                       <div className="w-1 h-1 rounded-full bg-white/20" />
                       <div className="w-1 h-1 rounded-full bg-white/20" />
                    </div>

                    <div className="relative z-10">
                       <div className="flex items-center gap-3 mb-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border bg-black/50 backdrop-blur-md shadow-inner ${
                             vendor.health === 'critical' ? 'border-[#D6003C]/30 text-[#D6003C]' : 
                             vendor.status === 'in-transit' ? 'border-yellow-500/30 text-yellow-500' : 
                             'border-green-500/30 text-green-500'
                          }`}>
                             {vendor.status === 'in-transit' ? <Truck size={20} /> : vendor.status === 'offline' ? <AlertTriangle size={20} /> : <Zap size={20} />}
                          </div>
                          <div>
                             <h4 className="text-xl font-medium text-white tracking-tight">{vendor.name}</h4>
                             <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">{vendor.category}</span>
                          </div>
                       </div>
                       
                       {/* Progress Bar HUD */}
                       <div className="mb-4">
                          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">
                             <span>Deployment</span>
                             <span className={vendor.color}>{vendor.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-black rounded-full overflow-hidden border border-white/5">
                             <div 
                               className={`h-full rounded-full transition-all duration-1000 ${
                                 vendor.health === 'critical' ? 'bg-[#D6003C]' : 
                                 vendor.status === 'in-transit' ? 'bg-yellow-500' : 
                                 'bg-green-500'
                               }`} 
                               style={{ width: `${vendor.progress}%` }} 
                             />
                          </div>
                       </div>
                       
                       {/* Telemetry Data Box */}
                       <div className="bg-black/40 rounded-xl p-3 border border-white/5 space-y-2 backdrop-blur-md">
                          <div className="flex items-center justify-between">
                             <span className="text-[10px] font-mono text-gray-500 uppercase">Status Code</span>
                             <span className={`text-[10px] font-bold uppercase tracking-widest ${vendor.color}`}>
                                {vendor.status}
                             </span>
                          </div>
                          <div className="flex items-center justify-between">
                             <span className="text-[10px] font-mono text-gray-500 uppercase">Location / Action</span>
                             <span className="text-[11px] text-gray-300 truncate max-w-[140px] text-right">
                                {vendor.lastUpdate}
                             </span>
                          </div>
                          {vendor.eta !== 'N/A' && vendor.eta !== 'Unknown' && (
                             <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-1">
                                <span className="text-[10px] font-mono text-gray-500 uppercase">Est. Time</span>
                                <span className="text-xs text-white font-mono">{vendor.eta}</span>
                             </div>
                          )}
                       </div>
                    </div>
                 </div>
              ))}
           </div>
        </div>

      </div>
    </div>
  );
}
