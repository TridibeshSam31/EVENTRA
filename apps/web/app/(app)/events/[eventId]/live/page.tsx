"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Radio, Users, User, Mic, Video, Activity, AlertTriangle, Shield, Clock, Zap, Map, Wifi, Battery, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { getLiveState } from '../../../../../lib/api/live';
import { getActivityFeed } from '../../../../../lib/api/observability';
import { getPlan } from '../../../../../lib/api/planning';

export default function LiveOpsPage() {
  const params = useParams();
  const eventId = params.eventId as string;

  const [liveState, setLiveState] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!eventId) return;
      try {
        const [stateRes, activityRes, planRes] = await Promise.all([
          getLiveState(eventId).catch(() => null),
          getActivityFeed(eventId).catch(() => ({ items: [] })),
          getPlan(eventId).catch(() => ({ tasks: [] }))
        ]);
        if (stateRes) setLiveState(stateRes);
        if (activityRes?.items) setActivities(activityRes.items);
        if (planRes?.tasks) setTasks(planRes.tasks);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [eventId]);

  const liveCap = liveState?.venue_capacity_current || 4250;
  const maxCap = liveState?.venue_capacity_max || 5000;
  const currentPhase = liveState?.current_phase || "Tech Launch Keynote";

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              <span className="absolute w-4 h-4 rounded-full bg-[#D6003C] animate-ping opacity-75" />
              <span className="relative w-2 h-2 rounded-full bg-white" />
            </div>
            Live <span className="font-bold text-[#D6003C]">Control Room</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-7">System running in active event mode.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-[#0B0B0F] border border-white/5 rounded-xl px-4 py-2">
             <Clock size={16} className="text-gray-400" />
             <span className="text-sm font-mono text-white">{new Date().toLocaleTimeString()}</span>
          </div>
          <button className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.1)] hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]">
            <AlertTriangle size={16} /> <span className="hidden sm:inline">Broadcast</span> Emergency
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-y-auto no-scrollbar pb-20 xl:pb-0">
        
        {/* Left Column (Main Feed & Status) */}
        <div className="xl:col-span-8 flex flex-col gap-6 h-full">
           
           {/* Live Session & Crowd Telemetry Split */}
           <div className="flex flex-col md:flex-row gap-6 xl:h-[55%] flex-shrink-0">
             
             {/* Current Session Tracker */}
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="flex-1 bg-gradient-to-br from-[#0B0B0F] to-[#111115] border border-[#D6003C]/20 rounded-3xl p-6 md:p-8 flex flex-col justify-between relative overflow-hidden group shadow-2xl hover:border-[#D6003C]/40 transition-colors"
             >
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#D6003C]/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                
                <div className="relative z-10 flex justify-between items-start mb-6">
                   <div className="bg-[#D6003C]/10 border border-[#D6003C]/30 rounded-full px-4 py-1.5 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#D6003C] animate-pulse" />
                      <span className="text-[10px] md:text-xs font-bold text-[#D6003C] uppercase tracking-widest">Live Session</span>
                   </div>
                   <div className="text-right">
                      <span className="text-sm font-mono text-gray-400 block mb-1">Time Elapsed</span>
                      <span className="text-2xl font-light text-white">45:38</span>
                   </div>
                </div>
                
                <div className="relative z-10">
                   <h2 className="text-3xl md:text-4xl font-medium text-white mb-2 tracking-tight leading-tight">{currentPhase}</h2>
                   <p className="text-gray-400 flex items-center gap-2"><User size={16} /> Speaker: Jane Doe, VP Engineering</p>
                </div>

                <div className="relative z-10 mt-8">
                   <div className="flex justify-between text-xs font-medium text-gray-400 mb-2">
                      <span>Progress</span>
                      <span>14:22 remaining</span>
                   </div>
                   <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#D6003C] to-[#FF0D4A] w-[75%] rounded-full shadow-[0_0_10px_rgba(214,0,60,0.5)]" />
                   </div>
                </div>
             </motion.div>

             {/* Venue Crowd Density */}
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.1 }}
               className="flex-1 bg-[#0B0B0F] border border-white/5 rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden group shadow-2xl hover:border-white/10 transition-colors"
             >
                <div className="flex justify-between items-center mb-6">
                   <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                      <Map size={16} className="text-blue-500" /> Zone Density
                   </h3>
                   <span className="text-xs font-mono text-gray-500 bg-white/5 px-2 py-1 rounded-md border border-white/10">LIVE</span>
                </div>

                <div className="flex-1 flex flex-col justify-center gap-5">
                   <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                         <span className="text-sm font-medium text-white">Main Stage</span>
                         <span className="text-xs text-gray-500">2,850 pax</span>
                      </div>
                      <div className="w-1/2 flex items-center gap-3">
                         <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[#D6003C] w-[95%] rounded-full" />
                         </div>
                         <span className="text-xs font-mono text-[#D6003C] w-8 text-right">95%</span>
                      </div>
                   </div>

                   <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                         <span className="text-sm font-medium text-white">Hall A (Expo)</span>
                         <span className="text-xs text-gray-500">1,120 pax</span>
                      </div>
                      <div className="w-1/2 flex items-center gap-3">
                         <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-500 w-[65%] rounded-full" />
                         </div>
                         <span className="text-xs font-mono text-yellow-500 w-8 text-right">65%</span>
                      </div>
                   </div>

                   <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                         <span className="text-sm font-medium text-white">Lobby</span>
                         <span className="text-xs text-gray-500">280 pax</span>
                      </div>
                      <div className="w-1/2 flex items-center gap-3">
                         <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 w-[20%] rounded-full" />
                         </div>
                         <span className="text-xs font-mono text-green-500 w-8 text-right">20%</span>
                      </div>
                   </div>
                </div>
             </motion.div>
           </div>

           {/* Metrics Row */}
           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 flex flex-col justify-between hover:bg-white/[0.02] hover:border-white/10 hover:-translate-y-1 transition-all group shadow-xl">
                 <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <Users size={16} className="text-[#D6003C]" />
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest">Live Capacity</span>
                 </div>
                 <div>
                    <span className="text-2xl md:text-3xl font-light text-white">{liveCap}</span>
                    <span className="text-[10px] md:text-xs text-gray-500 ml-1 md:ml-2">/ {maxCap}</span>
                 </div>
              </motion.div>
              
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 flex flex-col justify-between hover:bg-white/[0.02] hover:border-white/10 hover:-translate-y-1 transition-all group shadow-xl">
                 <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <Zap size={16} className="text-yellow-500" />
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest">Power Draw</span>
                 </div>
                 <div>
                    <span className="text-2xl md:text-3xl font-light text-white">45<span className="text-lg md:text-xl text-gray-400">kW</span></span>
                    <span className="text-[10px] md:text-xs text-green-500 ml-1 md:ml-2">Optimal</span>
                 </div>
              </motion.div>
              
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 flex flex-col justify-between hover:bg-white/[0.02] hover:border-white/10 hover:-translate-y-1 transition-all group shadow-xl">
                 <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <Shield size={16} className="text-blue-500" />
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest">Active Staff</span>
                 </div>
                 <div>
                    <span className="text-2xl md:text-3xl font-light text-white">124</span>
                    <span className="text-[10px] md:text-xs text-gray-500 ml-1 md:ml-2">On Floor</span>
                 </div>
              </motion.div>
              
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 flex flex-col justify-between hover:bg-white/[0.02] hover:border-white/10 hover:-translate-y-1 transition-all group shadow-xl">
                 <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <Activity size={16} className="text-green-500" />
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest">Sys Health</span>
                 </div>
                 <div>
                    <span className="text-2xl md:text-3xl font-light text-green-500">99.9%</span>
                 </div>
              </motion.div>
           </div>
           
           {/* Comm Channels */}
           <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 md:p-6 flex-1 flex flex-col relative overflow-hidden hover:border-white/10 transition-all group shadow-2xl min-h-[200px]">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="text-xs md:text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                   <Radio size={16} className="text-[#D6003C]" /> Radio Channels
                </h3>
             </div>
             <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 overflow-y-auto no-scrollbar">
                {[
                  { name: 'CH 1 (Production)', active: true, users: 14, talking: 'Alex M.' },
                  { name: 'CH 2 (Security)', active: true, users: 42, talking: null },
                  { name: 'CH 3 (F&B)', active: false, users: 18, talking: null },
                  { name: 'CH 4 (Medical)', active: false, users: 5, talking: null },
                ].map((ch, idx) => (
                  <div key={idx} className={`p-3 md:p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:-translate-y-1 ${ch.active ? 'bg-black/40 border-[#D6003C]/30 shadow-[0_0_15px_rgba(214,0,60,0.1)]' : 'bg-[#111115] border-white/5 hover:border-white/10'}`}>
                     <div className="flex justify-between items-start mb-3">
                        <span className={`text-[10px] md:text-xs font-bold uppercase tracking-wider ${ch.active ? 'text-white' : 'text-gray-400'}`}>{ch.name}</span>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ch.active ? 'bg-[#D6003C] animate-pulse' : 'bg-gray-600'}`} />
                     </div>
                     {ch.talking ? (
                        <div className="flex items-center gap-1.5 text-[10px] md:text-xs font-medium text-[#D6003C] bg-[#D6003C]/10 w-fit px-2 py-1 rounded-md border border-[#D6003C]/20">
                           <Mic size={10} className="animate-pulse" /> {ch.talking} talking
                        </div>
                     ) : (
                        <div className="flex items-center gap-1.5 text-[10px] md:text-xs font-medium text-gray-500">
                           <Users size={10} /> {ch.users} online
                        </div>
                     )}
                  </div>
                ))}
             </div>
           </motion.div>
        </div>

        {/* Right Column (Timeline & Logs) */}
        <div className="xl:col-span-4 flex flex-col gap-6 h-[800px] xl:h-full">
           
           {/* Live Timeline */}
           <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 md:p-6 flex-1 flex flex-col max-h-[50%] overflow-hidden relative group hover:border-white/10 shadow-2xl transition-all">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#D6003C]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <h3 className="text-xs md:text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                   <Activity size={16} className="text-[#D6003C]" /> Run of Show
                </h3>
              </div>
              
              <div className="flex-1 overflow-y-auto no-scrollbar relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-white/5 space-y-6">
                 
                 {tasks && tasks.length > 0 ? (
                   tasks.slice(0, 5).map((task, idx) => {
                     const isLive = task.status === 'IN_PROGRESS';
                     const isDone = task.status === 'COMPLETED';
                     return (
                       <div key={task.id} className="relative pl-8 group/item">
                          <div className={`absolute left-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center z-10 transition-colors ${isLive ? 'bg-[#D6003C]/20 border border-[#D6003C] shadow-[0_0_15px_rgba(214,0,60,0.5)]' : 'bg-[#111115] border border-white/10 group-hover/item:border-white/30'}`}>
                             {isLive ? <div className="w-2 h-2 rounded-full bg-[#D6003C] animate-pulse" /> : isDone ? <CheckCircle2 size={12} className="text-gray-500" /> : <div className="w-2 h-2 rounded-full bg-gray-500" />}
                          </div>
                          
                          {isLive ? (
                            <div className="bg-[#D6003C]/5 border border-[#D6003C]/20 rounded-2xl p-3 -mt-2 hover:bg-[#D6003C]/10 transition-colors cursor-pointer">
                               <div className="flex justify-between items-center mb-1">
                                  <p className="text-[10px] md:text-xs font-mono text-[#D6003C]">{new Date(task.planned_start || Date.now()).toLocaleTimeString()} (LIVE)</p>
                                  <span className="text-[9px] uppercase tracking-widest text-[#D6003C] font-bold bg-[#D6003C]/20 px-2 py-0.5 rounded-full border border-[#D6003C]/30">On Time</span>
                               </div>
                               <p className="text-sm font-medium text-white">{task.name}</p>
                               <p className="text-[10px] md:text-xs text-gray-400 mt-1">{task.phase || 'Execution'}</p>
                            </div>
                          ) : (
                            <div>
                               <p className="text-[10px] md:text-xs font-mono text-gray-500 mb-0.5">{new Date(task.planned_start || Date.now()).toLocaleTimeString()}</p>
                               <p className={`text-sm font-medium ${isDone ? 'text-gray-400 line-through' : 'text-white'}`}>{task.name}</p>
                               <p className="text-[10px] md:text-xs text-gray-400">{task.phase || 'Execution'}</p>
                            </div>
                          )}
                       </div>
                     );
                   })
                 ) : (
                    <div className="text-sm text-gray-500 italic pl-4">No tasks found.</div>
                 )}
              </div>
           </motion.div>

           {/* Command Log */}
           <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-5 md:p-6 flex-1 flex flex-col max-h-[50%] hover:border-white/10 shadow-2xl transition-all group relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <h3 className="text-xs md:text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                   <MessageSquare size={16} className="text-blue-500" /> Command Log
                </h3>
              </div>
              
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 md:space-y-4">
                 {activities && activities.length > 0 ? (
                    activities.map((act) => (
                      <div key={act.id} className="bg-[#111115] border border-white/5 rounded-2xl p-3 text-xs md:text-sm hover:bg-white/[0.02] transition-colors">
                         <span className="text-[10px] md:text-xs font-mono text-gray-500 block mb-1">{new Date(act.timestamp).toLocaleTimeString()}</span>
                         <span className="text-gray-300">
                           <span className={`font-semibold mr-1 ${act.severity === 'WARNING' || act.severity === 'ERROR' ? 'text-yellow-500' : 'text-white'}`}>{act.source}:</span>
                           {act.action} - {act.details?.reason || act.details?.description || 'Event logged'}
                         </span>
                      </div>
                    ))
                 ) : (
                    <div className="text-sm text-gray-500 italic">No activity logs available.</div>
                 )}
              </div>

              {/* Chat Input */}
              <div className="mt-4 pt-4 border-t border-white/5 relative flex-shrink-0">
                <input 
                  type="text" 
                  placeholder="Type command or message..." 
                  className="w-full bg-[#111115] border border-white/10 rounded-xl py-3 pl-4 pr-16 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#D6003C]/50 focus:ring-1 focus:ring-[#D6003C]/50 transition-all"
                />
                <button className="absolute right-2 top-1/2 -translate-y-1/2 mt-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors">
                  Send
                </button>
              </div>
           </motion.div>
        </div>

      </div>
    </div>
  );
}
