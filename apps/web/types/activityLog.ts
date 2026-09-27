export interface ActivityLogItem {
  id: string;
  event_id: string;
  timestamp: string;
  category: "DISCOVERY" | "COMMUNICATION" | "PLANNING" | "EXECUTION" | "INCIDENT" | "APPROVAL" | "SYSTEM";
  actor: "AGENT" | "ORGANIZER" | "VENDOR" | "SYSTEM";
  action: string;
  summary: string;
  ref_id?: string | null;
  details: Record<string, any>;
}

export interface ActivityStreamResponse {
  total: number;
  items: ActivityLogItem[];
}
