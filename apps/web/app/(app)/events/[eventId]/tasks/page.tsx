"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, Clock, AlertTriangle, Plus, Search, Filter, MoreHorizontal, CheckCircle2, Circle, ArrowUpRight, Zap } from 'lucide-react';

const mockTasks = [
  { id: 1, title: 'Finalize stage lighting plot', assignee: 'Alex J.', status: 'in-progress', priority: 'high', due: 'Today, 4:00 PM' },
  { id: 2, title: 'Confirm catering headcount', assignee: 'Sarah C.', status: 'todo', priority: 'medium', due: 'Tomorrow, 12:00 PM' },
  { id: 3, title: 'Soundcheck main speakers', assignee: 'Mike R.', status: 'todo', priority: 'high', due: '2 Days' },
  { id: 4, title: 'Vendor load-in schedule', assignee: 'Emma W.', status: 'review', priority: 'medium', due: 'Today, 6:00 PM' },
  { id: 5, title: 'Security briefing', assignee: 'David L.', status: 'completed', priority: 'critical', due: 'Yesterday' },
  { id: 6, title: 'Print VIP badges', assignee: 'Sarah C.', status: 'todo', priority: 'low', due: '3 Days' },
];

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState('all');
  
  const columns = [
    { id: 'todo', title: 'TO DO', color: 'border-slate-500' },
    { id: 'in-progress', title: 'IN PROGRESS', color: 'border-blue-500' },
    { id: 'review', title: 'REVIEW', color: 'border-amber-500' },
    { id: 'completed', title: 'COMPLETED', color: 'border-emerald-500' },
  ];

  return (
    <div className="w-full h-full flex flex-col space-y-6 text-white font-sans">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckSquare className="text-[#D6003C] w-5 h-5" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#D6003C] uppercase">Task Command</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight">
            Execution <span className="font-bold">Matrix</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-[#D6003C] transition-colors" />
            <input 
              type="text" 
              placeholder="Search tasks..." 
              className="bg-black/40 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-[#D6003C]/50 focus:ring-1 focus:ring-[#D6003C]/50 transition-all w-full md:w-64 placeholder:text-gray-600"
            />
          </div>
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded-full transition-all">
            <Filter className="w-4 h-4 text-gray-300" />
          </button>
          <button className="bg-[#D6003C] hover:bg-[#D6003C]/80 text-white flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all shadow-[0_0_15px_rgba(214,0,60,0.3)]">
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Analytics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
         {[
           { label: 'Total Tasks', value: '42', icon: CheckSquare, color: 'text-gray-300' },
           { label: 'In Progress', value: '12', icon: Clock, color: 'text-blue-400' },
           { label: 'Requires Review', value: '5', icon: Zap, color: 'text-amber-400' },
           { label: 'Overdue / Critical', value: '2', icon: AlertTriangle, color: 'text-[#D6003C]' },
         ].map((stat, i) => (
           <div key={i} className="bg-black/20 border border-white/5 rounded-2xl p-4 flex items-center justify-between hover:border-white/10 transition-colors">
              <div>
                 <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1">{stat.label}</p>
                 <p className="text-2xl font-light">{stat.value}</p>
              </div>
              <div className={`p-2 rounded-full bg-white/5 ${stat.color}`}>
                 <stat.icon className="w-5 h-5" />
              </div>
           </div>
         ))}
      </div>

      {/* Kanban Board */}
      <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 overflow-x-auto pb-4">
        {columns.map((col, index) => (
          <div key={col.id} className="flex flex-col min-w-[280px]">
            {/* Column Header */}
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full border-2 ${col.color} bg-transparent`} />
                <span className="text-xs font-bold text-gray-300 tracking-wider">{col.title}</span>
              </div>
              <span className="text-[10px] bg-white/10 text-gray-400 px-2 py-0.5 rounded-full font-mono">
                {mockTasks.filter(t => t.status === col.id).length}
              </span>
            </div>

            {/* Task List */}
            <div className="flex flex-col gap-3">
              <AnimatePresence>
                {mockTasks.filter(t => t.status === col.id).map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#111115] border border-white/5 hover:border-white/20 p-4 rounded-2xl cursor-pointer group hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(214,0,60,0.05)] transition-all duration-300 relative overflow-hidden"
                  >
                    {/* Status accent line */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                      task.priority === 'critical' ? 'bg-[#D6003C]' : 
                      task.priority === 'high' ? 'bg-amber-500' : 
                      task.priority === 'medium' ? 'bg-blue-500' : 'bg-slate-600'
                    }`} />
                    
                    <div className="pl-2">
                      <div className="flex justify-between items-start mb-2">
                        <div className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded text-white/80 ${
                          task.priority === 'critical' ? 'bg-[#D6003C]/30 text-[#D6003C]' : 
                          task.priority === 'high' ? 'bg-amber-500/20 text-amber-500' : 
                          task.priority === 'medium' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10'
                        }`}>
                          {task.priority}
                        </div>
                        <MoreHorizontal className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors" />
                      </div>
                      
                      <h3 className="text-sm font-medium text-white mb-4 leading-snug group-hover:text-[#D6003C] transition-colors">
                        {task.title}
                      </h3>
                      
                      <div className="flex items-center justify-between border-t border-white/5 pt-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center text-[10px] font-bold border border-black shadow-sm">
                            {task.assignee.charAt(0)}
                          </div>
                          <span className="text-[10px] text-gray-400 font-medium">{task.assignee}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-mono">
                          <Clock className="w-3 h-3" />
                          <span>{task.due}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            
            <button className="mt-4 w-full border border-dashed border-white/10 hover:border-white/30 text-gray-500 hover:text-white bg-transparent hover:bg-white/5 rounded-xl py-3 text-xs font-medium transition-all flex items-center justify-center gap-2">
               <Plus className="w-3 h-3" /> Add Task
            </button>
          </div>
        ))}
      </div>
      
    </div>
  );
}
