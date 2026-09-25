"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, Shield, Lock, Search, Hash, UserCircle2, ShieldCheck, ArrowRight, Activity, Terminal, Key } from 'lucide-react';

const AUDIT_LOGS = [
  {
    id: 'ADT-9042',
    timestamp: '2026-09-24 12:05:32',
    action: 'Disaster Recovery Executed',
    category: 'CRITICAL',
    actor: 'David M. (Exec)',
    ip: '192.168.1.42',
    hash: '0x8f4a...e2b1',
    details: 'Authorized failover to backup vendor UrbanBites. $1,200 budget override applied via Smart Recovery module.',
    status: 'Verified'
  },
  {
    id: 'ADT-9041',
    timestamp: '2026-09-24 11:42:10',
    action: 'Security Perimeter Shift',
    category: 'LOGISTICS',
    actor: 'Sarah K. (Ops)',
    ip: '10.0.4.15',
    hash: '0x3c2d...9a7f',
    details: 'Redeployed 4 guards from Hall A to Main Stage VIP entrance due to elevated crowd density warnings.',
    status: 'Verified'
  },
  {
    id: 'ADT-9040',
    timestamp: '2026-09-24 10:15:00',
    action: 'Mass SMS Broadcast',
    category: 'COMMS',
    actor: 'Automated System',
    ip: 'System Internal',
    hash: '0x99f2...11c4',
    details: 'Broadcasted schedule shift warning to 4,250 attendees. 98.2% delivery success rate.',
    status: 'Verified'
  },
  {
    id: 'ADT-9039',
    timestamp: '2026-09-24 09:30:45',
    action: 'Financial Override Denied',
    category: 'FINANCE',
    actor: 'David M. (Exec)',
    ip: '192.168.1.42',
    hash: '0x1a5b...88df',
    details: 'Rejected A/V upgrade request of $5,000 for Stage 2. Reason: Out of contingency scope.',
    status: 'Verified'
  },
  {
    id: 'ADT-9038',
    timestamp: '2026-09-24 08:00:12',
    action: 'Eventra OS Boot Sequence',
    category: 'SYSTEM',
    actor: 'SysAdmin',
    ip: '192.168.0.1',
    hash: '0x00a1...ff45',
    details: 'Core OS initialized. Sensor network online. Camera feeds synced.',
    status: 'Verified'
  }
];

export default function AuditPage() {
  const [selectedId, setSelectedId] = useState(AUDIT_LOGS[0].id);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedLog = AUDIT_LOGS.find(l => l.id === selectedId);

  const filteredLogs = AUDIT_LOGS.filter(log => 
    log.action.toLowerCase().includes(searchQuery.toLowerCase()) || 
    log.actor.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCategoryStyle = (cat: string) => {
    switch(cat) {
      case 'CRITICAL': return 'text-[#D6003C] border-[#D6003C]/30 bg-[#D6003C]/10';
      case 'FINANCE': return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
      case 'LOGISTICS': return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
      case 'SYSTEM': return 'text-green-500 border-green-500/30 bg-green-500/10';
      default: return 'text-gray-300 border-white/20 bg-white/10';
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <Lock className="text-gray-400" size={28} />
            Immutable <span className="font-bold text-white">Audit Trail</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">Cryptographically verifiable log of all critical event actions.</p>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-3">
           <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search ledger..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-black/40 border border-white/10 text-sm text-white rounded-xl pl-9 pr-4 py-2 focus:outline-none focus:border-white/30 transition-all w-48 md:w-64"
              />
           </div>
           <button className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all border border-white/10 flex items-center gap-2">
             <Download size={14} /> Export CSV
           </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-hidden pb-20 xl:pb-0">
        
        {/* Left Column: Ledger Table */}
        <div className="xl:col-span-8 flex flex-col h-full bg-[#0B0B0F] border border-white/5 rounded-3xl overflow-hidden shadow-2xl relative">
           
           {/* Table Header */}
           <div className="grid grid-cols-12 gap-4 p-4 md:p-6 border-b border-white/5 bg-white/[0.02] flex-shrink-0 text-xs font-bold text-gray-500 uppercase tracking-widest">
              <div className="col-span-3">Timestamp</div>
              <div className="col-span-5">Action & Category</div>
              <div className="col-span-3">Authorized By</div>
              <div className="col-span-1 text-right">Ledger</div>
           </div>

           {/* Table Body */}
           <div className="flex-1 overflow-y-auto no-scrollbar p-2">
              <AnimatePresence>
                {filteredLogs.map((log) => {
                   const isSelected = selectedId === log.id;
                   
                   return (
                     <motion.div 
                       layout
                       key={log.id}
                       onClick={() => setSelectedId(log.id)}
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       className={`grid grid-cols-12 gap-4 p-4 rounded-2xl cursor-pointer transition-all border mb-1 items-center ${
                         isSelected 
                           ? 'bg-white/[0.05] border-white/20 shadow-lg' 
                           : 'bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/5'
                       }`}
                     >
                        <div className="col-span-3 font-mono text-[11px] text-gray-400">
                           {log.timestamp}
                        </div>
                        
                        <div className="col-span-5 flex flex-col gap-1.5">
                           <span className="text-sm text-white font-medium truncate pr-4">{log.action}</span>
                           <span className={`w-max px-2 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest border ${getCategoryStyle(log.category)}`}>
                              {log.category}
                           </span>
                        </div>
                        
                        <div className="col-span-3 flex items-center gap-2 text-xs text-gray-400">
                           <UserCircle2 size={14} className="text-gray-500" />
                           <span className="truncate">{log.actor}</span>
                        </div>
                        
                        <div className="col-span-1 flex justify-end">
                           <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-white text-black' : 'bg-white/10 text-gray-400'}`}>
                             <ArrowRight size={12} />
                           </div>
                        </div>
                     </motion.div>
                   );
                })}
              </AnimatePresence>
              
              {filteredLogs.length === 0 && (
                <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-gray-500 space-y-3 opacity-50">
                  <Search size={32} />
                  <p className="text-sm font-mono tracking-widest uppercase">No records found</p>
                </div>
              )}
           </div>
        </div>

        {/* Right Column: Ledger Inspector */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
           
           <div className="flex items-center justify-between flex-shrink-0">
             <h3 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <Terminal size={14} className="text-white" /> Record Inspector
             </h3>
             <span className="flex items-center gap-1 text-[10px] text-green-500 font-bold tracking-widest bg-green-500/10 px-2 py-1 rounded border border-green-500/20">
                <ShieldCheck size={12} /> VERIFIED
             </span>
           </div>
           
           <AnimatePresence mode="wait">
             {selectedLog && (
               <motion.div 
                 key={selectedLog.id}
                 initial={{ opacity: 0, x: 20 }}
                 animate={{ opacity: 1, x: 0 }}
                 exit={{ opacity: 0, x: 20 }}
                 className="flex-1 bg-black/40 border border-white/5 rounded-3xl p-6 relative overflow-hidden flex flex-col"
               >
                  {/* Cyber grid background */}
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:20px_20px]" />
                  
                  <div className="relative z-10 flex-1">
                     <div className="mb-6 pb-6 border-b border-white/10">
                        <div className="flex items-center justify-between mb-2">
                           <span className="text-[10px] font-mono text-gray-500">{selectedLog.id}</span>
                           <span className="text-[10px] font-mono text-gray-500">{selectedLog.timestamp}</span>
                        </div>
                        <h4 className="text-xl font-medium text-white leading-tight mt-3">
                           {selectedLog.action}
                        </h4>
                     </div>

                     <div className="space-y-6">
                        <div>
                           <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Action Details</label>
                           <p className="text-sm text-gray-300 leading-relaxed bg-white/[0.02] p-4 rounded-xl border border-white/5">
                              {selectedLog.details}
                           </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Actor Identity</label>
                              <div className="flex items-center gap-2 text-sm text-white">
                                 <UserCircle2 size={14} className="text-gray-400" /> {selectedLog.actor}
                              </div>
                           </div>
                           <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">IP Address</label>
                              <div className="flex items-center gap-2 text-sm font-mono text-white">
                                 <Activity size={14} className="text-gray-400" /> {selectedLog.ip}
                              </div>
                           </div>
                        </div>

                        <div className="pt-6 mt-6 border-t border-white/10">
                           <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2 flex items-center gap-2">
                              <Key size={12} /> Cryptographic Signature
                           </label>
                           <div className="bg-black p-4 rounded-xl border border-white/10 flex items-center justify-between group cursor-pointer hover:border-white/30 transition-colors">
                              <span className="font-mono text-xs text-gray-400 group-hover:text-white transition-colors">{selectedLog.hash}</span>
                              <span className="text-[9px] uppercase font-bold tracking-wider text-green-500">Valid</span>
                           </div>
                           <p className="text-[10px] text-gray-600 mt-2 text-center">
                             This record is permanently sealed and cannot be altered.
                           </p>
                        </div>
                     </div>
                  </div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
