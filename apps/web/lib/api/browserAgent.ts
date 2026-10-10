/**
 * Browser Agent API client for EVENTRA (Phase 2).
 * Provides execution lifecycle coordination and real-time WebSocket event streaming.
 */

import { apiRequest } from "./client";
import { TabInfo } from "./browserRuntime";

export type ExecutionStatus =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "disconnected";

export interface ExecutionEvent {
  execution_id: string;
  event_type: string;
  seq: number;
  timestamp: string;
  message: string;
  data: Record<string, any>;
}

export interface ExecutionResponse {
  execution_id: string;
  event_id?: string | null;
  user_id: string;
  session_id?: string | null;
  status: ExecutionStatus;
  created_at: string;
  updated_at: string;
  current_url?: string | null;
  current_title?: string | null;
  active_tab_id?: string | null;
  tabs: TabInfo[];
  viewer_url: string;
  error?: string | null;
  event_count: number;
}

export interface DiscoveredCandidate {
  id: string;
  name: string;
  category: string;
  raw_category?: string | null;
  address?: string | null;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  maps_url?: string | null;
  rating?: number | null;
  review_count?: number | null;
  base_cost?: number | null;
  capacity?: number | null;
  source: string;
  source_id?: string | null;
  field_sources: Record<string, string>;
  evidence: string[];
  qualification_status: "qualified" | "uncertain" | "rejected";
  qualification_reasons: string[];
  is_persisted: boolean;
  vendor_id?: string | null;
  is_new_vendor?: boolean | null;
}

export interface BrowserDiscoveryRequest {
  event_id: string;
  category: string;
  max_results?: number;
  custom_query?: string | null;
  persist_results?: boolean;
  use_fallback_if_blocked?: boolean;
}

export interface BrowserDiscoveryResponse {
  execution_id: string;
  event_id: string;
  query: string;
  category: string;
  status: string;
  total_found: number;
  total_qualified: number;
  total_persisted: number;
  candidates: DiscoveredCandidate[];
  warnings: string[];
  provenance: Record<string, any>;
}

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";

export const browserAgentApi = {
  createExecution: (initialUrl?: string, eventId?: string, executionId?: string) =>
    apiRequest<ExecutionResponse>("/browser-agent/executions", {
      method: "POST",
      body: JSON.stringify({
        initial_url: initialUrl || "about:blank",
        event_id: eventId || undefined,
        execution_id: executionId || undefined,
      }),
      headers: { "Content-Type": "application/json" },
    }),

  listExecutions: (eventId?: string) =>
    apiRequest<ExecutionResponse[]>("/browser-agent/executions", {
      params: { event_id: eventId },
    }),

  getExecution: (executionId: string) =>
    apiRequest<ExecutionResponse>(`/browser-agent/executions/${executionId}`),

  navigate: (executionId: string, url: string, tabId?: string) =>
    apiRequest<ExecutionResponse>(`/browser-agent/executions/${executionId}/navigate`, {
      method: "POST",
      body: JSON.stringify({ url, tab_id: tabId }),
      headers: { "Content-Type": "application/json" },
    }),

  createTab: (executionId: string, url?: string) =>
    apiRequest<ExecutionResponse>(`/browser-agent/executions/${executionId}/tabs`, {
      method: "POST",
      body: JSON.stringify({ url }),
      headers: { "Content-Type": "application/json" },
    }),

  activateTab: (executionId: string, tabId: string) =>
    apiRequest<ExecutionResponse>(`/browser-agent/executions/${executionId}/tabs/${tabId}/activate`, {
      method: "POST",
    }),

  stopExecution: (executionId: string, reason?: string) =>
    apiRequest<ExecutionResponse>(`/browser-agent/executions/${executionId}/stop`, {
      method: "POST",
      body: JSON.stringify({ reason }),
      headers: { "Content-Type": "application/json" },
    }),

  discover: (executionId: string, req: BrowserDiscoveryRequest) =>
    apiRequest<BrowserDiscoveryResponse>(`/browser-agent/executions/${executionId}/discover`, {
      method: "POST",
      body: JSON.stringify(req),
      headers: { "Content-Type": "application/json" },
    }),

  getCandidates: (executionId: string) =>
    apiRequest<DiscoveredCandidate[]>(`/browser-agent/executions/${executionId}/candidates`),

  discoverOneShot: (req: BrowserDiscoveryRequest) =>
    apiRequest<BrowserDiscoveryResponse>("/browser-agent/discover", {
      method: "POST",
      body: JSON.stringify(req),
      headers: { "Content-Type": "application/json" },
    }),

  /**
   * Subscribes to live execution telemetry events over WebSocket.
   * Automatically attempts reconnection and recovers state.
   */
  subscribeEvents: (
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onError?: (err: any) => void,
    lastSeq?: number,
  ): (() => void) => {
    // Construct WebSocket URL matching backend endpoint
    const urlObj = new URL(WS_BASE_URL);
    const protocol = urlObj.protocol === "wss:" ? "wss:" : "ws:";
    const host = urlObj.host || "localhost:8000";
    const wsUrl = `${protocol}//${host}/api/browser-agent/executions/${executionId}/events${
      lastSeq ? `?last_seq=${lastSeq}` : ""
    }`;

    let socket: WebSocket | null = null;
    let isClosed = false;

    try {
      socket = new WebSocket(wsUrl);

      socket.onmessage = (msgEvent) => {
        try {
          const parsed: ExecutionEvent = JSON.parse(msgEvent.data);
          onEvent(parsed);
        } catch (e) {
          console.error("Failed to parse WebSocket event:", e);
        }
      };

      socket.onerror = (err) => {
        if (!isClosed && onError) onError(err);
      };

      socket.onclose = () => {
        // Socket closed cleanly
      };
    } catch (e) {
      if (onError) onError(e);
    }

    return () => {
      isClosed = true;
      if (socket) {
        try {
          socket.close();
        } catch {}
      }
    };
  },
};
