"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertOctagon, CheckCircle2, Clock, Users, DollarSign, ArrowRight, Zap, ShieldCheck, Truck, Video, LayoutList, Activity } from 'lucide-react';

const DISRUPTIONS = [
  {
    id: 'D-892',
    title: 'Critical Vendor No-Show: Apex Catering',
    time: '15 mins ago',
    severity: 'critical',
    description: 'Apex Catering truck broke down on the highway. They cannot deliver the lunch service for 1,500 attendees scheduled at 12:30 PM.',
    impact: [
      { icon: Users, text: '1,500 VIP attendees without lunch' },
      { icon: Clock, text: 'Lunch break starts in 1h 45m' },
      { icon: DollarSign, text: '$12,500 prepaid (Refund flagged by legal)' }
    ],
    options: [
      {
        id: 'opt-1',
        title: 'Activate On-Call Backup: UrbanBites',
        badge: 'AI Recommended',
        badgeColor: 'text-[#D6003C] bg-[#D6003C]/10 border-[#D6003C]/30',
        icon: ShieldCheck,
        eta: '60 mins',
        cost: '+$1,200 Premium',
        details: 'UrbanBites is on our preferred backup roster. They have pre-packaged gourmet lunch boxes ready for immediate dispatch from a kitchen 10 miles away.',
        actionText: 'Dispatch UrbanBites'
      },
      {
        id: 'opt-2',
        title: 'Food Truck Fleet Scramble',
        badge: 'Alternative',
        badgeColor: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
        icon: Truck,
        eta: '90 mins',
        cost: 'Budget Neutral',
        details: 'Automatically ping 5 local partner food trucks to park outside the venue. Requires attendees to go outside and limits networking time.',
        actionText: 'Send Fleet Ping'
      },
      {
        id: 'opt-3',
        title: 'Distribute Digital Food Vouchers',
        badge: 'Last Resort',
        badgeColor: 'text-gray-400 bg-white/5 border-white/10',
        icon: Zap,
        eta: 'Instant',
        cost: '+$3,500 over budget',
        details: 'Send $25 UberEats/DoorDash vouchers to all 1,500 attendee emails immediately. Allows attendees to order delivery to the venue lobbies.',
        actionText: 'Issue Vouchers via Email'
      }
    ]
  },
  {
    id: 'D-891',
    title: 'Keynote Speaker Flight Delayed',
    time: '45 mins ago',
    severity: 'warning',
    description: 'Dr. Sarah Chen’s flight is delayed by 2 hours due to severe weather. She will miss the 10:00 AM opening keynote slot on the Main Stage.',
    impact: [
      { icon: Clock, text: '10:00 AM Main Stage slot (90 mins) empty' },
      { icon: Users, text: '4,000 attendees expecting keynote' }
    ],
    options: [
      {
        id: 'opt-4',
        title: 'Swap Schedule with Panel 2',
        badge: 'AI Recommended',
        badgeColor: 'text-[#D6003C] bg-[#D6003C]/10 border-[#D6003C]/30',
        icon: LayoutList,
        eta: 'Instant',
        cost: 'None',
        details: 'Move the "Future of AI" panel up to 10:00 AM. Push Keynote to 1:00 PM. All panelists are currently on-site and in the Green Room.',
        actionText: 'Execute Schedule Swap & Notify App'
      },
      {
        id: 'opt-5',
        title: 'Virtual Keynote via Zoom',
        badge: 'Alternative',
        badgeColor: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
        icon: Video,
        eta: '10:00 AM',
        cost: 'None',
        details: 'Speaker logs in from the airport lounge. A/V team routes her remote video feed to the Main Stage screens.',
        actionText: 'Setup Virtual Link with A/V'
      }
    ]
  }
];

export default function RecoveryPage() {
  const [activeId, setActiveId] = useState(DISRUPTIONS[0].id);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedDisruptions, setResolvedDisruptions] = useState<string[]>([]);

  const activeDisruption = DISRUPTIONS.find(d => d.id === activeId);
  const isResolved = resolvedDisruptions.includes(activeId);

  const handleExecute = () => {
    if (!selectedOption) return;
    setResolving(true);
    setTimeout(() => {
      setResolving(false);
      setResolvedDisruptions(prev => [...prev, activeId]);
      setSelectedOption(null);
    }, 2500);
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
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-y-auto no-scrollbar pb-20 xl:pb-0">
        
        {/* Left Column: Active Disruptions */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
           <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
              <AlertTriangle size={16} className="text-yellow-500" /> Detected Anomalies
           </h3>
           
           <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4">
              {DISRUPTIONS.map((disruption) => {
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
                         {activeDisruption?.impact.map((imp, idx) => (
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
                         {activeDisruption?.options.map((opt) => {
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
                                  {resolving ? 'Executing...' : activeDisruption?.options.find(o => o.id === selectedOption)?.actionText}
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
