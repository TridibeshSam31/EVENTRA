/**
 * Browser Runtime API client for EVENTRA.
 * Connects frontend verification dashboard to FastAPI /api/browser-runtime endpoints.
 */

import { apiRequest } from "./client";

export interface TabInfo {
  tab_id: string;
  url: string;
  title: string;
  is_active: boolean;
}

export interface BrowserSessionState {
  session_id: string;
  status: "running" | "stopped" | "failed";
  active_tab_id?: string;
  tabs: TabInfo[];
  viewer_url: string;
  error?: string;
}

export interface BrowserHealthResponse {
  status: string;
  display: string;
  is_running: boolean;
  active_session?: string | null;
  viewer_url: string;
}

export const browserRuntimeApi = {
  getHealth: () =>
    apiRequest<BrowserHealthResponse>("/browser-runtime/health"),

  startSession: (initialUrl?: string, sessionId?: string) =>
    apiRequest<BrowserSessionState>("/browser-runtime/sessions", {
      method: "POST",
      body: JSON.stringify({
        initial_url: initialUrl || undefined,
        session_id: sessionId || undefined,
      }),
      headers: { "Content-Type": "application/json" },
    }),

  getSession: (sessionId: string) =>
    apiRequest<BrowserSessionState>(`/browser-runtime/sessions/${sessionId}`),

  navigate: (sessionId: string, url: string, tabId?: string) =>
    apiRequest<BrowserSessionState>(`/browser-runtime/sessions/${sessionId}/navigate`, {
      method: "POST",
      body: JSON.stringify({
        url,
        tab_id: tabId || undefined,
      }),
      headers: { "Content-Type": "application/json" },
    }),

  createTab: (sessionId: string, url?: string) =>
    apiRequest<BrowserSessionState>(`/browser-runtime/sessions/${sessionId}/tabs`, {
      method: "POST",
      body: JSON.stringify({
        url: url || undefined,
      }),
      headers: { "Content-Type": "application/json" },
    }),

  activateTab: (sessionId: string, tabId: string) =>
    apiRequest<BrowserSessionState>(`/browser-runtime/sessions/${sessionId}/tabs/${tabId}/activate`, {
      method: "POST",
    }),

  stopSession: (sessionId: string) =>
    apiRequest<BrowserSessionState>(`/browser-runtime/sessions/${sessionId}/stop`, {
      method: "POST",
    }),
};
