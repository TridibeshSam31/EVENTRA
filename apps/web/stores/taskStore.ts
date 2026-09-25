import { create } from 'zustand';
import { PriorityTask, ActivityItem } from '../lib/api/mockData';
import { getTasks, toggleTask, getActivityFeed } from '../lib/api/tasks';

interface TaskState {
  tasks: PriorityTask[];
  isLoadingTasks: boolean;
  fetchTasks: (eventId: string) => Promise<void>;
  toggleTaskCompletion: (taskId: string) => Promise<void>;
  addTask: (eventId: string, title: string, description?: string, dueDate?: string, urgent?: boolean) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoadingTasks: false,

  fetchTasks: async (eventId: string) => {
    set({ isLoadingTasks: true });
    try {
      const tasks = await getTasks(eventId);
      set({ tasks, isLoadingTasks: false });
    } catch (error) {
      console.error('Failed to fetch tasks', error);
      set({ isLoadingTasks: false });
    }
  },


  toggleTaskCompletion: async (taskId: string) => {
    const previousTasks = get().tasks;
    // Optimistic update
    set({
      tasks: previousTasks.map(t => 
        t.id === taskId ? { ...t, completed: !t.completed } : t
      )
    });

    const task = previousTasks.find(t => t.id === taskId);
    if (task && !task.completed) {
      import('./activityStore').then(({ useActivityStore }) => {
        useActivityStore.getState().addActivity(task.eventId, `completed '${task.title}'`);
      });
    }

    try {
      await toggleTask(taskId);
    } catch (error) {
      // Revert on failure
      console.error('Failed to toggle task', error);
      set({ tasks: previousTasks });
    }
  },

  addTask: async (eventId: string, title: string, description?: string, dueDate?: string, urgent?: boolean) => {
    // Optimistic update
    const newTask: PriorityTask = {
      id: 'temp-' + Date.now(),
      eventId,
      title,
      description,
      dueDate: dueDate || 'Today',
      urgent: urgent || false,
      completed: false
    };
    
    set({ tasks: [...get().tasks, newTask] });
    
    import('./activityStore').then(({ useActivityStore }) => {
      useActivityStore.getState().addActivity(eventId, `added task '${title}'`);
    });
    
    try {
      // You could await an addTask api call here if it existed, but we'll simulate it implicitly
      // We don't have addTask in the api, we could add it, but for UI purposes just appending it locally is fine for now, or we can add it to tasks.ts.
      const { addTask: apiAddTask } = await import('../lib/api/tasks');
      const addedTask = await apiAddTask(eventId, title, description, dueDate, urgent);
      set({ tasks: get().tasks.map(t => t.id === newTask.id ? addedTask : t) });
    } catch (error) {
      console.error('Failed to add task', error);
      set({ tasks: get().tasks.filter(t => t.id !== newTask.id) });
    }
  }
}));
