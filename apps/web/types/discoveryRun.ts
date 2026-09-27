export interface DiscoveryRunEvent {
  id: string;
  run_id: string;
  iteration: number;
  event_type: string;
  message: string;
  data: Record<string, any>;
  timestamp: string;
}

export interface DiscoveryRun {
  run_id: string;
  event_id: string;
  category: string;
  status: "RUNNING" | "COMPLETED" | "TARGET_REACHED" | "EXHAUSTED" | "FAILED" | "PAUSED" | string;
  trigger: "routine" | "operations" | "recovery" | "manual";
  incident_id?: string | null;
  current_iteration: number;
  max_iterations: number;
  radius_km: number;
  target_count: number;
  discovered: number;
  unique: number;
  relevant: number;
  matching: number;
  shortlisted: number;
  summary?: string | null;
  parameters: Record<string, any>;
  created_at: string;
  updated_at: string;
  latest_events?: DiscoveryRunEvent[];
}

export interface DiscoveryRunListResponse {
  items: DiscoveryRun[];
  total: number;
}
