"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, CheckCircle2, ChevronRight, Clock, Box, Shield, AlignLeft, BarChart3, AlertCircle, Plus, Search, Filter } from 'lucide-react';

const PLAN_MODULES = [
  { id: 'tasks', title: 'Task Generation', progress: 100, status: 'complete', count: 124 },
  { id: 'deps', title: 'Dependency Mapping', progress: 85, status: 'active', count: 48 },
  { id: 'resources', title: 'Resource Planning', progress: 60, status: 'active', count: 12 },
  { id: 'schedule', title: 'Schedule Generation', progress: 0, status: 'pending', count: 0 },
];

const TASKS = [
  { id: 't1', title: 'Secure Main Stage Audio Equipment', phase: 'Pre-Event', owner: 'Alex M.', priority: 'high', status: 'done', dependencies: 0 },
  { id: 't2', title: 'Confirm VIP Catering Menu', phase: 'Pre-Event', owner: 'Sarah J.', priority: 'high', status: 'in-progress', dependencies: 2 },
  { id: 't3', title: 'Map Emergency Exits & Fire Routes', phase: 'Planning', owner: 'David L.', priority: 'critical', status: 'in-progress', dependencies: 1 },
  { id: 't4', title: 'Finalize Lighting Truss Layout', phase: 'Planning', owner: 'Mike R.', priority: 'medium', status: 'pending', dependencies: 3 },
  { id: 't5', title: 'Distribute Staff Access Badges', phase: 'Execution', owner: 'Emma W.', priority: 'high', status: 'pending', dependencies: 5 },
  { id: 't6', title: 'Synchronize Live Stream Encoders', phase: 'Execution', owner: 'Tech Team', priority: 'critical', status: 'pending', dependencies: 4 },
];

export default function PlanPage() {
  const [activeModule, setActiveModule] = useState('tasks');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8 bg-black font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6 flex-shrink-0 border-b border-white/10 pb-6 relative z-10">
        <div>
          <div className="flex items-center gap-3 mb-2">
             <div className="bg-[#D6003C] text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1 flex items-center gap-2 shadow-[0_0_10px_#D6003C]">
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Planning Node
             </div>
             <span className="text-gray-500 font-mono text-[10px] uppercase tracking-widest">v2.4.1</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-light tracking-tighter text-white">
            Operational <span className="font-bold">Blueprint</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="h-10 px-6 bg-white/[0.03] border border-white/10 text-white text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-colors flex items-center gap-2">
            <Filter size={14} />
            Filter
          </button>
          <button className="h-10 px-6 bg-[#0284C7] border border-[#0284C7] text-white text-xs font-bold uppercase tracking-widest shadow-[3px_3px_0px_#0284C7] hover:-translate-y-0.5 hover:-translate-x-0.5 transition-transform flex items-center gap-2">
            <Plus size={16} />
            New Task
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-8 min-h-0 overflow-hidden pb-20 xl:pb-0">
        
        {/* Left Side: Planner Modules */}
        <div className="xl:col-span-4 flex flex-col gap-4 overflow-y-auto no-scrollbar relative z-10">
           <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <Box size={14} /> Execution Modules
           </h3>
           
           {PLAN_MODULES.map(module => (
              <button 
                key={module.id}
                onClick={() => setActiveModule(module.id)}
                className={`group relative flex flex-col p-6 border text-left transition-all overflow-hidden ${
                   activeModule === module.id 
                     ? 'bg-white/[0.05] border-[#0284C7] shadow-[4px_4px_0px_#0284C7]' 
                     : 'bg-black border-white/10 hover:border-white/30'
                }`}
              >
                 {activeModule === module.id && (
                    <motion.div layoutId="active-module" className="absolute left-0 top-0 bottom-0 w-1 bg-[#0284C7]" />
                 )}
                 
                 <div className="flex items-start justify-between mb-6 relative z-10">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">MOD-{module.id.toUpperCase()}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 border ${
                       module.status === 'complete' ? 'bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30' :
                       module.status === 'active' ? 'bg-[#0284C7]/10 text-[#0284C7] border-[#0284C7]/30' :
                       'bg-white/5 text-gray-500 border-white/10'
                    }`}>
                       {module.status}
                    </span>
                 </div>
                 
                 <h4 className={`text-xl font-medium tracking-tight mb-2 relative z-10 ${activeModule === module.id ? 'text-white' : 'text-gray-300'}`}>
                    {module.title}
                 </h4>
                 
                 <div className="mt-auto pt-4 flex items-center justify-between w-full relative z-10">
                    <div className="flex items-center gap-3 w-2/3">
                       <div className="flex-1 h-1 bg-white/10 overflow-hidden">
                          <div 
                             className={`h-full ${
                                module.status === 'complete' ? 'bg-[#16A34A]' : 
                                module.status === 'active' ? 'bg-[#0284C7]' : 
                                'bg-gray-600'
                             }`}
                             style={{ width: `${module.progress}%` }}
                          />
                       </div>
                       <span className="text-[10px] font-mono text-gray-400">{module.progress}%</span>
                    </div>
                    <span className="text-xs font-bold text-gray-500 group-hover:text-white transition-colors flex items-center gap-1">
                       {module.count} Items <ChevronRight size={14} />
                    </span>
                 </div>
                 
                 {/* Abstract BG pattern for active module */}
                 {activeModule === module.id && (
                    <div className="absolute -right-10 -bottom-10 opacity-10 text-[#0284C7] pointer-events-none">
                       <Box size={140} strokeWidth={1} />
                    </div>
                 )}
              </button>
           ))}
        </div>

        {/* Right Side: Module Details / Task Canvas */}
        <div className="xl:col-span-8 flex flex-col h-full bg-[#0A0A0A] border border-white/10 relative overflow-hidden shadow-2xl">
           
           {/* Grid Background */}
           <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
           
           <div className="p-4 md:p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between bg-black/50 backdrop-blur-md relative z-10 gap-4">
              <div className="flex items-center gap-4 bg-black border border-white/10 px-4 py-2 w-full max-w-md focus-within:border-white/30 transition-colors shadow-inner">
                 <Search size={16} className="text-gray-500" />
                 <input 
                   type="text" 
                   placeholder="Search operational tasks..." 
                   className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full font-mono"
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                 />
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto bg-black p-1 border border-white/10">
                 <button className="text-[10px] font-bold uppercase tracking-widest text-white bg-white/10 px-3 py-1.5 flex items-center gap-2">
                    <AlignLeft size={14} /> List
                 </button>
                 <button className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-white px-3 py-1.5 flex items-center gap-2 transition-colors">
                    <BarChart3 size={14} /> Canvas
                 </button>
              </div>
           </div>

           {/* Task List Canvas */}
           <div className="flex-1 overflow-y-auto p-4 md:p-6 relative z-10 space-y-3 no-scrollbar">
              {TASKS.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase())).map((task, i) => (
                 <motion.div 
                   key={task.id}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: i * 0.05 }}
                   className="group flex flex-col sm:flex-row sm:items-center gap-4 p-4 md:p-5 border border-white/10 bg-black/80 backdrop-blur-sm hover:border-white/30 transition-all hover:-translate-y-0.5 shadow-lg"
                 >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                       {task.status === 'done' ? (
                          <div className="w-8 h-8 flex items-center justify-center text-[#16A34A] shrink-0 border border-[#16A34A]/50 bg-[#16A34A]/10 shadow-[0_0_10px_rgba(22,163,74,0.2)]">
                             <CheckCircle2 size={16} />
                          </div>
                       ) : task.status === 'in-progress' ? (
                          <div className="w-8 h-8 flex items-center justify-center text-[#0284C7] shrink-0 border border-[#0284C7]/50 shadow-[0_0_10px_rgba(2,132,199,0.3)] bg-[#0284C7]/10">
                             <div className="w-2.5 h-2.5 bg-[#0284C7] animate-pulse" />
                          </div>
                       ) : (
                          <div className="w-8 h-8 border border-white/20 bg-white/5 flex items-center justify-center shrink-0">
                             <Clock size={14} className="text-gray-500" />
                          </div>
                       )}
                       
                       <div className="min-w-0">
                          <h4 className="text-white text-sm md:text-base font-medium truncate group-hover:text-[#38BDF8] transition-colors">{task.title}</h4>
                          <div className="flex items-center gap-3 mt-1.5">
                             <span className="text-[10px] font-mono text-gray-500 bg-white/5 px-1">{task.id.toUpperCase()}</span>
                             <div className="w-1 h-1 rounded-full bg-white/20" />
                             <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{task.phase}</span>
                          </div>
                       </div>
                    </div>
                    
                    <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-white/5">
                       <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 border ${
                             task.priority === 'critical' ? 'bg-[#D6003C]/10 text-[#D6003C] border-[#D6003C]/30 shadow-[0_0_10px_rgba(214,0,60,0.2)]' :
                             task.priority === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/30' :
                             'bg-white/5 text-gray-400 border-white/10'
                          }`}>
                             {task.priority}
                          </span>
                       </div>
                       
                       <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5 text-gray-400">
                             <Shield size={12} />
                             <span className="text-[10px] font-mono">{task.owner}</span>
                          </div>
                          
                          {task.dependencies > 0 ? (
                             <div className="flex items-center gap-1.5 text-[#EAB308] bg-[#EAB308]/10 border border-[#EAB308]/30 px-2 py-1 shadow-[0_0_8px_rgba(234,179,8,0.15)]">
                                <AlertCircle size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">{task.dependencies} DEPS</span>
                             </div>
                          ) : (
                             <div className="flex items-center gap-1.5 text-gray-600 px-2 py-1">
                                <span className="text-[10px] font-bold uppercase tracking-widest">NO DEPS</span>
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
