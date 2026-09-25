"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Search, Plus, Filter, MapPin, Phone, Mail, ShieldCheck, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

const mockProviders = [
  { id: 1, name: 'Apex Audio Visual', service: 'AV & Lighting', contact: 'Mike Davis', phone: '+1 (555) 123-4567', email: 'mike@apexav.com', status: 'confirmed', location: 'On-Site', rating: 4.8 },
  { id: 2, name: 'Gourmet Catering Co.', service: 'Food & Beverage', contact: 'Sarah Jenkins', phone: '+1 (555) 987-6543', email: 'orders@gourmet.co', status: 'pending', location: 'Off-Site', rating: 4.5 },
  { id: 3, name: 'SecureTech', service: 'Event Security', contact: 'David Lee', phone: '+1 (555) 456-7890', email: 'dispatch@securetech.com', status: 'confirmed', location: 'On-Site', rating: 4.9 },
  { id: 4, name: 'City Floral Design', service: 'Decor & Floral', contact: 'Emma Stone', phone: '+1 (555) 321-6547', email: 'hello@cityfloral.com', status: 'in-review', location: 'Off-Site', rating: 4.2 },
  { id: 5, name: 'Vanguard Transport', service: 'Logistics', contact: 'James Wilson', phone: '+1 (555) 888-9999', email: 'freight@vanguard.com', status: 'confirmed', location: 'In Transit', rating: 4.7 },
  { id: 6, name: 'Elite Staffing', service: 'Brand Ambassadors', contact: 'Lisa Chen', phone: '+1 (555) 777-2222', email: 'booking@elitestaffing.com', status: 'confirmed', location: 'On-Site', rating: 4.6 },
];

export default function ProvidersPage() {
  const [search, setSearch] = useState('');

  return (
    <div className="w-full h-full flex flex-col space-y-8 text-white font-sans pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="text-purple-400 w-5 h-5" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-purple-400 uppercase">Vendor Network</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight">
            Service <span className="font-bold">Providers</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-purple-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Search vendors..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/50 transition-all w-full md:w-64 placeholder:text-gray-600"
            />
          </div>
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded-full transition-all">
            <Filter className="w-4 h-4 text-gray-300" />
          </button>
          <button className="bg-purple-500 hover:bg-purple-600 text-white flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)]">
            <Plus className="w-4 h-4" />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockProviders
          .filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.service.toLowerCase().includes(search.toLowerCase()))
          .map((provider, i) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            key={provider.id}
            className="bg-[#111115] border border-white/5 rounded-3xl p-6 relative overflow-hidden group hover:border-white/20 transition-all hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
          >
            {/* Status indicator line */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${
              provider.status === 'confirmed' ? 'bg-emerald-500' : 
              provider.status === 'pending' ? 'bg-amber-500' : 'bg-blue-500'
            }`} />

            <div className="flex justify-between items-start mb-6">
               <div className="flex items-center gap-3">
                 <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-800 to-black border border-white/10 flex items-center justify-center text-lg font-bold">
                    {provider.name.charAt(0)}
                 </div>
                 <div>
                    <h3 className="font-semibold text-white group-hover:text-purple-400 transition-colors">{provider.name}</h3>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-0.5">{provider.service}</p>
                 </div>
               </div>
               
               {/* Status Badge */}
               <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                 provider.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                 provider.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
               }`}>
                  {provider.status === 'confirmed' ? <CheckCircle2 className="w-3 h-3" /> : provider.status === 'pending' ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                  {provider.status}
               </div>
            </div>

            <div className="space-y-4 text-sm text-gray-400">
               <div className="flex items-center gap-3 p-3 bg-black/40 rounded-xl border border-white/5">
                 <div className="bg-white/5 p-1.5 rounded-lg text-gray-300">
                    <Users className="w-4 h-4" />
                 </div>
                 <div className="flex-1">
                    <div className="text-[10px] uppercase text-gray-500 font-bold mb-0.5">Point of Contact</div>
                    <div className="text-white text-xs">{provider.contact}</div>
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-3">
                 <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-mono">{provider.phone}</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs truncate" title={provider.email}>{provider.email}</span>
                 </div>
                 <div className="flex items-center gap-2 col-span-2 mt-2 pt-2 border-t border-white/5">
                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-mono">{provider.location}</span>
                    <div className="ml-auto flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                       ★ {provider.rating}
                    </div>
                 </div>
               </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
               <button className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition-colors">
                  View Contract <ExternalLink className="w-3 h-3" />
               </button>
            </div>
          </motion.div>
        ))}
      </div>
      
    </div>
  );
}
