import { create } from 'zustand';
import { ActivityItem } from '../lib/api/mockData';

interface ActivityState {
  activity: ActivityItem[];
  isLoadingActivity: boolean;
  fetchActivity: (eventId: string) => Promise<void>;
  addActivity: (eventId: string, action: string, actor?: string) => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activity: [],
  isLoadingActivity: false,

  fetchActivity: async (eventId: string) => {
    set({ isLoadingActivity: true });
    try {
      const { mockActivity } = await import('../lib/api/mockData');
      const eventActivity = mockActivity.filter((a: ActivityItem) => a.eventId === eventId);
      set({ activity: eventActivity, isLoadingActivity: false });
    } catch (error) {
      console.error('Failed to fetch activity', error);
      set({ isLoadingActivity: false });
    }
  },

  addActivity: (eventId: string, action: string, actor?: string) => {
    const newItem: ActivityItem = {
      id: 'a' + Date.now() + Math.random().toString(36).substring(7),
      eventId,
      actor: actor || 'You',
      action,
      timestamp: new Date().toISOString(),
    };
    
    // Update local state if the active event matches
    set((state) => ({
      activity: [newItem, ...state.activity]
    }));
    
    // Mutate the mock data source so the new activity persists when switching events
    import('../lib/api/mockData').then(({ mockActivity }) => {
      mockActivity.unshift(newItem);
    });
  }
}));
