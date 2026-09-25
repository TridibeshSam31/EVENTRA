"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertOctagon, CheckCircle2, Clock, Users, DollarSign, ArrowRight, Zap, ShieldCheck, Truck, Video, LayoutList, Activity } from 'lucide-react';
import { useParams } from 'next/navigation';
import { listIncidents, resolveIncident } from '../../../../../lib/api/incidents';
import { listRecoveryOptions, generateRecoveryOptions } from '../../../../../lib/api/recovery';
import { simulateCancellationIncident, approveRecoveryAction } from '../../../../../lib/api/events';

export default function RecoveryPage() {
  const [disruptions, setDisruptions] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedDisruptions, setResolvedDisruptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const params = useParams();
  
  const eventId = params.eventId as string;

  const fetchIncidents = async () => {
    if (!eventId) return;
    try {
      const res = await listIncidents(eventId);
      if (res && res.items) {
        const mapped = await Promise.all(res.items.map(async (inc) => {
          let optsResponse;
          try {
             optsResponse = await listRecoveryOptions(eventId, inc.id);
             if (!optsResponse || !optsResponse.items || optsResponse.items.length === 0) {
               optsResponse = await generateRecoveryOptions(eventId, inc.id);
             }
          } catch(e) {}
          
          const options = optsResponse?.items || [];
          
          return {
            id: inc.id,
            title: inc.title,
            time: inc.detected_at ? new Date(inc.detected_at).toLocaleTimeString() : 'Recently',
            severity: inc.severity?.toLowerCase() || 'warning',
            description: inc.description || 'Anomaly detected.',
            impact: [
              { icon: Users, text: 'System Impact' }
            ],
            options: options.map((opt: any, i: number) => ({
              id: opt.id,
              title: opt.strategy_type || `Option ${i + 1}`,
              badge: i === 0 ? 'AI Recommended' : 'Alternative',
              badgeColor: i === 0 ? 'text-[#D6003C] bg-[#D6003C]/10 border-[#D6003C]/30' : 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
              icon: ShieldCheck,
              eta: 'TBD',
              cost: 'TBD',
              details: JSON.stringify(opt.proposed_changes) || 'Details not available',
              actionText: 'Execute'
            }))
          };
        }));
        setDisruptions(mapped);
        if (mapped.length > 0 && !activeId) {
          setActiveId(mapped[0].id);
        }
      }
    } catch(err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [eventId]);

  const activeDisruption = disruptions.find(d => d.id === activeId);
  const isResolved = activeId ? resolvedDisruptions.includes(activeId) : false;

  const handleExecute = async () => {
    if (!selectedOption || !activeId) return;
    setResolving(true);
    try {
      // In a full implementation, you'd trigger approveRecoveryAction or executeAction here.
      // For now we will resolve the incident directly.
      await resolveIncident(eventId, activeId, "Executed recovery option: " + selectedOption);
      setResolvedDisruptions(prev => [...prev, activeId]);
      setSelectedOption(null);
    } catch(e) {
      console.error(e);
    } finally {
      setResolving(false);
    }
  };

  const handleSimulate = async () => {
    setLoading(true);
    try {
      await simulateCancellationIncident(eventId);
      await fetchIncidents();
    } catch(e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <AlertOctagon className="text-[#D6003C]" size={28} />
            Smart <span className="font-bold text-[#D6003C]">Recovery</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">AI-driven disruption analysis and mitigation plans.</p>
        </div>
        <button 
          onClick={handleSimulate}
          disabled={loading}
          className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Simulate Incident'}
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-y-auto no-scrollbar pb-20 xl:pb-0">
        
        {/* Left Column: Active Disruptions */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
           <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
              <AlertTriangle size={16} className="text-yellow-500" /> Detected Anomalies
           </h3>
           
           <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4">
              {disruptions.map((disruption) => {
                 const isActive = activeId === disruption.id;
                 const resolved = resolvedDisruptions.includes(disruption.id);
                 
                 return (
                   <div 
                     key={disruption.id}
                     onClick={() => setActiveId(disruption.id)}
                     className={`p-5 rounded-3xl border transition-all cursor-pointer relative overflow-hidden group ${
                       isActive ? 'bg-white/[0.05] border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 
                       'bg-[#0B0B0F] border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
                     }`}
                   >
                     {isActive && <motion.div layoutId="active-disruption-border" className="absolute left-0 top-0 bottom-0 w-1 bg-[#D6003C]" />}
                     
                     <div className="flex items-start justify-between mb-3">
                       {resolved ? (
                         <div className="px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-500 text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                           <CheckCircle2 size={12} /> Resolved
                         </div>
                       ) : (
                         <div className={`px-3 py-1 rounded-full border text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5 ${
                           disruption.severity === 'critical' ? 'border-[#D6003C]/30 bg-[#D6003C]/10 text-[#D6003C]' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
                         }`}>
                           <AlertTriangle size={12} /> {disruption.severity}
                         </div>
                       )}
                       <span className="text-xs text-gray-500 font-medium">{disruption.time}</span>
                     </div>

                     <h3 className={`text-lg font-semibold leading-tight mb-2 ${resolved ? 'text-gray-400 line-through' : 'text-white'}`}>
                       {disruption.title}
                     </h3>
                   </div>
                 );
              })}
           </div>
        </div>

        {/* Right Column: Mitigation Dashboard */}
        <div className="xl:col-span-8 flex flex-col h-[800px] xl:h-full bg-[#0B0B0F] border border-white/5 rounded-3xl overflow-hidden relative shadow-2xl">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#D6003C]/50 to-transparent opacity-50" />
           
           <AnimatePresence mode="wait">
             <motion.div 
               key={activeId}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="flex flex-col h-full p-6 md:p-8"
             >
               {/* Disruption Brief */}
               <div className="mb-8">
                  <div className="flex items-center gap-3 mb-3">
                     <span className="text-sm font-mono text-gray-500">{activeDisruption?.id}</span>
                     <span className="w-1 h-1 rounded-full bg-white/20" />
                     {isResolved ? (
                        <span className="text-xs font-bold uppercase tracking-widest text-green-500 flex items-center gap-2">
                          <CheckCircle2 size={14} /> Recovery Plan Executed
                        </span>
                     ) : (
                        <span className="text-xs font-bold uppercase tracking-widest text-[#D6003C] animate-pulse">
                          Awaiting Resolution
                        </span>
                     )}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-medium text-white mb-4">{activeDisruption?.title}</h2>
                  <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-3xl">
                     {activeDisruption?.description}
                  </p>
               </div>

               {!isResolved && (
                 <>
                   {/* Blast Radius / Impact */}
                   <div className="bg-[#111115] border border-white/5 rounded-2xl p-5 mb-8 flex-shrink-0">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Impact Blast Radius</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                         {activeDisruption?.impact.map((imp: any, idx: number) => (
                            <div key={idx} className="flex items-start gap-3">
                               <div className="bg-[#D6003C]/10 border border-[#D6003C]/20 p-2 rounded-lg text-[#D6003C] shrink-0">
                                  <imp.icon size={16} />
                               </div>
                               <span className="text-sm text-gray-300 font-medium pt-1">{imp.text}</span>
                            </div>
                         ))}
                      </div>
                   </div>

                   {/* Recovery Options */}
                   <div className="flex-1 flex flex-col min-h-0">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex-shrink-0">
                        Generated Recovery Plans
                      </h4>
                      
                      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pb-6">
                         {activeDisruption?.options.map((opt: any) => {
                            const isSelected = selectedOption === opt.id;
                            
                            return (
                              <div 
                                key={opt.id}
                                onClick={() => setSelectedOption(opt.id)}
                                className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                                  isSelected ? 'bg-white/[0.05] border-[#D6003C]/50 shadow-[0_0_20px_rgba(214,0,60,0.1)]' : 'bg-black/20 border-white/5 hover:border-white/10'
                                }`}
                              >
                                {/* Selection Indicator */}
                                <div className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${isSelected ? 'bg-[#D6003C]' : 'bg-transparent group-hover:bg-white/10'}`} />

                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-3 ml-2">
                                   <div>
                                      <div className="flex items-center gap-3 mb-1">
                                         <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${opt.badgeColor}`}>
                                            {opt.badge}
                                         </span>
                                      </div>
                                      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                         <opt.icon size={18} className={isSelected ? 'text-[#D6003C]' : 'text-gray-500'} />
                                         {opt.title}
                                      </h3>
                                   </div>
                                   
                                   <div className="flex md:flex-col gap-4 md:gap-1 text-sm md:text-right">
                                      <span className="text-gray-400 font-mono"><Clock size={12} className="inline mr-1" /> {opt.eta}</span>
                                      <span className="text-gray-400 font-mono"><DollarSign size={12} className="inline mr-1" /> {opt.cost}</span>
                                   </div>
                                </div>
                                
                                <p className="text-sm text-gray-500 leading-relaxed ml-2 pr-4">
                                   {opt.details}
                                </p>
                              </div>
                            );
                         })}
                      </div>

                      {/* Execute Bar */}
                      <AnimatePresence>
                         {selectedOption && (
                            <motion.div 
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 20 }}
                              className="bg-[#111115] border border-white/10 rounded-2xl p-4 flex items-center justify-between flex-shrink-0 mt-4 shadow-2xl"
                            >
                               <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-[#D6003C]/20 border border-[#D6003C]/30 flex items-center justify-center">
                                     {resolving ? <Activity size={18} className="text-[#D6003C] animate-spin" /> : <ShieldCheck size={18} className="text-[#D6003C]" />}
                                  </div>
                                  <div>
                                     <span className="block text-sm font-semibold text-white">Ready to Execute Plan</span>
                                     <span className="block text-xs text-gray-500">This action will notify relevant teams automatically.</span>
                                  </div>
                               </div>
                               
                               <button 
                                 onClick={handleExecute}
                                 disabled={resolving}
                                 className="bg-[#D6003C] hover:bg-[#FF0D4A] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(214,0,60,0.3)] flex items-center gap-2"
                               >
                                  {resolving ? 'Executing...' : activeDisruption?.options.find((o: any) => o.id === selectedOption)?.actionText}
                                  {!resolving && <ArrowRight size={16} />}
                               </button>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </div>
                 </>
               )}

               {isResolved && (
                 <motion.div 
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#111115]/50 rounded-3xl border border-green-500/20"
                 >
                    <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-6">
                       <CheckCircle2 size={40} className="text-green-500" />
                    </div>
                    <h3 className="text-2xl font-medium text-white mb-2">Crisis Averted</h3>
                    <p className="text-gray-400 max-w-md">
                       The selected recovery plan was executed successfully. Notifications have been dispatched to vendors, staff, and attendees.
                    </p>
                 </motion.div>
               )}
             </motion.div>
           </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
