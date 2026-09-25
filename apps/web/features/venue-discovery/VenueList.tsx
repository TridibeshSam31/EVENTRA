"use client";

import { useVenueStore } from '../../stores/venueStore';
import VenueCard from './VenueCard';
import { Venue } from '../../types/venue';

interface VenueListProps {
  onViewDetails: (venue: Venue) => void;
}

export default function VenueList({ onViewDetails }: VenueListProps) {
  const { venues, isLoading } = useVenueStore();

  if (isLoading) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mb-4"></div>
        <p className="text-gray-400">Discovering venues...</p>
      </div>
    );
  }

  if (venues.length === 0) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
          <span className="text-2xl">🏢</span>
        </div>
        <h3 className="text-lg font-medium text-white mb-2">No venues found</h3>
        <p className="text-gray-400 max-w-sm">Try adjusting your filters or search query to find more options.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {venues.map((venue) => (
        <VenueCard key={venue.id} venue={venue} onViewDetails={onViewDetails} />
      ))}
    </div>
  );
}
