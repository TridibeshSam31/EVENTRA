import { create } from 'zustand';
import { Venue } from '../types/venue';
import { getVenues, VenueFilters } from '../lib/api/venues';

interface VenueState {
  venues: Venue[];
  isLoading: boolean;
  filters: VenueFilters;
  selectedVenueIds: string[];
  bookedVenueId: string | null;
  
  fetchVenues: () => Promise<void>;
  setFilters: (filters: Partial<VenueFilters>) => void;
  toggleVenueSelection: (venueId: string) => void;
  setBookedVenue: (venueId: string) => void;
  clearSelection: () => void;
}

export const useVenueStore = create<VenueState>((set, get) => ({
  venues: [],
  isLoading: false,
  filters: {},
  selectedVenueIds: [],
  bookedVenueId: null,

  fetchVenues: async () => {
    set({ isLoading: true });
    try {
      const { filters } = get();
      const venues = await getVenues(filters);
      set({ venues, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch venues', error);
      set({ isLoading: false });
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
    get().fetchVenues();
  },

  toggleVenueSelection: (venueId) => {
    set((state) => {
      const isSelected = state.selectedVenueIds.includes(venueId);
      if (isSelected) {
        return { selectedVenueIds: state.selectedVenueIds.filter(id => id !== venueId) };
      }
      if (state.selectedVenueIds.length >= 3) {
        // Limit to 3 for comparison
        return state;
      }
      return { selectedVenueIds: [...state.selectedVenueIds, venueId] };
    });
  },

  setBookedVenue: (venueId) => set({ bookedVenueId: venueId }),
  clearSelection: () => set({ selectedVenueIds: [] }),
}));
