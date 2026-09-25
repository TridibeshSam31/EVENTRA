"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { ArrowUpRight, Play, Pause, Clock, CheckCircle2, Circle, Users, DollarSign, Activity, AlertTriangle, Radar, ListTree, Map, ShieldAlert, FileText, Zap, Radio } from "lucide-react";
import { listEvents } from "../../../lib/api/events";
import { getLiveState } from "../../../lib/api/live";
import { getPlan } from "../../../lib/api/planning";
import { getActivityFeed } from "../../../lib/api/observability";
import { listIncidents } from "../../../lib/api/incidents";
import { formatRelativeTime } from "../../../lib/utils/time";
import { TimelineCard } from "../../../components/dashboard/TimelineCard";

export default function DashboardHome() {
  const [events, setEvents] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [liveState, setLiveState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const evList = await listEvents();
        setEvents(evList || []);
        
        if (evList && evList.length > 0) {
          const currentEvent = evList[0];
          setActiveEvent(currentEvent);
          
          try {
            const liveState = await getLiveState(currentEvent.id);
            if (liveState) {
              setLiveState(liveState);
              if (liveState.task_progress) {
                 setTasks(liveState.task_progress.map(t => ({
                  id: t.task_id,
                  title: t.task_name,
                  completed: t.status === 'COMPLETED',
                  assignee: 'System',
                  dueDate: t.planned_end ? new Date(t.planned_end).toLocaleDateString() : 'TBD',
                  urgent: t.priority === 'CRITICAL' || t.priority === 'HIGH'
               })));
              }
            }
          } catch (e) {
            try {
               const plan = await getPlan(currentEvent.id);
               if (plan && plan.tasks) {
                  setTasks(plan.tasks.map(t => ({
                     id: t.id,
                     title: t.name,
                     completed: t.status === 'COMPLETED',
                     assignee: 'System',
                     dueDate: t.planned_end ? new Date(t.planned_end).toLocaleDateString() : 'TBD',
                     urgent: t.priority === 'CRITICAL' || t.priority === 'HIGH'
                  })));
               }
            } catch(e) {}
          }
          
          try {
             const feed = await getActivityFeed(currentEvent.id, 10);
             if (feed && feed.items) {
                setActivity(feed.items.map(a => ({
                   id: a.id,
                   type: a.category,
                   message: a.summary,
                   timestamp: a.timestamp || new Date().toISOString(),
                   actor: a.actor_id || 'System',
                   action: a.status
                })));
             }
          } catch(e) {}

          try {
             const incRes = await listIncidents(currentEvent.id);
             if (incRes && incRes.items) {
                setIncidents(incRes.items.filter(i => i.status !== 'RESOLVED'));
             }
          } catch(e) {}

        }
      } catch (err) {
        console.error("Failed to load events", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-2 text-white">Loading Command Center...</h2>
        <p className="text-muted-foreground text-gray-400">Connecting to operation endpoints.</p>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-2 text-white">No Events Found</h2>
        <p className="text-muted-foreground text-gray-400 mb-6">You have no active events. Start by creating a new one.</p>
        <button onClick={() => window.location.href = '/events/new'} className="bg-[#D6003C] hover:bg-[#FF0D4A] px-6 py-3 rounded-lg text-white font-bold shadow-lg transition-colors">
          Create New Event
        </button>
      </div>
    );
  }

  const sortedTasks = [...tasks].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));

  return (
    <div className="w-full flex flex-col space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Top Header & Stats Bar */}
      <div className="flex flex-col xl:flex-row justify-between xl:items-end gap-10">
        <div className="flex-1">
          <h1 className="text-4xl md:text-[56px] font-normal tracking-tight text-white mb-8">
            System Overview, <span className="font-semibold text-white">Organizer</span>
          </h1>
          
          {/* Functional Operations Metrics */}
          <div className="flex items-end justify-between gap-6 overflow-x-auto pb-4 no-scrollbar">
             <div className="flex flex-col gap-2 min-w-[140px]">
                <span className="text-sm font-medium text-gray-400">System Readiness</span>
                <div className="flex items-center gap-3">
                   <div className="bg-[#222] rounded-full px-4 py-1.5 text-xs text-white">92%</div>
                   <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-white/40 w-[92%] rounded-full" />
                   </div>
                </div>
             </div>
             
             <div className="flex flex-col gap-2 min-w-[140px]">
                <span className="text-sm font-medium text-gray-400">Critical Alerts</span>
                <div className="flex items-center gap-3">
                   <div className="bg-[#D6003C] rounded-full px-4 py-1.5 text-xs text-white font-bold animate-pulse">2 Active</div>
                   <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#D6003C] w-full rounded-full shadow-[0_0_10px_rgba(214,0,60,0.8)]" />
                   </div>
                </div>
             </div>

             <div className="flex flex-col gap-2 min-w-[140px]">
                <span className="text-sm font-medium text-gray-400">Budget Burn Rate</span>
                <div className="flex items-center gap-3">
                   <div className="text-xs text-gray-400">On Track</div>
                   <div className="h-2 flex-1 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJ0cmFuc3BhcmVudCIvPgo8cGF0aCBkPSJNMCAwTDggOFpNOCAwTDAgOFoiIHN0cm9rZT0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjEpIiBzdHJva2Utd2lkdGg9IjEiLz4KPC9zdmc+')] rounded-full overflow-hidden" />
                </div>
             </div>

             <div className="flex flex-col gap-2 min-w-[140px]">
                <span className="text-sm font-medium text-gray-400">Team Online</span>
                <div className="flex items-center gap-3">
                   <div className="border border-white/20 rounded-full px-4 py-1.5 text-xs text-green-400 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                      14 Active
                   </div>
                </div>
             </div>
          </div>
        </div>

        {/* Big Numbers */}
        <div className="flex gap-10 xl:ml-auto">
           <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                 <Users size={18} className="text-gray-400" />
                 <span className="text-5xl md:text-[64px] font-light text-white leading-none tracking-tighter">{(activeEvent.guest_count || 0).toLocaleString()}</span>
              </div>
              <span className="text-sm font-medium text-gray-400 mt-2">Registrations</span>
           </div>
           <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                 <span className="text-5xl md:text-[64px] font-light text-white leading-none tracking-tighter">
                    <span className="text-3xl text-gray-400">$</span>
                    {liveState?.budget_deviation?.total_spent ? Math.floor(liveState.budget_deviation.total_spent / 1000) : 0}
                    <span className="text-3xl text-gray-400">k</span>
                    <span className="text-3xl text-gray-600 mx-2">/</span>
                    <span className="text-4xl text-gray-300">
                       {Math.floor((liveState?.budget_deviation?.total_budget || activeEvent?.total_budget || 0) / 1000)}k
                    </span>
                 </span>
              </div>
              <span className="text-sm font-medium text-gray-400 mt-2">Spend / Budget</span>
           </div>
           <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                 <Activity size={18} className="text-gray-400" />
                 <span className="text-5xl md:text-[64px] font-light text-white leading-none tracking-tighter">{liveState?.progress_percent ? Math.round(liveState.progress_percent) : 0}<span className="text-3xl text-gray-400">%</span></span>
              </div>
              <span className="text-sm font-medium text-gray-400 mt-2">Overall Health</span>
           </div>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 pt-4">
        
        {/* Card 1: Event Control Center */}
        <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-4 flex flex-col justify-between relative overflow-hidden h-[300px] group cursor-pointer hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl hover:bg-white/[0.05] transition-all duration-300">
           <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F] via-black/40 to-transparent z-10" />
           <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center group-hover:scale-105 transition-transform duration-700" />
           <div className="relative z-20">
              <div className="bg-black/50 backdrop-blur-md border border-white/10 rounded-full px-3 py-1 text-[11px] font-medium text-white w-fit uppercase tracking-widest mb-2">
                 Pre-production Phase
              </div>
           </div>
           <div className="relative z-20 flex flex-col justify-end">
              <h3 className="text-2xl font-medium text-white leading-tight mb-1">{activeEvent.name}</h3>
              <p className="text-sm text-gray-400 mb-6">{activeEvent.location || activeEvent.venue || "Moscone Center"} • {activeEvent.date || activeEvent.dates || "Oct 24-26"}</p>
              
              <button 
                onClick={() => window.location.href = `/events/${activeEvent.id}/live`}
                className="w-full py-3.5 rounded-2xl bg-[#D6003C] hover:bg-[#FF0D4A] text-white text-sm font-bold uppercase tracking-wider transition-colors shadow-[0_0_20px_rgba(214,0,60,0.4)] flex items-center justify-center gap-2 group/btn"
              >
                 <Radio size={16} className="animate-pulse" />
                 Enter Control Room
                 <ArrowUpRight size={16} className="opacity-50 group-hover/btn:opacity-100 transition-opacity" />
              </button>
           </div>
        </div>

        {/* Card 2: AI Risk Radar */}
        <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 relative flex flex-col hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl hover:bg-white/[0.05] transition-all duration-300 group">
           <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                 <Radar size={20} className="text-[#D6003C]" />
                 <h3 className="text-lg font-medium text-white">Risk Radar</h3>
              </div>
              <div 
                onClick={() => window.location.href = `/events/${activeEvent.id}/recovery`}
                className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors"
              >
                 <ArrowUpRight size={16} className="text-white" />
              </div>
           </div>
           
           <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2 no-scrollbar">
              {incidents.slice(0, 3).map(inc => (
                 <div key={inc.id} className={`p-4 rounded-2xl bg-black/40 border relative overflow-hidden group ${inc.severity === 'CRITICAL' ? 'border-[#D6003C]/30' : 'border-yellow-500/30'}`}>
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${inc.severity === 'CRITICAL' ? 'bg-[#D6003C]' : 'bg-yellow-500'}`} />
                    <div className="flex items-start gap-3">
                       <AlertTriangle size={16} className={`mt-0.5 flex-shrink-0 ${inc.severity === 'CRITICAL' ? 'text-[#D6003C]' : 'text-yellow-500'}`} />
                       <div>
                          <p className="text-sm font-medium text-white leading-snug">{inc.title}</p>
                          <p className="text-xs text-gray-400 mt-1">{inc.description}</p>
                       </div>
                    </div>
                 </div>
              ))}
              {incidents.length === 0 && (
                 <p className="text-gray-500 text-sm mt-4">No active risks detected.</p>
              )}
           </div>
        </div>

        {/* Card 3: Financials / Budget Utilization */}
        <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 flex flex-col items-center justify-center relative hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl hover:bg-white/[0.05] transition-all duration-300 group">
           <div className="absolute top-6 right-6 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors">
              <ArrowUpRight size={16} className="text-white" />
           </div>
           <h3 className="text-lg font-medium text-white absolute top-6 left-6">Budget Burn</h3>
           
           {/* Circular SVG Gauge for Budget */}
           <div className="relative w-44 h-44 mt-8 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                 <circle cx="50" cy="50" r="45" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                 <circle cx="50" cy="50" r="45" fill="transparent" stroke="#D6003C" strokeWidth="8" strokeDasharray="283" strokeDashoffset={283 - (283 * ((liveState?.budget_deviation?.total_spent || 0) / (liveState?.budget_deviation?.total_budget || activeEvent?.total_budget || 1)))} strokeLinecap="round" className="drop-shadow-[0_0_8px_rgba(214,0,60,0.6)] transition-all duration-1000" />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                 <span className="text-3xl font-light text-white tracking-tighter">
                   ${liveState?.budget_deviation?.total_spent ? Math.floor(liveState.budget_deviation.total_spent / 1000) : 0}k
                 </span>
                 <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest mt-1 text-center leading-tight">
                   Spent of<br/>${Math.floor((liveState?.budget_deviation?.total_budget || activeEvent?.total_budget || 0) / 1000)}k
                 </span>
              </div>
           </div>

           <div className="mt-6 w-full flex items-center justify-between text-xs font-medium text-gray-400 bg-white/5 px-4 py-2 rounded-xl">
              <span>Remaining Buffer:</span>
              <span className="text-white">${((liveState?.budget_deviation?.total_budget || activeEvent?.total_budget || 0) - (liveState?.budget_deviation?.total_spent || 0)).toLocaleString()}</span>
           </div>
        </div>

        {/* Card 4: Activity Log */}
        <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 relative flex flex-col h-[300px] hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl hover:bg-white/[0.05] transition-all duration-300 group">
           <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-medium text-white">System Logs</h3>
              <Activity size={18} className="text-gray-400" />
           </div>

           <div className="flex-1 flex flex-col gap-5 overflow-y-auto pr-2 no-scrollbar relative before:absolute before:inset-0 before:ml-3 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
              {activity.slice(0, 4).map((act, idx) => (
                <div key={act.id || idx} className="relative flex items-start gap-4 text-sm group/act">
                   <div className="absolute left-0 mt-1.5 w-2 h-2 rounded-full bg-white/20 border-2 border-[#111115] z-10 group-hover/act:bg-[#D6003C] transition-colors" />
                   <div className="pl-6">
                      <p className="text-gray-300 leading-snug">
                         <span className="font-semibold text-white">{act.actor}</span> {act.action}
                      </p>
                      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-1">{formatRelativeTime(act.timestamp)}</p>
                   </div>
                </div>
              ))}
              {(!activity || activity.length === 0) && (
                 <div className="relative flex items-start gap-4 text-sm">
                   <div className="absolute left-0 mt-1.5 w-2 h-2 rounded-full bg-white/20 border-2 border-[#111115] z-10" />
                   <div className="pl-6">
                      <p className="text-gray-300 leading-snug">
                         <span className="font-semibold text-white">System</span> initialized operations protocol.
                      </p>
                      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-1">Just now</p>
                   </div>
                </div>
              )}
           </div>
        </div>

      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Command Modules (Col 1) */}
        <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-4 flex flex-col gap-2 hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl hover:bg-white/[0.05] transition-all duration-300 group">
           {[
             { name: 'Floorplan Architect', icon: Map },
             { name: 'Vendor Operations', icon: ListTree },
             { name: 'Contracts & Docs', icon: FileText },
             { name: 'Security & Access', icon: ShieldAlert }
           ].map((item, idx) => (
             <div key={idx} className="w-full p-4 flex items-center justify-between hover:bg-white/5 rounded-2xl cursor-pointer transition-colors group border border-transparent hover:border-white/5">
                <div className="flex items-center gap-3">
                   <item.icon size={16} className="text-gray-500 group-hover:text-white transition-colors" />
                   <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">{item.name}</span>
                </div>
                <ArrowUpRight size={14} className="text-gray-500 opacity-0 -translate-y-1 translate-x-1 group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0 transition-all" />
             </div>
           ))}
           
           <div className="mt-auto pt-4">
              <div className="p-4 rounded-2xl bg-[#0A0A0F] flex items-center justify-between border border-white/5 shadow-inner">
                 <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                    <p className="text-xs font-semibold text-white uppercase tracking-widest">Sys Health</p>
                 </div>
                 <span className="text-xs text-green-500 font-mono">OPTIMAL</span>
              </div>
           </div>
        </div>

        {/* Master Schedule / Timeline (Col 2 & 3) */}
        <TimelineCard />

        {/* Priority Action Items (Task list) (Col 4) */}
        <div className="bg-[#0B0B0F] border border-white/5 rounded-3xl p-6 shadow-2xl relative flex flex-col max-h-[400px] hover:border-white/10 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(214,0,60,0.05)] transition-all duration-300 group">
           <div className="flex justify-between items-end mb-8">
              <h3 className="text-lg font-medium text-white">Action Items</h3>
              <span className="text-3xl font-light text-white leading-none">
                {sortedTasks.filter(t => t.completed).length}/{sortedTasks.length || 3}
              </span>
           </div>

           <div className="flex-1 space-y-4 overflow-y-auto pr-2 no-scrollbar">
              {sortedTasks.map((task, idx) => (
                <div key={task.id} className="flex items-center justify-between group cursor-pointer">
                   <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center flex-shrink-0 group-hover:bg-white/10 transition-colors">
                         <CheckCircle2 size={16} className={task.completed ? "text-[#D6003C]" : "text-gray-500"} />
                      </div>
                      <div>
                         <p className={`text-sm font-medium transition-colors ${task.completed ? 'text-gray-600 line-through' : 'text-gray-200'}`}>
                           {task.title}
                         </p>
                         <p className={`text-[10px] font-medium mt-0.5 ${task.urgent && !task.completed ? 'text-[#D6003C]' : 'text-gray-500'}`}>
                           {task.urgent && !task.completed ? 'URGENT • ' : ''}{task.dueDate}
                         </p>
                      </div>
                   </div>
                   <div>
                      {task.completed ? (
                         <div className="w-4 h-4 rounded-full bg-[#D6003C] flex items-center justify-center shadow-[0_0_8px_rgba(214,0,60,0.5)]">
                            <CheckCircle2 size={10} className="text-white" />
                         </div>
                      ) : (
                         <div className="w-4 h-4 rounded-full bg-white/10" />
                      )}
                   </div>
                </div>
              ))}
              {sortedTasks.length === 0 && (
                 <p className="text-sm text-gray-500 text-center py-4">No tasks.</p>
              )}
           </div>
        </div>

      </div>

    </div>
  );
}
