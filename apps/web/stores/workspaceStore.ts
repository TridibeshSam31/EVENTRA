"use client";

import { create } from "zustand";
import { getEvent, getEventOperationsStatus } from "@/lib/api/events";
import {
  getEventShortlist,
  addShortlistEntry,
  removeShortlistEntry,
  type ShortlistEntry,
} from "@/lib/api/shortlist";
import { listApprovals } from "@/lib/api/approvals";
import { listIncidents } from "@/lib/api/incidents";

let activeEventSource: EventSource | null = null;

interface WorkspaceState {
  eventId: string | null;
  event: any | null;
  opsStatus: any | null;
  shortlist: ShortlistEntry[];
  approvals: any[];
  incidents: any[];
  isLoading: boolean;
  sseConnected: boolean;
  isAgentRunning: boolean;
  agentMessage: string | null;

  // Actions
  setEventId: (eventId: string) => void;
  refreshWorkspace: (eventId?: string) => Promise<void>;
  refreshShortlist: (eventId?: string) => Promise<void>;
  refreshApprovals: (eventId?: string) => Promise<void>;
  refreshOpsStatus: (eventId?: string) => Promise<void>;
  toggleShortlist: (candidate: any) => Promise<boolean>;
  isShortlisted: (candidateId: string) => boolean;
  connectSSE: (eventId: string) => void;
  disconnectSSE: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  eventId: null,
  event: null,
  opsStatus: null,
  shortlist: [],
  approvals: [],
  incidents: [],
  isLoading: false,
  sseConnected: false,
  isAgentRunning: false,
  agentMessage: null,

  setEventId: (eventId: string) => {
    const currentId = get().eventId;
    if (currentId !== eventId) {
      set({ eventId });
      get().connectSSE(eventId);
      get().refreshWorkspace(eventId);
    }
  },

  refreshWorkspace: async (targetId?: string) => {
    const eventId = targetId || get().eventId;
    if (!eventId) return;

    set({ isLoading: true });
    try {
      const [evRes, opsRes, slRes, appRes, incRes] = await Promise.allSettled([
        getEvent(eventId),
        getEventOperationsStatus(eventId),
        getEventShortlist(eventId),
        listApprovals(eventId),
        listIncidents(eventId),
      ]);

      set({
        event: evRes.status === "fulfilled" ? evRes.value : get().event,
        opsStatus: opsRes.status === "fulfilled" ? opsRes.value : get().opsStatus,
        shortlist: slRes.status === "fulfilled" ? slRes.value.items : get().shortlist,
        approvals: appRes.status === "fulfilled" ? appRes.value.items : get().approvals,
        incidents: incRes.status === "fulfilled" ? incRes.value.items : get().incidents,
        isLoading: false,
      });
    } catch (err) {
      console.error("[WorkspaceStore] refresh error:", err);
      set({ isLoading: false });
    }
  },

  refreshShortlist: async (targetId?: string) => {
    const eventId = targetId || get().eventId;
    if (!eventId) return;
    try {
      const res = await getEventShortlist(eventId);
      set({ shortlist: res.items || [] });
    } catch (err) {
      console.error("[WorkspaceStore] shortlist fetch error:", err);
    }
  },

  refreshApprovals: async (targetId?: string) => {
    const eventId = targetId || get().eventId;
    if (!eventId) return;
    try {
      const res = await listApprovals(eventId);
      set({ approvals: res.items || [] });
    } catch (err) {
      console.error("[WorkspaceStore] approvals fetch error:", err);
    }
  },

  refreshOpsStatus: async (targetId?: string) => {
    const eventId = targetId || get().eventId;
    if (!eventId) return;
    try {
      const res = await getEventOperationsStatus(eventId);
      set({ opsStatus: res });
    } catch (err) {
      console.error("[WorkspaceStore] ops status fetch error:", err);
    }
  },

  toggleShortlist: async (candidate: any) => {
    const eventId = get().eventId;
    if (!eventId) return false;

    const candId = String(candidate.id || candidate.source_id || candidate.name);
    const existing = get().shortlist.find(
      (s) => s.candidate_id === candId || s.provider_id === candId
    );

    if (existing) {
      // Optimistic removal
      set((state) => ({
        shortlist: state.shortlist.filter((s) => s.candidate_id !== candId),
      }));
      try {
        await removeShortlistEntry(eventId, candId);
        return false;
      } catch (err) {
        // Rollback
        get().refreshShortlist(eventId);
        return true;
      }
    } else {
      // Optimistic addition
      const tempEntry: ShortlistEntry = {
        id: `temp_${Date.now()}`,
        event_id: eventId,
        candidate_id: candId,
        provider_id: candidate.id || candidate.source_id || null,
        candidate_name: candidate.name,
        category: candidate.category || null,
        status: "SHORTLISTED",
        ranking: candidate.rank || null,
        notes: null,
        candidate_data: candidate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      set((state) => ({ shortlist: [...state.shortlist, tempEntry] }));

      try {
        const added = await addShortlistEntry(eventId, {
          candidate_id: candId,
          provider_id: candidate.id || candidate.source_id || null,
          candidate_name: candidate.name,
          category: candidate.category || null,
          status: "SHORTLISTED",
          ranking: candidate.rank || null,
          candidate_data: candidate,
        });
        set((state) => ({
          shortlist: state.shortlist.map((s) => (s.candidate_id === candId ? added : s)),
        }));
        return true;
      } catch (err) {
        // Rollback
        get().refreshShortlist(eventId);
        return false;
      }
    }
  },

  isShortlisted: (candidateId: string) => {
    const list = get().shortlist;
    const cid = String(candidateId);
    return list.some((s) => s.candidate_id === cid || s.provider_id === cid);
  },

  connectSSE: (eventId: string) => {
    if (typeof window === "undefined") return;

    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
    const sseUrl = `${apiBase}/events/${eventId}/live-stream`;

    try {
      const es = new EventSource(sseUrl);
      activeEventSource = es;

      es.onopen = () => {
        set({ sseConnected: true });
      };

      es.onerror = () => {
        set({ sseConnected: false });
      };

      const handleEventMessage = (type: string, data: any) => {
        if (type.startsWith("agent.")) {
          if (type === "agent.started") {
            set({ isAgentRunning: true, agentMessage: data?.message || "Autonomous agent started" });
          } else if (type === "agent.progress") {
            set({ isAgentRunning: true, agentMessage: data?.message || "Agent operation in progress" });
          } else if (type === "agent.completed") {
            set({ isAgentRunning: false, agentMessage: data?.message || "Agent completed operations" });
            get().refreshOpsStatus(eventId);
            get().refreshApprovals(eventId);
          } else if (type === "agent.waiting_approval") {
            set({ isAgentRunning: false, agentMessage: data?.message || "Awaiting human approval" });
            get().refreshApprovals(eventId);
            get().refreshOpsStatus(eventId);
          }
        } else if (type.startsWith("approval.")) {
          get().refreshApprovals(eventId);
          get().refreshOpsStatus(eventId);
        } else if (type === "shortlist.updated") {
          get().refreshShortlist(eventId);
        } else if (type.startsWith("assignment.")) {
          get().refreshOpsStatus(eventId);
        } else if (type.startsWith("incident.")) {
          get().refreshWorkspace(eventId);
        }
      };

      // Listen for named SSE event types
      const registeredTypes = [
        "connected",
        "agent.started",
        "agent.progress",
        "agent.completed",
        "agent.waiting_approval",
        "shortlist.updated",
        "approval.created",
        "approval.updated",
        "assignment.updated",
        "incident.created",
        "incident.resolved",
      ];

      registeredTypes.forEach((t) => {
        es.addEventListener(t, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            handleEventMessage(t, data);
          } catch {
            // Ignore parse errors
          }
        });
      });

      // Also listen on generic message
      es.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type) {
            handleEventMessage(data.type, data);
          }
        } catch {
          // Ignore parse errors
        }
      };
    } catch (err) {
      console.warn("[WorkspaceStore] SSE connection failed:", err);
    }
  },

  disconnectSSE: () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    set({ sseConnected: false });
  },
}));
