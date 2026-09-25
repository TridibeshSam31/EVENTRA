"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  CheckCircle2, AlertTriangle, Box, Activity, XCircle
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { getFinalExecutionPlan } from '../../../../../lib/api/planning';
import type { FinalExecutionPlan } from '../../../../../types/api';

export default function PlanPage() {
  const [plan, setPlan] = useState<FinalExecutionPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const params = useParams();

  useEffect(() => {
    async function loadPlan() {
      if (!params.eventId) return;
      setIsLoading(true);
      try {
        const finalPlan = await getFinalExecutionPlan(params.eventId as string);
        setPlan(finalPlan);
      } catch (err) {
        console.error("Failed to load execution plan", err);
        setError("Failed to load authoritative execution plan.");
      } finally {
        setIsLoading(false);
      }
    }
    loadPlan();
  }, [params.eventId]);

  if (isLoading) {
    return (
       <div className="flex flex-col h-full items-center justify-center bg-black">
          <Activity className="w-8 h-8 text-[#D6003C] animate-spin mb-4" />
          <p className="text-gray-400 font-mono text-xs uppercase tracking-widest">Compiling Workflow...</p>
       </div>
    );
  }

  if (error || !plan) {
    return (
       <div className="flex flex-col h-full items-center justify-center bg-black">
          <AlertTriangle className="w-12 h-12 text-[#D6003C] mb-4" />
          <p className="text-white font-medium">{error || "No plan found. This event might not have enough details specified yet."}</p>
       </div>
    );
  }

  const getReadinessColor = (status: string) => {
    switch(status) {
      case 'READY': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
      case 'PARTIALLY_READY': return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
      case 'BLOCKED': return 'text-[#D6003C] bg-[#D6003C]/10 border-[#D6003C]/30';
      case 'INCOMPLETE': return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
      default: return 'text-white bg-white/10 border-white/30';
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-y-auto no-scrollbar p-6 md:p-12 bg-[#050505] font-sans relative">
       {/* Simple Header */}
       <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6 relative z-10">
          <div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tighter text-white">
              Event <span className="font-bold">Workflow</span>
            </h1>
            <p className="text-gray-400 mt-3 text-sm max-w-xl leading-relaxed">
               The critical operational path for {plan.event_summary.event_name}. 
               This authoritative sequence dictates the exact order of execution on the ground.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className={`px-5 py-2 rounded-full border text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${getReadinessColor(plan.readiness_status)}`}>
               {plan.readiness_status === 'READY' ? <CheckCircle2 size={16} /> : 
                plan.readiness_status === 'BLOCKED' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
               {plan.readiness_status.replace('_', ' ')}
            </div>
          </div>
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20">
          {/* Main Workflow Timeline */}
          <div className="lg:col-span-8">
             <div className="flex flex-col gap-8 relative before:absolute before:inset-0 before:ml-[23px] before:w-px before:bg-white/10 before:-z-10">
                {plan.critical_path.map((cp, idx) => {
                   const fullTask = plan.tasks.find(t => t.task_id === cp.task_id);
                   
                   return (
                     <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        key={cp.task_id} 
                        className="relative flex gap-6 items-start group"
                     >
                        {/* Node Indicator */}
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border-4 border-[#050505] z-10 transition-colors ${
                           cp.status === 'COMPLETED' ? 'bg-[#16A34A] text-white shadow-[0_0_15px_rgba(22,163,74,0.3)]' :
                           cp.status === 'IN_PROGRESS' ? 'bg-[#0284C7] text-white shadow-[0_0_15px_rgba(2,132,199,0.3)]' :
                           'bg-[#111111] text-gray-500 group-hover:bg-[#1a1a1a] group-hover:text-white'
                        }`}>
                           <span className="text-sm font-bold font-mono">{idx + 1}</span>
                        </div>
                        
                        {/* Node Content */}
                        <div className="flex-1 bg-[#0A0A0A] border border-white/5 hover:border-white/10 hover:bg-[#0f0f0f] transition-all rounded-2xl p-6 shadow-sm relative">
                           <div className="flex justify-between items-start mb-2 pr-10">
                              <h3 className="text-lg font-medium text-white group-hover:text-[#38BDF8] transition-colors">{cp.task_name}</h3>
                              <span className="text-xs text-gray-500 font-mono tracking-widest">{cp.duration_minutes} MIN</span>
                           </div>

                           {/* Task Description Displayed Right Away */}
                           {fullTask?.description ? (
                              <p className="text-sm text-gray-400 leading-relaxed mb-4 whitespace-pre-wrap">
                                 {fullTask.description}
                              </p>
                           ) : (
                              <p className="text-sm text-gray-600 italic mb-4">
                                 No detailed description provided for this operational task.
                              </p>
                           )}

                           {cp.assigned_provider_name ? (
                              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase text-emerald-400 mt-2">
                                 <CheckCircle2 size={14} /> Assigned: {cp.assigned_provider_name}
                              </div>
                           ) : (
                              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase text-gray-500 mt-2">
                                 <Box size={14} /> No Provider Assigned
                              </div>
                           )}
                        </div>
                     </motion.div>
                   );
                })}
                {plan.critical_path.length === 0 && (
                   <div className="text-gray-500 italic pl-16">No workflow tasks generated for this event yet.</div>
                )}
             </div>
          </div>

          {/* Minimal Side Summary */}
          <div className="lg:col-span-4 flex flex-col gap-8 relative z-10">
             {/* Simple Stats Card */}
             <div className="bg-transparent border border-white/5 p-8 rounded-3xl">
                <h4 className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-8">Plan Summary</h4>
                
                <div className="flex flex-col gap-8">
                   <div>
                      <div className="text-4xl font-light text-white tracking-tighter mb-1">
                         {plan.total_critical_duration_minutes}
                      </div>
                      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-widest">Total Duration (Min)</div>
                   </div>
                   
                   <div>
                      <div className="text-4xl font-light text-white tracking-tighter mb-1">
                         {plan.resource_summary.allocated_count}
                      </div>
                      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-widest">Resources Allocated</div>
                   </div>
                   
                   <div>
                      <div className="text-4xl font-light text-white tracking-tighter mb-1">
                         {new Intl.NumberFormat('en-IN', { notation: 'compact', compactDisplay: 'short', style: 'currency', currency: plan.budget_summary.currency }).format(Number(plan.budget_summary.total_estimated))}
                      </div>
                      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-widest">Estimated Cost</div>
                   </div>
                </div>
             </div>

             {/* Minimal Alerts */}
             {(plan.blockers.length > 0) && (
                <div className="bg-[#D6003C]/5 border border-[#D6003C]/20 p-6 rounded-3xl">
                   <h4 className="text-[10px] text-[#D6003C] font-bold uppercase tracking-widest mb-5 flex items-center gap-2">
                      <XCircle size={14} /> Critical Blockers ({plan.blockers.length})
                   </h4>
                   <div className="flex flex-col gap-4">
                      {plan.blockers.slice(0, 3).map((b, i) => (
                         <div key={i} className="text-xs text-gray-300 leading-relaxed">
                            <span className="font-bold text-white block mb-1 uppercase tracking-wider">{b.reason_code}</span>
                            {b.message}
                         </div>
                      ))}
                      {plan.blockers.length > 3 && (
                         <div className="text-xs text-[#D6003C] font-bold mt-2">
                            +{plan.blockers.length - 3} MORE BLOCKERS
                         </div>
                      )}
                   </div>
                </div>
             )}
          </div>
       </div>
    </div>
  );
}
