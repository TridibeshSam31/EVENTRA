"use client";

import React from 'react';
import { DollarSign, ArrowUpRight, ArrowDownRight, Plus, Download, TrendingUp, AlertCircle, PieChart, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

const budgetCategories = [
  { id: 1, name: 'Venue & Facilities', allocated: 45000, spent: 42500, status: 'on-track', color: 'bg-emerald-500' },
  { id: 2, name: 'AV & Production', allocated: 25000, spent: 28000, status: 'over-budget', color: 'bg-[#D6003C]' },
  { id: 3, name: 'Food & Beverage', allocated: 15000, spent: 12000, status: 'under-budget', color: 'bg-blue-500' },
  { id: 4, name: 'Talent & Speakers', allocated: 30000, spent: 30000, status: 'on-track', color: 'bg-emerald-500' },
  { id: 5, name: 'Marketing & PR', allocated: 10000, spent: 8500, status: 'under-budget', color: 'bg-blue-500' },
  { id: 6, name: 'Contingency', allocated: 15000, spent: 2500, status: 'on-track', color: 'bg-purple-500' },
];

export default function BudgetPage() {
  const totalAllocated = budgetCategories.reduce((acc, cat) => acc + cat.allocated, 0);
  const totalSpent = budgetCategories.reduce((acc, cat) => acc + cat.spent, 0);
  const percentSpent = (totalSpent / totalAllocated) * 100;

  return (
    <div className="w-full h-full flex flex-col space-y-8 text-white font-sans pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="text-emerald-400 w-5 h-5" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-emerald-400 uppercase">Financials</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight">
            Event <span className="font-bold">Budget</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 text-white flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
          <button className="bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Plus className="w-4 h-4" />
            <span>Add Line Item</span>
          </button>
        </div>
      </div>

      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Total Budget */}
        <div className="bg-[#111115] border border-white/5 rounded-3xl p-6 relative overflow-hidden group hover:border-white/20 transition-all">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
             <PieChart className="w-24 h-24 text-white" />
          </div>
          <div className="relative z-10">
             <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Total Allocated</p>
             <h2 className="text-4xl font-light tracking-tighter">${totalAllocated.toLocaleString()}</h2>
             <div className="mt-4 inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                <ArrowUpRight className="w-3 h-3" /> +12% from last year
             </div>
          </div>
        </div>

        {/* Total Spent */}
        <div className="bg-[#111115] border border-white/5 rounded-3xl p-6 relative overflow-hidden group hover:border-white/20 transition-all">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
             <Activity className="w-24 h-24 text-white" />
          </div>
          <div className="relative z-10">
             <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Total Spent</p>
             <h2 className="text-4xl font-light tracking-tighter text-white">${totalSpent.toLocaleString()}</h2>
             
             {/* Progress Bar */}
             <div className="mt-6 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${percentSpent > 100 ? 'bg-[#D6003C]' : 'bg-emerald-400'}`} 
                  style={{ width: `${Math.min(percentSpent, 100)}%` }} 
                />
             </div>
             <p className="text-[10px] font-mono text-gray-500 mt-2 text-right">{percentSpent.toFixed(1)}% consumed</p>
          </div>
        </div>

        {/* Remaining */}
        <div className="bg-[#111115] border border-white/5 rounded-3xl p-6 relative overflow-hidden group hover:border-white/20 transition-all">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
             <TrendingUp className="w-24 h-24 text-white" />
          </div>
          <div className="relative z-10">
             <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Remaining</p>
             <h2 className={`text-4xl font-light tracking-tighter ${totalAllocated - totalSpent < 0 ? 'text-[#D6003C]' : 'text-white'}`}>
               ${Math.abs(totalAllocated - totalSpent).toLocaleString()}
             </h2>
             {totalAllocated - totalSpent < 0 ? (
               <div className="mt-4 inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[#D6003C] bg-[#D6003C]/10 px-2 py-1 rounded">
                  <AlertCircle className="w-3 h-3" /> Over Budget
               </div>
             ) : (
               <div className="mt-4 inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                  <ArrowDownRight className="w-3 h-3" /> Under Budget
               </div>
             )}
          </div>
        </div>

      </div>

      {/* Breakdown Table */}
      <div className="bg-[#111115] border border-white/5 rounded-3xl overflow-hidden mt-4">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
           <h3 className="text-lg font-medium">Category Breakdown</h3>
           <div className="text-[10px] text-gray-500 font-mono">UPDATED: JUST NOW</div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/20 text-[10px] uppercase tracking-widest text-gray-500 font-bold border-b border-white/5">
                <th className="p-4 pl-6 font-semibold">Category</th>
                <th className="p-4 font-semibold text-right">Allocated</th>
                <th className="p-4 font-semibold text-right">Spent</th>
                <th className="p-4 font-semibold text-right">Variance</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgetCategories.map((cat, i) => {
                const variance = cat.allocated - cat.spent;
                const percentage = (cat.spent / cat.allocated) * 100;
                
                return (
                  <motion.tr 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    key={cat.id} 
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${cat.color}`} />
                        <span className="font-medium text-sm">{cat.name}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono text-xs text-gray-300">
                      ${cat.allocated.toLocaleString()}
                    </td>
                    <td className="p-4 text-right font-mono text-xs text-white">
                      ${cat.spent.toLocaleString()}
                    </td>
                    <td className={`p-4 text-right font-mono text-xs font-medium ${variance < 0 ? 'text-[#D6003C]' : variance > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                      {variance < 0 ? '-' : variance > 0 ? '+' : ''}${Math.abs(variance).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                          <div className={`h-full rounded-full ${percentage > 100 ? 'bg-[#D6003C]' : percentage > 85 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono w-8">{percentage.toFixed(0)}%</span>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
