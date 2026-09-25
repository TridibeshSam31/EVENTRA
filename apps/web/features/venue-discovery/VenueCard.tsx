"use client";

import { Venue } from '../../types/venue';
import { useVenueStore } from '../../stores/venueStore';
import { Users, DollarSign, MapPin, Star } from 'lucide-react';

interface VenueCardProps {
  venue: Venue;
  onViewDetails: (venue: Venue) => void;
}

export default function VenueCard({ venue, onViewDetails }: VenueCardProps) {
  const { selectedVenueIds, toggleVenueSelection } = useVenueStore();
  const isSelected = selectedVenueIds.includes(venue.id);
  const canSelectMore = selectedVenueIds.length < 3 || isSelected;

  return (
    <div className="glass-panel p-4 flex flex-col group relative overflow-hidden transition-all hover:-translate-y-1 hover:shadow-[0_10px_30px_-10px_rgba(129,140,248,0.2)]">
      {/* Compare Checkbox */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <input 
          type="checkbox"
          checked={isSelected}
          disabled={!canSelectMore}
          onChange={() => toggleVenueSelection(venue.id)}
          className="w-5 h-5 rounded border-white/20 bg-black/50 backdrop-blur text-accent focus:ring-accent/50 cursor-pointer"
        />
      </div>

      {/* Image Placeholder */}
      <div className="w-full h-40 bg-white/5 rounded-lg mb-4 flex items-center justify-center border border-white/5">
        <span className="text-gray-500 text-sm">No Image</span>
      </div>

      <div className="flex-1">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-lg text-white line-clamp-1">{venue.name}</h3>
          <div className="flex items-center gap-1 text-sm text-yellow-500 font-medium">
            <Star size={14} className="fill-yellow-500" />
            {venue.rating}
          </div>
        </div>
        
        <p className="text-sm text-gray-400 flex items-center gap-1.5 mb-4">
          <MapPin size={14} /> {venue.location}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex items-center gap-2 text-sm text-gray-300 bg-white/5 p-2 rounded-lg">
            <Users size={16} className="text-accent" />
            <span>Up to {venue.capacity}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-300 bg-white/5 p-2 rounded-lg">
            <DollarSign size={16} className="text-success" />
            <span>${venue.pricePerDay.toLocaleString()}/day</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-6">
          {venue.facilities.slice(0, 3).map(f => (
            <span key={f} className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400">
              {f}
            </span>
          ))}
          {venue.facilities.length > 3 && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400">
              +{venue.facilities.length - 3} more
            </span>
          )}
        </div>
      </div>

      <button 
        onClick={() => onViewDetails(venue)}
        className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white transition-colors"
      >
        View Details
      </button>
    </div>
  );
}
