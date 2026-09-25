"use client";

import { Venue } from '../../types/venue';
import { X, MapPin, Users, DollarSign, Star, Calendar } from 'lucide-react';
import { VenueBooking } from './VenueBooking';

interface VenueDetailsProps {
  venue: any;
  onClose: () => void;
}

export default function VenueDetails({ venue, onClose }: VenueDetailsProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-3xl bg-[#0A0A0F] border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">{venue.name}</h2>
            <p className="text-sm text-gray-400 flex items-center gap-1.5">
              <MapPin size={14} /> {venue.location}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="w-full h-64 bg-white/5 rounded-xl mb-8 flex items-center justify-center border border-white/5">
            <span className="text-gray-500">Image Gallery Placeholder</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div className="md:col-span-2 space-y-6">
              <section>
                <h3 className="text-lg font-semibold text-white mb-3">About the Venue</h3>
                <p className="text-gray-300 leading-relaxed text-sm">
                  {venue.name} is a premier event location situated in {venue.location}. 
                  It offers state-of-the-art facilities and is perfect for events accommodating up to {venue.capacity} guests.
                </p>
              </section>
              
              <section>
                <h3 className="text-lg font-semibold text-white mb-3">Facilities</h3>
                <div className="flex flex-wrap gap-2">
                  {venue.facilities?.map((f: string) => (
                    <span key={f} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300">
                      {f}
                    </span>
                  ))}
                </div>
              </section>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <p className="text-sm text-gray-400 mb-1">Capacity</p>
                <div className="flex items-center gap-2 text-white font-medium">
                  <Users size={18} className="text-accent" /> Up to {venue.capacity}
                </div>
              </div>
              
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <p className="text-sm text-gray-400 mb-1">Pricing</p>
                <div className="flex items-center gap-2 text-white font-medium">
                  <DollarSign size={18} className="text-success" /> ${venue.pricePerDay.toLocaleString()} / day
                </div>
              </div>
              
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <p className="text-sm text-gray-400 mb-1">Rating</p>
                <div className="flex items-center gap-2 text-white font-medium">
                  <Star size={18} className="fill-yellow-500 text-yellow-500" /> {venue.rating} / 5.0
                </div>
              </div>
            </div>
          </div>
          
          <section>
            <h3 className="text-lg font-semibold text-white mb-3">Availability Highlights</h3>
            <div className="flex flex-wrap gap-3">
              {venue.availability?.map((avail: any, i: number) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${avail.available ? 'bg-success/10 border-success/20 text-success' : 'bg-emergency/10 border-emergency/20 text-emergency'}`}>
                  <Calendar size={14} />
                  <span>{avail.date}</span>
                  <span className="font-medium">{avail.available ? 'Available' : 'Booked'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        
        <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
            Cancel
          </button>
          <VenueBooking venueId={venue.id} venueName={venue.name} />
        </div>
      </div>
    </div>
  );
}
