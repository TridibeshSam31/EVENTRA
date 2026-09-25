import { PriorityTask, ActivityItem, mockTasks, mockActivity } from './mockData';

// Mutable mock data in memory for this session
let currentTasks = [...mockTasks];
let currentActivity = [...mockActivity];

export async function getTasks(eventId: string): Promise<PriorityTask[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(currentTasks.filter(t => t.eventId === eventId));
    }, 300);
  });
}

export async function toggleTask(taskId: string): Promise<PriorityTask> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const taskIndex = currentTasks.findIndex(t => t.id === taskId);
      if (taskIndex > -1) {
        currentTasks[taskIndex] = {
          ...currentTasks[taskIndex],
          completed: !currentTasks[taskIndex].completed
        };
        resolve(currentTasks[taskIndex]);
      } else {
        reject(new Error("Task not found"));
      }
    }, 300);
  });
}

export async function getActivityFeed(eventId: string): Promise<ActivityItem[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(currentActivity.filter(a => a.eventId === eventId));
    }, 300);
  });
}

export async function addTask(eventId: string, title: string, description?: string, dueDate?: string, urgent?: boolean): Promise<PriorityTask> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const newTask: PriorityTask = {
        id: 't' + Date.now(),
        eventId,
        title,
        description,
        dueDate: dueDate || 'Today',
        urgent: urgent || false,
        completed: false
      };
      currentTasks.push(newTask);
      resolve(newTask);
    }, 300);
  });
}
