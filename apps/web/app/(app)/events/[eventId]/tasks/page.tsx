"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle2, AlertTriangle, Search, 
  Activity, Box, Zap, GitCommit, ListTodo, CheckSquare
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { getFinalExecutionPlan } from '../../../../../lib/api/planning';
import { updateTaskStatus } from '../../../../../lib/api/live';
import type { FinalExecutionPlan, ExecutionPlanTask } from '../../../../../types/api';

export default function TasksPage() {
  const [plan, setPlan] = useState<FinalExecutionPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const params = useParams();

  const fetchTasks = async () => {
    try {
      if (!params.eventId) return;
      const finalPlan = await getFinalExecutionPlan(params.eventId as string);
      setPlan(finalPlan);
    } catch (err) {
      console.error("Failed to load tasks", err);
      setError("Failed to load operational tasks.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [params.eventId]);

  const handleCompleteTask = async (taskId: string) => {
    if (!params.eventId) return;
    try {
       setPlan(prev => {
          if (!prev) return prev;
          const updatedTasks = prev.tasks.map(t => 
             t.task_id === taskId ? { ...t, status: 'COMPLETED' } : t
          );
          return { ...prev, tasks: updatedTasks };
       });
       await updateTaskStatus(params.eventId as string, taskId, 'COMPLETED');
    } catch (error) {
       console.error("Failed to complete task", error);
       fetchTasks();
    }
  };

  if (isLoading) {
    return (
       <div className="flex flex-col h-full items-center justify-center bg-[#020202]">
          <Activity className="w-10 h-10 text-[#38BDF8] animate-spin mb-4" />
          <p className="text-gray-400 font-mono text-xs uppercase tracking-[0.3em]">Initializing Board...</p>
       </div>
    );
  }

  if (error || !plan) {
    return (
       <div className="flex flex-col h-full items-center justify-center bg-[#020202]">
          <AlertTriangle className="w-12 h-12 text-[#D6003C] mb-4" />
          <p className="text-white font-medium">{error || "No operational tasks found."}</p>
       </div>
    );
  }

  const totalTasks = plan.tasks.length;
  const completedTasks = plan.tasks.filter(t => t.status === 'COMPLETED').length;
  const progressPercent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  const filteredTasks = plan.tasks.filter(t => 
     t.task_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     (t.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pendingTasks = filteredTasks.filter(t => t.status === 'PENDING' || t.status === 'READY');
  const inProgressTasks = filteredTasks.filter(t => t.status === 'IN_PROGRESS');
  const completedTasksList = filteredTasks.filter(t => t.status === 'COMPLETED');

  const columns = [
    { id: 'pending', title: 'UPCOMING', icon: ListTodo, color: 'text-amber-400', bg: 'bg-amber-400', border: 'border-amber-400/20', tasks: pendingTasks },
    { id: 'in_progress', title: 'ACTIVE', icon: Zap, color: 'text-[#38BDF8]', bg: 'bg-[#38BDF8]', border: 'border-[#38BDF8]/20', tasks: inProgressTasks },
    { id: 'completed', title: 'RESOLVED', icon: CheckSquare, color: 'text-[#16A34A]', bg: 'bg-[#16A34A]', border: 'border-[#16A34A]/20', tasks: completedTasksList },
  ];

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-y-auto no-scrollbar bg-[#020202] font-sans text-white relative">
      
      {/* Immersive Background Gradients */}
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-[#38BDF8]/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#D6003C]/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="p-6 md:p-10 relative z-10 flex flex-col h-full">
         
         {/* Top Progress & Header */}
         <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
               <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] uppercase tracking-widest font-bold mb-4">
                  <Activity size={12} className="text-[#38BDF8]" /> Live Operations
               </div>
               <h1 className="text-4xl md:text-5xl font-light tracking-tighter text-white">
                 Task <span className="font-bold">Matrix</span>
               </h1>
            </div>

            <div className="flex flex-col items-end w-full md:w-1/3">
               <div className="flex justify-between w-full mb-2">
                  <span className="text-xs text-gray-500 font-mono uppercase tracking-widest">Progress</span>
                  <span className="text-xs text-white font-bold">{progressPercent}%</span>
               </div>
               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                     initial={{ width: 0 }}
                     animate={{ width: `${progressPercent}%` }}
                     transition={{ duration: 1.5, ease: "circOut" }}
                     className="h-full bg-gradient-to-r from-[#0284C7] to-[#38BDF8] rounded-full relative shadow-[0_0_20px_rgba(56,189,248,0.5)]"
                  />
               </div>
            </div>
         </div>

         {/* Toolbar */}
         <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8 bg-white/5 border border-white/10 p-3 rounded-2xl backdrop-blur-xl">
           <div className="relative w-full md:w-80">
             <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
             <input 
               type="text" 
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               placeholder="Search tasks..." 
               className="bg-black/50 border border-white/5 rounded-xl pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#38BDF8] focus:bg-black transition-all w-full text-white placeholder:text-gray-500"
             />
           </div>
           
           <div className="text-[10px] text-gray-500 font-bold tracking-widest uppercase flex items-center gap-2 px-4">
              <Activity size={14} className="text-[#38BDF8]" /> 
              Agent Managed Board
           </div>
         </div>

         {/* Kanban Board */}
         <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
            {columns.map((col, colIdx) => (
               <div key={col.id} className="flex flex-col h-full">
                  {/* Column Header */}
                  <div className={`flex items-center justify-between p-4 mb-4 rounded-2xl border bg-black/40 backdrop-blur-md ${col.border}`}>
                     <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full ${col.bg}/10 flex items-center justify-center`}>
                           <col.icon size={14} className={col.color} />
                        </div>
                        <h3 className="text-sm font-bold tracking-widest uppercase">{col.title}</h3>
                     </div>
                     <span className={`text-xs font-mono font-bold ${col.color} bg-${col.bg}/10 px-2.5 py-1 rounded-md`}>
                        {col.tasks.length}
                     </span>
                  </div>

                  {/* Task List */}
                  <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4 pb-12">
                     <AnimatePresence>
                        {col.tasks.map((task, idx) => (
                           <motion.div
                              layout
                              initial={{ opacity: 0, scale: 0.95, y: 20 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                              transition={{ duration: 0.3, delay: idx * 0.05 }}
                              key={task.task_id}
                              className={`relative bg-[#0A0A0A] border rounded-2xl p-5 group transition-all hover:-translate-y-1 hover:shadow-xl ${
                                 task.is_critical_path && task.status !== 'COMPLETED' 
                                 ? 'border-[#D6003C]/40 hover:border-[#D6003C] hover:shadow-[0_8px_30px_rgba(214,0,60,0.15)]' 
                                 : task.status === 'COMPLETED' 
                                 ? 'border-[#16A34A]/20 opacity-60 hover:opacity-100 hover:border-[#16A34A]/50'
                                 : 'border-white/5 hover:border-white/20'
                              }`}
                           >
                              {/* Urgent Glow */}
                              {task.is_critical_path && task.status !== 'COMPLETED' && (
                                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-[#D6003C] to-transparent shadow-[0_0_10px_#D6003C]" />
                              )}

                              <div className="flex justify-between items-start mb-3">
                                 {task.is_critical_path ? (
                                    <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-[#D6003C] bg-[#D6003C]/10 px-2 py-0.5 rounded">
                                       <Activity size={10} /> Critical Path
                                    </div>
                                 ) : (
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                                       {task.duration_minutes} MIN
                                    </div>
                                 )}
                              </div>

                              <h4 className={`text-base font-medium leading-snug mb-2 ${task.status === 'COMPLETED' ? 'line-through text-gray-400' : 'text-white group-hover:text-[#38BDF8] transition-colors'}`}>
                                 {task.task_name}
                              </h4>
                              
                              {task.description && (
                                 <p className="text-xs text-gray-500 line-clamp-2 mb-4 leading-relaxed">
                                    {task.description}
                                 </p>
                              )}

                              {/* Dependencies visual */}
                              {(task.predecessors.length > 0) && (
                                 <div className="flex items-center gap-2 mb-4 text-[10px] text-gray-500 bg-black/50 p-2 rounded-lg border border-white/5">
                                    <GitCommit size={12} className="text-amber-500 shrink-0" />
                                    <span className="truncate">Blocks: {task.predecessors.map(p => p.task_name).join(', ')}</span>
                                 </div>
                              )}

                              <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                                 <div className="flex items-center gap-2">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                       task.assigned_provider_name ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'bg-white/10 text-gray-400'
                                    }`}>
                                       <Box size={10} />
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest truncate max-w-[100px] text-gray-400">
                                       {task.assigned_provider_name || 'UNASSIGNED'}
                                    </span>
                                 </div>
                                 
                                 {task.status !== 'COMPLETED' ? (
                                    <button 
                                       onClick={() => handleCompleteTask(task.task_id)}
                                       className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-[#16A34A] hover:border-[#16A34A] hover:shadow-[0_0_15px_rgba(22,163,74,0.4)] transition-all group/btn"
                                    >
                                       <CheckCircle2 size={14} className="text-gray-400 group-hover/btn:text-white transition-colors" />
                                    </button>
                                 ) : (
                                    <div className="w-8 h-8 rounded-full bg-[#16A34A]/20 flex items-center justify-center">
                                       <CheckCircle2 size={14} className="text-[#16A34A]" />
                                    </div>
                                 )}
                              </div>
                           </motion.div>
                        ))}
                     </AnimatePresence>
                     
                     {col.tasks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 border border-dashed border-white/5 rounded-2xl">
                           <col.icon size={24} className="text-gray-800 mb-2" />
                           <p className="text-xs font-bold text-gray-700 uppercase tracking-widest">No Tasks</p>
                        </div>
                     )}
                  </div>
               </div>
            ))}
         </div>
      </div>
    </div>
  );
}
