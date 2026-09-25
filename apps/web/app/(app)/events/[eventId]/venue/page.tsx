"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Users, Star, ArrowRight, Filter, ChevronDown, Check, Loader2, Radar } from 'lucide-react';
import { discoverVenuesForEvent } from '../../../../../lib/api/venues';
import { getEvent } from '../../../../../lib/api/events';
import type { VenueResponse } from '../../../../../types/api';

const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?auto=format&fit=crop&q=80&w=2000',
];

export default function VenueSearchPage() {
  const params = useParams();
  const eventId = params?.eventId as string;
  
  const [activeFilter, setActiveFilter] = useState('Recommended');
  const [venues, setVenues] = useState<VenueResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [eventCity, setEventCity] = useState('');

  const filters = ['Recommended', 'Highest Capacity', 'Lowest Cost', 'Outdoor'];

  const fetchVenues = async (query?: string, city?: string) => {
    if (!eventId) return;
    setIsLoading(true);
    try {
      const res = await discoverVenuesForEvent(eventId, { 
         query: query || undefined,
         city: city || undefined,
         limit: 12,
         save_to_db: true
      });
      if (res && res.items) {
        setVenues(res.items);
      } else {
        setVenues([]);
      }
    } catch (error) {
      console.error("Failed to discover venues:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        const ev = await getEvent(eventId);
        const city = ev?.location || 'San Francisco';
        setEventCity(city);
        await fetchVenues('', city);
      } catch (err) {
        console.error("Error fetching event for venue page", err);
        await fetchVenues();
      }
    };
    if (eventId) {
      initialize();
    }
  }, [eventId]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVenues(undefined, eventCity);
  };

  const getPriceRating = (rate: number | null | undefined) => {
    if (!rate) return '$$';
    if (rate < 250) return '$';
    if (rate < 500) return '$$';
    if (rate < 1000) return '$$$';
    return '$$$$';
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-y-auto no-scrollbar p-4 md:p-8 relative">
      
      {/* Header & Search */}
      <div className="flex flex-col gap-6 mb-10 shrink-0 max-w-4xl mx-auto w-full mt-4 z-10 relative">
         <div className="text-center mb-4">
            <h1 className="text-4xl md:text-5xl font-light text-white tracking-tighter mb-4">
               Live Venue <span className="font-bold">Discovery.</span>
            </h1>
            <p className="text-gray-400">Connected to live OpenStreetMap network. AI-curated spaces in {eventCity || "your city"}.</p>
         </div>

         <form onSubmit={handleSearch} className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-2xl blur-xl transition-all group-hover:blur-2xl opacity-50" />
            <div className="relative flex items-center bg-[#0B0B0F] border border-white/10 rounded-2xl p-2 shadow-2xl backdrop-blur-md">
               <div className="flex w-full items-center">
                 <div className="pl-4 pr-2 text-gray-500">
                    <MapPin size={20} className={isLoading ? "animate-pulse text-[#D6003C]" : ""} />
                 </div>
                 <input 
                   type="text"
                   placeholder="Search location (e.g. New Delhi, London)..."
                   value={eventCity}
                   onChange={(e) => setEventCity(e.target.value)}
                   className="flex-1 bg-transparent border-none text-white focus:outline-none py-3 px-2 placeholder:text-gray-600"
                   disabled={isLoading}
                   required
                 />
                 <button 
                   type="submit" 
                   disabled={isLoading || !eventCity}
                   className="bg-white text-black px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-gray-200 transition-colors disabled:opacity-50 ml-2 shrink-0"
                 >
                    {isLoading ? 'Scanning...' : 'Search'}
                 </button>
               </div>
            </div>
         </form>

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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 max-w-[1400px] mx-auto w-full pb-20 relative z-10">
         <AnimatePresence mode="popLayout">
            {isLoading && venues.length === 0 ? (
               <motion.div 
                 initial={{ opacity: 0 }} 
                 animate={{ opacity: 1 }} 
                 exit={{ opacity: 0 }}
                 className="col-span-1 xl:col-span-2 flex flex-col items-center justify-center py-20"
               >
                 <Loader2 size={48} className="animate-spin text-[#D6003C] mb-4" />
                 <h3 className="text-xl font-medium text-white">Scanning Live Network</h3>
                 <p className="text-gray-400 mt-2">Connecting to geospatial providers...</p>
               </motion.div>
            ) : venues.length === 0 ? (
               <motion.div 
                 initial={{ opacity: 0 }} 
                 animate={{ opacity: 1 }} 
                 exit={{ opacity: 0 }}
                 className="col-span-1 xl:col-span-2 flex flex-col items-center justify-center py-20 text-center"
               >
                 <MapPin size={48} className="text-gray-600 mb-4" />
                 <h3 className="text-xl font-medium text-white">No Venues Found</h3>
                 <p className="text-gray-400 mt-2 max-w-md">We couldn't find any venues matching your criteria in the live geospatial network. Try adjusting your search query.</p>
               </motion.div>
            ) : (
               venues.map((venue, idx) => {
                 const matchScore = Math.max(70, 99 - (idx * 3));
                 const image = PLACEHOLDER_IMAGES[idx % PLACEHOLDER_IMAGES.length];
                 const price = getPriceRating(venue.hourly_rate);
                 const tags = venue.amenities?.slice(0, 3) || [venue.venue_type];

                 return (
                   <motion.div 
                     key={venue.id}
                     initial={{ opacity: 0, y: 20 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     transition={{ delay: Math.min(idx * 0.1, 1) }}
                     className="group relative bg-[#0B0B0F] border-2 border-white/20 transition-all hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_rgba(255,255,255,0.1)] hover:border-white/50 cursor-pointer flex flex-col"
                   >
                      {/* Image Background */}
                      <div className="relative h-64 md:h-72 w-full overflow-hidden border-b-2 border-white/20">
                         <img 
                           src={image} 
                           alt={venue.name}
                           className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                         />
                         
                         {/* Live Badge */}
                         <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-white px-3 py-1.5 flex items-center gap-2 border border-white/10 rounded-full">
                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,1)] animate-pulse" />
                            <span className="font-bold text-[10px] uppercase tracking-widest text-gray-300">Live API</span>
                         </div>

                         {/* Match Badge - Boxy */}
                         <div className="absolute top-4 right-4 bg-white text-black px-3 py-1.5 flex items-center gap-2 border-2 border-transparent shadow-[2px_2px_0px_rgba(0,0,0,0.5)]">
                            <Star size={12} className="text-[#D6003C] fill-[#D6003C]" />
                            <span className="font-bold text-sm uppercase tracking-widest">{matchScore}% Match</span>
                         </div>
                      </div>

                      {/* Content - Hard cuts */}
                      <div className="p-6 md:p-8 flex-1 flex flex-col bg-[#050505]">
                         <div className="flex flex-col gap-1 mb-4">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#38BDF8]">
                               <MapPin size={12} /> {venue.city || eventCity}
                            </div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider truncate">
                               {venue.address || "Address available upon request"}
                            </div>
                         </div>

                         <h3 className="text-3xl font-bold text-white mb-2 uppercase tracking-tight leading-none line-clamp-2">{venue.name}</h3>
                         <p className="text-gray-400 text-sm leading-relaxed mb-6 flex-1 font-mono line-clamp-3">
                            A highly-rated {venue.venue_type.toLowerCase()} located in the heart of {venue.city}. 
                            {venue.hourly_rate ? ` Available starting at $${venue.hourly_rate}/hr.` : " Contact for pricing details."}
                         </p>
                         
                         <div className="flex flex-wrap items-center gap-4 mb-8 mt-auto">
                            <div className="flex items-center gap-2 text-xs text-white font-bold tracking-widest uppercase bg-transparent px-3 py-2 border-2 border-white/20">
                               <Users size={14} className="text-gray-500" /> {venue.capacity} Cap
                            </div>
                            <div className="flex items-center gap-2 text-xs text-green-400 font-bold tracking-widest uppercase bg-transparent px-3 py-2 border-2 border-green-400/20">
                               {price}
                            </div>
                         </div>

                         <div className="flex items-center justify-between pt-6 border-t-2 border-white/10">
                            <div className="flex flex-wrap gap-2 max-w-[70%]">
                               {tags.map(tag => (
                                  <span key={tag} className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 bg-white/5 px-2 py-1 truncate max-w-full">
                                     {tag.replace(/_/g, ' ')}
                                  </span>
                               ))}
                            </div>
                            <button className="w-12 h-12 bg-[#D6003C] flex items-center justify-center transition-colors border-2 border-transparent group-hover:border-white group-hover:bg-white text-white group-hover:text-black shrink-0">
                               <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                            </button>
                         </div>
                      </div>
                   </motion.div>
                 );
               })
            )}
         </AnimatePresence>
      </div>
      
    </div>
  );
}
