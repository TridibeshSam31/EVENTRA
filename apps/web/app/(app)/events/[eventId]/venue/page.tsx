"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Users, Star, ArrowRight, Filter, ChevronDown, Check } from 'lucide-react';

const VENUES = [
  {
    id: 'v1',
    name: 'The Glass Pavilion',
    location: 'San Francisco, CA',
    image: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=2000',
    match: 98,
    capacity: 2500,
    price: '$$$',
    tags: ['Indoor', 'Modern', 'Heavy A/V'],
    description: 'A stunning modern architectural masterpiece with floor-to-ceiling glass. Perfect for high-end tech keynotes.'
  },
  {
    id: 'v2',
    name: 'Industrial Warehouse 7',
    location: 'Oakland, CA',
    image: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=2000',
    match: 85,
    capacity: 4000,
    price: '$$',
    tags: ['Raw', 'Massive', 'Outdoor Access'],
    description: 'Raw industrial space with infinite rigging possibilities. Ideal for large-scale immersive brand activations.'
  },
  {
    id: 'v3',
    name: 'Skyline Rooftop Gardens',
    location: 'San Francisco, CA',
    image: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&q=80&w=2000',
    match: 92,
    capacity: 800,
    price: '$$$$',
    tags: ['Outdoor', 'Premium', 'Views'],
    description: 'Exclusive rooftop offering panoramic views of the city skyline. Best suited for VIP networking and after-parties.'
  },
  {
    id: 'v4',
    name: 'Historic Mint Vaults',
    location: 'San Francisco, CA',
    image: 'https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&q=80&w=2000',
    match: 76,
    capacity: 1200,
    price: '$$$',
    tags: ['Historic', 'Multi-room', 'Unique'],
    description: 'Classic architecture with multiple compartmentalized vault rooms, ideal for multi-track workshops and secretive VIP rooms.'
  }
];

export default function VenueSearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('Recommended');

  const filters = ['Recommended', 'Highest Capacity', 'Lowest Cost', 'Outdoor'];

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-y-auto no-scrollbar p-4 md:p-8">
      
      {/* Header & Search */}
      <div className="flex flex-col gap-6 mb-10 shrink-0 max-w-4xl mx-auto w-full mt-4">
         <div className="text-center mb-4">
            <h1 className="text-4xl md:text-5xl font-light text-white tracking-tighter mb-4">
               Find the perfect <span className="font-bold">Venue.</span>
            </h1>
            <p className="text-gray-400">AI-curated spaces matched to your event parameters.</p>
         </div>

         <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-2xl blur-xl transition-all group-hover:blur-2xl opacity-50" />
            <div className="relative flex items-center bg-[#0B0B0F] border border-white/10 rounded-2xl p-2 shadow-2xl backdrop-blur-md">
               <div className="pl-4 pr-2 text-gray-500">
                  <Search size={20} />
               </div>
               <input 
                 type="text"
                 placeholder="Search by city, aesthetic, or venue name..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="flex-1 bg-transparent border-none text-white focus:outline-none py-3 px-2"
               />
               <button className="bg-white text-black px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-gray-200 transition-colors">
                  Search
               </button>
            </div>
         </div>

         {/* Filter Chips */}
         <div className="flex items-center justify-center gap-3 flex-wrap">
            {filters.map(f => (
               <button 
                 key={f}
                 onClick={() => setActiveFilter(f)}
                 className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                   activeFilter === f ? 'bg-white/10 text-white border border-white/20' : 'bg-transparent text-gray-500 border border-transparent hover:text-gray-300'
                 }`}
               >
                  {f}
               </button>
            ))}
         </div>
      </div>

      {/* Venue Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-[1400px] mx-auto w-full pb-20">
         <AnimatePresence>
            {VENUES.map((venue, idx) => (
               <motion.div 
                 key={venue.id}
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ delay: idx * 0.1 }}
                 className="group relative bg-[#0B0B0F] border-2 border-white/20 transition-all hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_rgba(255,255,255,0.1)] hover:border-white/50 cursor-pointer flex flex-col"
               >
                  {/* Image Background */}
                  <div className="relative h-64 md:h-72 w-full overflow-hidden border-b-2 border-white/20">
                     <img 
                       src={venue.image} 
                       alt={venue.name}
                       className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                     />
                     
                     {/* Match Badge - Boxy */}
                     <div className="absolute top-4 right-4 bg-white text-black px-3 py-1.5 flex items-center gap-2 border-2 border-transparent shadow-[2px_2px_0px_rgba(0,0,0,0.5)]">
                        <Star size={12} className="text-[#D6003C] fill-[#D6003C]" />
                        <span className="font-bold text-sm uppercase tracking-widest">{venue.match}% Match</span>
                     </div>
                  </div>

                  {/* Content - Hard cuts */}
                  <div className="p-6 md:p-8 flex-1 flex flex-col bg-[#050505]">
                     <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#38BDF8] mb-4">
                        <MapPin size={12} /> {venue.location}
                     </div>
                     <h3 className="text-3xl font-bold text-white mb-4 uppercase tracking-tight">{venue.name}</h3>
                     <p className="text-gray-400 text-sm leading-relaxed mb-8 flex-1 font-mono">
                        {venue.description}
                     </p>
                     
                     <div className="flex flex-wrap items-center gap-4 mb-8">
                        <div className="flex items-center gap-2 text-xs text-white font-bold tracking-widest uppercase bg-transparent px-3 py-2 border-2 border-white/20">
                           <Users size={14} className="text-gray-500" /> {venue.capacity} Cap
                        </div>
                        <div className="flex items-center gap-2 text-xs text-green-400 font-bold tracking-widest uppercase bg-transparent px-3 py-2 border-2 border-green-400/20">
                           {venue.price}
                        </div>
                     </div>

                     <div className="flex items-center justify-between pt-6 border-t-2 border-white/10">
                        <div className="flex flex-wrap gap-2">
                           {venue.tags.map(tag => (
                              <span key={tag} className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 bg-white/5 px-2 py-1">
                                 {tag}
                              </span>
                           ))}
                        </div>
                        <button className="w-12 h-12 bg-[#D6003C] flex items-center justify-center transition-colors border-2 border-transparent group-hover:border-white group-hover:bg-white text-white group-hover:text-black">
                           <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                        </button>
                     </div>
                  </div>
               </motion.div>
            ))}
         </AnimatePresence>
      </div>
      
    </div>
  );
}
