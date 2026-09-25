export type StatusHealth = 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  event: string;
  severity: StatusHealth;
}

export interface ItemStatus {
  id: string;
  name: string;
  planned: string;
  actual: string;
  status: StatusHealth;
  variance?: string; // e.g., "+15 mins"
}

export interface LiveEventState {
  eventId: string;
  overallHealth: StatusHealth;
  taskStatuses: ItemStatus[];
  providerStatuses: ItemStatus[];
  venueStatus: ItemStatus[];
  budgetStatus: ItemStatus[];
  scheduleStatus: ItemStatus[];
  timeline: TimelineEvent[];
}
