"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, ShieldCheck, UserCheck, AlertTriangle, MessageSquare, DollarSign, Clock, LayoutTemplate, Activity, ArrowRight, CornerDownRight, Fingerprint } from 'lucide-react';

const APPROVALS = [
  {
    id: 'REQ-4092',
    type: 'Financial Override',
    title: 'Emergency Security Expansion',
    requestedBy: 'David M. (Security Chief)',
    time: '10 mins ago',
    severity: 'critical',
    description: 'VIP attendance is 15% higher than projected. Requesting immediate authorization to deploy 4 additional private security contractors to the Green Room perimeter.',
    aiAnalysis: 'Approving this request prevents a potential crowd-control failure in Sector 4. The requested budget ($2,400) is well within the 10% contingency fund. Highly recommended.',
    impact: [
      { icon: DollarSign, label: 'Cost', value: '$2,400.00', color: 'text-[#D6003C]' },
      { icon: ShieldCheck, label: 'Risk Delta', value: '-85% Exposure', color: 'text-green-500' },
      { icon: Clock, label: 'Deployment', value: 'Immediate', color: 'text-gray-300' }
    ],
    status: 'pending'
  },
  {
    id: 'REQ-4091',
    type: 'Logistics Shift',
    title: 'Relocate Catering to Hall B',
    requestedBy: 'System AI (Environment Monitor)',
    time: '28 mins ago',
    severity: 'warning',
    description: 'Sensors detect a partial HVAC failure in Hall A. Ambient temperature has risen to 78°F. Propose moving the 1:00 PM catering stations to Hall B to preserve food safety.',
    aiAnalysis: 'Hall B has sufficient square footage and power drops to support the catering load. Minor routing updates will be automatically pushed to attendee apps if approved.',
    impact: [
      { icon: LayoutTemplate, label: 'Venue Change', value: 'Hall A → Hall B', color: 'text-yellow-500' },
      { icon: UserCheck, label: 'Attendee Exp', value: 'Optimal Temp', color: 'text-green-500' },
      { icon: DollarSign, label: 'Cost', value: 'Budget Neutral', color: 'text-gray-300' }
    ],
    status: 'pending'
  },
  {
    id: 'REQ-4090',
    type: 'Mass Communication',
    title: 'Schedule Swap SMS Broadcast',
    requestedBy: 'Sarah K. (Event Director)',
    time: '1 hour ago',
    severity: 'info',
    description: 'Requesting authorization to send an SMS and Push Notification to all 4,250 checked-in attendees regarding the Keynote and Panel 2 schedule swap.',
    aiAnalysis: 'Draft message is verified and meets character limits. Sending now ensures 98% read-rate before the new 10:00 AM start time.',
    impact: [
      { icon: MessageSquare, label: 'Reach', value: '4,250 Users', color: 'text-blue-500' },
      { icon: Activity, label: 'System Load', value: 'Low', color: 'text-gray-300' }
    ],
    status: 'pending'
  }
];

export default function ApprovalsPage() {
  const [activeId, setActiveId] = useState(APPROVALS[0].id);
  const [resolvedIds, setResolvedIds] = useState<Record<string, 'approved' | 'denied'>>({});
  const [processing, setProcessing] = useState(false);

  const activeRequest = APPROVALS.find(a => a.id === activeId);
  const resolution = resolvedIds[activeId];

  const handleAction = (action: 'approved' | 'denied') => {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setResolvedIds(prev => ({ ...prev, [activeId]: action }));
    }, 1500);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-[#D6003C] border-[#D6003C]/30 bg-[#D6003C]/10';
      case 'warning': return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
      default: return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <ShieldCheck className="text-green-500" size={28} />
            Human <span className="font-bold text-green-500">Authorization</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">AI proposes. You decide. Final executive sign-off queue.</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-y-auto no-scrollbar pb-20 xl:pb-0">
        
        {/* Left Column: Queue */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
           <div className="flex items-center justify-between flex-shrink-0">
             <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                Action Queue
             </h3>
             <span className="bg-white/10 text-white text-[10px] font-bold px-2 py-1 rounded-full">
               {APPROVALS.length - Object.keys(resolvedIds).length} PENDING
             </span>
           </div>
           
           <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4">
              {APPROVALS.map((req) => {
                 const isActive = activeId === req.id;
                 const status = resolvedIds[req.id];
                 
                 return (
                   <div 
                     key={req.id}
                     onClick={() => setActiveId(req.id)}
                     className={`p-5 rounded-3xl border transition-all cursor-pointer relative overflow-hidden group ${
                       isActive ? 'bg-white/[0.05] border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 
                       'bg-[#0B0B0F] border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
                     }`}
                   >
                     {isActive && <motion.div layoutId="active-approval-border" className="absolute left-0 top-0 bottom-0 w-1 bg-green-500" />}
                     
                     <div className="flex items-start justify-between mb-3">
                       {status === 'approved' ? (
                         <div className="px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-500 text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                           <CheckCircle2 size={12} /> Approved
                         </div>
                       ) : status === 'denied' ? (
                         <div className="px-3 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-500 text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                           <XCircle size={12} /> Denied
                         </div>
                       ) : (
                         <div className={`px-3 py-1 rounded-full border text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5 ${getSeverityColor(req.severity)}`}>
                           <AlertTriangle size={12} /> {req.type}
                         </div>
                       )}
                       <span className="text-xs text-gray-500 font-medium">{req.time}</span>
                     </div>

                     <h3 className={`text-lg font-semibold leading-tight mb-2 ${status ? 'text-gray-400' : 'text-white'}`}>
                       {req.title}
                     </h3>
                     <p className="text-xs text-gray-500 flex items-center gap-1.5">
                       <UserCheck size={12} /> {req.requestedBy}
                     </p>
                   </div>
                 );
              })}
           </div>
        </div>

        {/* Right Column: Authorization Dashboard */}
        <div className="xl:col-span-8 flex flex-col h-[800px] xl:h-full bg-[#0B0B0F] border border-white/5 rounded-3xl overflow-hidden relative shadow-2xl">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500/50 to-transparent opacity-50" />
           
           <AnimatePresence mode="wait">
             <motion.div 
               key={activeId}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="flex flex-col h-full"
             >
               <div className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-8 flex flex-col">
                 
                 {/* Request Context */}
                 <div className="mb-8">
                    <div className="flex items-center gap-3 mb-3">
                       <span className="text-sm font-mono text-gray-500">{activeRequest?.id}</span>
                       <span className="w-1 h-1 rounded-full bg-white/20" />
                       {resolution ? (
                          <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${resolution === 'approved' ? 'text-green-500' : 'text-red-500'}`}>
                            {resolution === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />} 
                            Request {resolution}
                          </span>
                       ) : (
                          <span className="text-xs font-bold uppercase tracking-widest text-yellow-500 animate-pulse">
                            Awaiting Authorization
                          </span>
                       )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-medium text-white mb-2">{activeRequest?.title}</h2>
                    <div className="flex items-center gap-2 text-sm text-gray-400 bg-white/5 w-fit px-3 py-1.5 rounded-lg border border-white/10 mb-6">
                       <UserCheck size={14} /> Requested by: <span className="text-white font-medium">{activeRequest?.requestedBy}</span>
                    </div>
                    <p className="text-gray-300 text-sm md:text-base leading-relaxed max-w-3xl">
                       {activeRequest?.description}
                    </p>
                 </div>

                 {!resolution && (
                   <>
                     {/* AI Analysis Box */}
                     <div className="bg-gradient-to-br from-[#111115] to-black border border-green-500/20 rounded-2xl p-6 mb-8 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                        <h4 className="text-xs font-bold uppercase tracking-widest text-green-500 mb-3 flex items-center gap-2">
                          <Activity size={14} /> AI Context Analysis
                        </h4>
                        <p className="text-gray-300 text-sm leading-relaxed relative z-10">
                           {activeRequest?.aiAnalysis}
                        </p>
                     </div>

                     {/* Impact Metrics */}
                     <div className="mb-8">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Authorization Impact</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                           {activeRequest?.impact.map((imp, idx) => (
                              <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-center">
                                 <div className="flex items-center gap-2 text-gray-500 mb-2">
                                    <imp.icon size={14} />
                                    <span className="text-xs font-bold uppercase tracking-wider">{imp.label}</span>
                                 </div>
                                 <span className={`text-lg font-medium ${imp.color}`}>{imp.value}</span>
                              </div>
                           ))}
                        </div>
                     </div>
                   </>
                 )}

                 {resolution && (
                   <motion.div 
                     initial={{ opacity: 0, scale: 0.95 }}
                     animate={{ opacity: 1, scale: 1 }}
                     className={`flex-1 flex flex-col items-center justify-center text-center p-8 rounded-3xl border ${
                       resolution === 'approved' ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
                     }`}
                   >
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 border ${
                        resolution === 'approved' ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30'
                      }`}>
                         {resolution === 'approved' ? <ShieldCheck size={40} className="text-green-500" /> : <XCircle size={40} className="text-red-500" />}
                      </div>
                      <h3 className="text-2xl font-medium text-white mb-2">
                        {resolution === 'approved' ? 'Authorization Granted' : 'Request Denied'}
                      </h3>
                      <p className="text-gray-400 max-w-md">
                        {resolution === 'approved' 
                          ? 'The request has been signed cryptographically and downstream systems are now executing the protocol.'
                          : 'The request has been firmly rejected. The requester has been notified to seek alternative measures.'}
                      </p>
                   </motion.div>
                 )}
               </div>

               {/* Action Footer */}
               <AnimatePresence>
                  {!resolution && (
                     <motion.div 
                       initial={{ opacity: 0, y: 20 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: 20 }}
                       className="p-6 md:p-8 border-t border-white/10 bg-black/40 flex flex-col md:flex-row items-center justify-between gap-6 flex-shrink-0"
                     >
                        <div className="flex items-center gap-3 text-sm text-gray-400">
                           <Fingerprint size={20} className="text-gray-500" />
                           Requiring Executive Digital Signature
                        </div>
                        
                        <div className="flex w-full md:w-auto gap-4">
                           <button 
                             onClick={() => handleAction('denied')}
                             disabled={processing}
                             className="flex-1 md:flex-none bg-transparent hover:bg-red-500/10 text-gray-300 hover:text-red-500 border border-white/20 hover:border-red-500/50 px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                           >
                              Deny Request
                           </button>
                           <button 
                             onClick={() => handleAction('approved')}
                             disabled={processing}
                             className="flex-1 md:flex-none bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-8 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(22,163,74,0.3)] flex items-center justify-center gap-2"
                           >
                              {processing ? (
                                <><Activity size={16} className="animate-spin" /> Authorizing...</>
                              ) : (
                                <><CheckCircle2 size={16} /> Approve & Execute</>
                              )}
                           </button>
                        </div>
                     </motion.div>
                  )}
               </AnimatePresence>
             </motion.div>
           </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
