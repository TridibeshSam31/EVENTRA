"use client";

import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, Radio, Clock, User, CheckCircle2, MessageSquare, Activity, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useParams } from 'next/navigation';
import { listIncidents, resolveIncident } from '../../../../../lib/api/incidents';

export default function IncidentsPage() {
  const params = useParams();
  const eventId = params.eventId as string;

  const [incidents, setIncidents] = useState<any[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = async () => {
    if (!eventId || !selectedIncidentId) return;
    setIsResolving(true);
    try {
      await resolveIncident(eventId, selectedIncidentId, "Resolved by organizer action in dashboard");
      
      // Update local state to reflect resolved
      setIncidents(prev => prev.map(inc => {
        if (inc.id === selectedIncidentId) {
          return { ...inc, status: 'RESOLVED', resolution_notes: "Resolved by organizer action in dashboard", resolved_at: new Date().toISOString() };
        }
        return inc;
      }));
    } catch (e) {
      console.error(e);
    } finally {
      setIsResolving(false);
    }
  };

  useEffect(() => {
    async function fetchIncidents() {
      if (!eventId) return;
      try {
        const res = await listIncidents(eventId);
        if (res && res.items) {
           setIncidents(res.items);
           if (res.items.length > 0 && !selectedIncidentId) {
              setSelectedIncidentId(res.items[0].id);
           }
        }

      } catch (err) {
        console.error(err);
      }
    }
    fetchIncidents();
    const interval = setInterval(fetchIncidents, 10000);
    return () => clearInterval(interval);
  }, [eventId, selectedIncidentId]);

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId) || incidents[0];

  const getSeverityColor = (severity: string) => {
    if (!severity) return 'text-gray-400 border-white/10 bg-white/5';
    switch(severity.toLowerCase()) {
      case 'critical': return 'text-[#D6003C] border-[#D6003C]/30 bg-[#D6003C]/10';
      case 'warning':
      case 'high': return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
      case 'info':
      case 'medium': return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
      case 'low': return 'text-green-400 border-green-400/30 bg-green-400/10';
      default: return 'text-gray-400 border-white/10 bg-white/5';
    }
  };

  const getSeverityIcon = (severity: string) => {
    if (!severity) return <Activity size={16} />;
    switch(severity.toLowerCase()) {
      case 'critical': return <ShieldAlert size={16} />;
      case 'warning':
      case 'high': return <AlertTriangle size={16} />;
      case 'info':
      case 'medium': return <Info size={16} />;
      default: return <Activity size={16} />;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden p-6 md:p-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white">Incident <span className="font-bold text-[#D6003C]">Command</span></h1>
          <p className="text-sm text-gray-400 mt-1">Real-time risk radar and anomaly detection</p>
        </div>
        
        <div className="flex gap-4">
          <div className="bg-[#0B0B0F] border border-white/5 rounded-full px-5 py-2 flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-[#D6003C] animate-ping opacity-75 absolute" />
             <div className="w-2 h-2 rounded-full bg-[#D6003C] relative z-10" />
             <span className="text-sm font-medium text-white">1 Critical</span>
          </div>
          <div className="bg-[#0B0B0F] border border-white/5 rounded-full px-5 py-2 flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-yellow-500" />
             <span className="text-sm font-medium text-white">1 Warning</span>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-hidden">
        
        {/* Left Column: List */}
        <div className="xl:col-span-5 flex flex-col gap-4 overflow-y-auto pr-2 no-scrollbar pb-10">
           {incidents.map((incident) => (
             <div 
               key={incident.id}
               onClick={() => setSelectedIncidentId(incident.id)}
               className={`p-5 rounded-3xl border transition-all cursor-pointer group flex flex-col gap-3 relative overflow-hidden flex-shrink-0 hover:-translate-y-1 hover:shadow-xl ${
                 selectedIncidentId === incident.id 
                   ? 'bg-white/[0.05] border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]' 
                   : 'bg-[#0B0B0F] border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
               }`}
             >
               {selectedIncidentId === incident.id && (
                 <motion.div layoutId="active-incident-border" className="absolute left-0 top-0 bottom-0 w-1 bg-[#D6003C]" />
               )}

               <div className="flex items-start justify-between">
                 <div className={`px-3 py-1 rounded-full border text-[10px] uppercase tracking-widest font-bold flex items-center gap-2 ${getSeverityColor(incident.severity)}`}>
                   {getSeverityIcon(incident.severity)}
                   {incident.severity || 'UNKNOWN'}
                 </div>
                 <span className="text-xs text-gray-500 font-medium">{new Date(incident.occurred_at || incident.created_at).toLocaleTimeString()}</span>
               </div>

               <div>
                 <h3 className="text-lg font-semibold text-white leading-tight mb-1">{incident.title}</h3>
                 <p className="text-sm text-gray-400 line-clamp-2">{incident.description || 'No description provided.'}</p>
               </div>

               <div className="flex items-center gap-4 mt-2 pt-4 border-t border-white/5">
                 <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Radio size={14} /> {incident.related_venue_id || 'Main Venue'}
                 </div>
                 <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <User size={14} /> {incident.assignedTo || 'Operations Team'}
                 </div>
               </div>
             </div>
           ))}
           {incidents.length === 0 && (
             <div className="text-gray-500 italic p-5">No incidents currently tracked.</div>
           )}
        </div>

        {/* Right Column: Details */}
        <div className="xl:col-span-7 bg-[#0B0B0F] border border-white/5 rounded-3xl p-6 md:p-8 flex flex-col relative overflow-hidden shadow-2xl h-full pb-10">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#D6003C]/50 to-transparent opacity-50" />
           
           <AnimatePresence mode="wait">
               <motion.div 
               key={selectedIncidentId}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="flex flex-col h-full overflow-hidden"
             >
               <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 gap-6 flex-shrink-0">
                 <div>
                   <div className="flex items-center gap-3 mb-3">
                     <span className="text-sm font-mono text-gray-500">{selectedIncident?.id}</span>
                     <span className="w-1 h-1 rounded-full bg-white/20" />
                     <span className={`text-xs font-bold uppercase tracking-widest ${selectedIncident?.status?.toUpperCase() === 'RESOLVED' ? 'text-green-500' : 'text-white'}`}>
                       Status: {selectedIncident?.status || 'UNKNOWN'}
                     </span>
                   </div>
                   <h2 className="text-2xl md:text-3xl font-medium text-white mb-2">{selectedIncident?.title || 'Unknown Incident'}</h2>
                   <div className="flex flex-wrap gap-4 md:gap-6 text-sm text-gray-400 font-medium">
                      <span className="flex items-center gap-2"><Clock size={16} /> {selectedIncident ? new Date(selectedIncident.occurred_at || selectedIncident.created_at).toLocaleTimeString() : ''}</span>
                      <span className="flex items-center gap-2"><Radio size={16} /> {selectedIncident?.related_venue_id || 'Main Venue'}</span>
                   </div>
                 </div>
                 <button 
                   onClick={handleResolve}
                   disabled={isResolving || selectedIncident?.status?.toUpperCase() === 'RESOLVED'}
                   className="bg-[#D6003C] hover:bg-[#FF0D4A] disabled:opacity-50 text-white px-6 py-2.5 rounded-full text-sm font-bold uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(214,0,60,0.3)] flex items-center justify-center gap-2 flex-shrink-0 w-full md:w-auto hover:-translate-y-0.5"
                 >
                   <CheckCircle2 size={16} /> {isResolving ? 'Resolving...' : (selectedIncident?.status?.toUpperCase() === 'RESOLVED' ? 'Resolved' : 'Mark Resolved')}
                 </button>
               </div>

               <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 mb-8 flex-shrink-0">
                 <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Incident Brief</h4>
                 <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                   {selectedIncident?.description || 'No description provided.'}
                 </p>
               </div>

               <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                 <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2 flex-shrink-0">
                   <Activity size={14} /> Action Log
                 </h4>
                 
                 <div className="flex-1 overflow-y-auto no-scrollbar relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/5 space-y-6 pl-10 pr-2">
                   {selectedIncident?.resolution_notes ? (
                     <div className="relative">
                       <div className="absolute -left-10 mt-1 w-7 h-7 rounded-full bg-[#111115] border border-white/10 flex items-center justify-center shadow-lg z-10">
                          <Radio size={12} className="text-[#D6003C]" />
                       </div>
                       <div className="bg-[#111115] border border-white/5 rounded-2xl p-4 ml-2 border-l-2 hover:border-white/20 transition-all cursor-default border-[#D6003C]">
                         <div className="flex justify-between items-center mb-2">
                           <span className="text-sm font-semibold text-white">System Notes</span>
                           <span className="text-[10px] font-medium uppercase tracking-widest text-gray-500">{selectedIncident.resolved_at ? new Date(selectedIncident.resolved_at).toLocaleTimeString() : ''}</span>
                         </div>
                         <p className="text-sm text-gray-400">{selectedIncident.resolution_notes}</p>
                       </div>
                     </div>
                   ) : (
                     <div className="text-gray-500 italic text-sm">No action logs recorded.</div>
                   )}
                 </div>

                 {/* Chat Input */}
                 <div className="mt-4 pt-4 border-t border-white/5 relative flex-shrink-0">
                   <MessageSquare size={18} className="absolute left-4 top-1/2 -translate-y-1/2 mt-2 text-gray-500" />
                   <input 
                     type="text" 
                     placeholder="Add an update..." 
                     className="w-full bg-[#111115] border border-white/10 rounded-2xl py-4 pl-12 pr-24 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#D6003C]/50 focus:ring-1 focus:ring-[#D6003C]/50 transition-all"
                   />
                   <button className="absolute right-2 top-1/2 -translate-y-1/2 mt-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl transition-colors">
                     Post
                   </button>
                 </div>
               </div>
             </motion.div>
           </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
