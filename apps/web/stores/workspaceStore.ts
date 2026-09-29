"use client";

import { create } from "zustand";
import { getEvent, getEventOperationsStatus } from "@/lib/api/events";
import {
  getEventShortlist,
  addShortlistEntry,
  removeShortlistEntry,
  selectShortlistCandidate,
  approveShortlistCommunication,
  dismissShortlistCommunication,
  type ShortlistEntry,
} from "@/lib/api/shortlist";
import { listApprovals } from "@/lib/api/approvals";
import { listIncidents } from "@/lib/api/incidents";

let activeEventSource: EventSource | null = null;
let activeEventId: string | null = null;

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
  isWaitingForSelection: boolean;
  agentMessage: string | null;

  // Actions
  setEventId: (eventId: string) => void;
  hydrateFromSnapshot: (snapshot: any) => void;
  refreshWorkspace: (eventId?: string) => Promise<void>;
  refreshShortlist: (eventId?: string) => Promise<void>;
  refreshApprovals: (eventId?: string) => Promise<void>;
  refreshOpsStatus: (eventId?: string) => Promise<void>;
  toggleShortlist: (candidate: any) => Promise<boolean>;
  selectCandidate: (candidateId: string) => Promise<ShortlistEntry>;
  approveCommunication: (candidateId: string) => Promise<ShortlistEntry>;
  dismissCommunication: (candidateId: string) => Promise<ShortlistEntry>;
  isShortlisted: (candidateId: string) => boolean;
  isCandidateSelected: (candidateId: string) => boolean;
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
  isWaitingForSelection: false,
  agentMessage: null,

  setEventId: (eventId: string) => {
    const currentId = get().eventId;
    if (currentId !== eventId) {
      set({ eventId });
      get().connectSSE(eventId);
      get().refreshWorkspace(eventId);
    }
  },

  hydrateFromSnapshot: (snapshot: any) => {
    if (!snapshot) return;
    const agentWaiting =
      snapshot?.agent?.is_waiting_for_selection ||
      snapshot?.agent?.status === "WAITING_FOR_USER_SELECTION";
    const agentRunning =
      snapshot?.agent?.status === "RUNNING" ||
      snapshot?.agent?.status === "DISCOVERING";

    let agentMsg = get().agentMessage;
    if (agentWaiting) {
      agentMsg = "EVENTRA has found suitable options and is waiting for your selection.";
    } else if (snapshot?.agent?.current_step) {
      agentMsg = snapshot.agent.current_step;
    } else if (snapshot?.agent?.status === "FAILED") {
      agentMsg = `Agent failed: ${snapshot.agent.error || "Unknown error"}`;
    }

    const recommendations = snapshot.recommendations || [];
    const snapshotShortlist: ShortlistEntry[] = recommendations.map((rec: any) => ({
      id: rec.shortlist_entry_id || rec.id,
      event_id: snapshot.event_id || get().eventId,
      candidate_id: rec.candidate_id,
      provider_id: rec.provider_id,
      category: rec.category,
      candidate_name: rec.name || rec.candidate_name,
      status: rec.status || "RECOMMENDED",
      ranking: rec.ranking,
      selection_source: rec.selection_source || "AGENT_RECOMMENDATION",
      selected_by: rec.selected_by || null,
      selected_at: rec.selected_at || null,
      notes: rec.notes || null,
      candidate_data: rec.candidate_data || {},
      created_at: rec.selected_at || new Date().toISOString(),
      updated_at: rec.selected_at || new Date().toISOString(),
    }));

    set({
      opsStatus: snapshot,
      shortlist: snapshotShortlist.length > 0 ? snapshotShortlist : get().shortlist,
      isWaitingForSelection: !!agentWaiting,
      isAgentRunning: !!agentRunning,
      agentMessage: agentMsg,
      isLoading: false,
      sseConnected: true,
    });
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

      const opsVal = opsRes.status === "fulfilled" ? opsRes.value : get().opsStatus;
      const agentWaiting =
        opsVal?.agent?.is_waiting_for_selection ||
        opsVal?.agent?.status === "WAITING_FOR_USER_SELECTION";
      const agentRunning =
        opsVal?.agent?.status === "RUNNING" ||
        opsVal?.agent?.status === "DISCOVERING";

      set({
        event: evRes.status === "fulfilled" ? evRes.value : get().event,
        opsStatus: opsVal,
        shortlist: slRes.status === "fulfilled" ? slRes.value.items : get().shortlist,
        approvals: appRes.status === "fulfilled" ? appRes.value.items : get().approvals,
        incidents: incRes.status === "fulfilled" ? incRes.value.items : get().incidents,
        isLoading: false,
        isWaitingForSelection: !!agentWaiting,
        isAgentRunning: !!agentRunning,
        agentMessage: agentWaiting
          ? "EVENTRA has found suitable options and is waiting for your selection."
          : get().agentMessage,
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

  isCandidateSelected: (candidateId: string) => {
    const list = get().shortlist;
    const cid = String(candidateId);
    return list.some(
      (s) =>
        (s.candidate_id === cid || s.id === cid || s.provider_id === cid) &&
        s.status === "SELECTED"
    );
  },

  selectCandidate: async (candidateId: string) => {
    const eventId = get().eventId;
    if (!eventId) throw new Error("No active event ID in workspace");

    try {
      const updated = await selectShortlistCandidate(eventId, candidateId);
      // Optimistically mark entry as selected in store
      set((state) => ({
        shortlist: state.shortlist.map((s) =>
          s.candidate_id === candidateId || s.id === candidateId
            ? {
                ...s,
                status: "SELECTED",
                selection_source: "ORGANIZER_SELECTION",
                selected_by: "organizer",
                selected_at: new Date().toISOString(),
              }
            : s
        ),
      }));
      // Full refresh to synchronize assignments, tasks, and telemetry
      await get().refreshWorkspace(eventId);
      return updated;
    } catch (err) {
      console.error("[WorkspaceStore] selectCandidate error:", err);
      throw err;
    }
  },

  approveCommunication: async (candidateId: string) => {
    const eventId = get().eventId;
    if (!eventId) throw new Error("No active event ID in workspace");

    try {
      const updated = await approveShortlistCommunication(eventId, candidateId);
      await get().refreshOpsStatus(eventId);
      return updated;
    } catch (err) {
      console.error("[WorkspaceStore] approveCommunication error:", err);
      throw err;
    }
  },

  dismissCommunication: async (candidateId: string) => {
    const eventId = get().eventId;
    if (!eventId) throw new Error("No active event ID in workspace");

    try {
      const updated = await dismissShortlistCommunication(eventId, candidateId);
      await get().refreshOpsStatus(eventId);
      return updated;
    } catch (err) {
      console.error("[WorkspaceStore] dismissCommunication error:", err);
      throw err;
    }
  },

  connectSSE: (eventId: string) => {

    if (typeof window === "undefined") return;

    // Deduplicate: avoid reopening stream if already active for this event
    if (activeEventId === eventId && activeEventSource && activeEventSource.readyState !== 2) {
      return;
    }

    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    activeEventId = eventId;
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
        const normalizedType = (type || "").toLowerCase();

        // 1. Initial snapshot hydration on connect / reconnect
        if (normalizedType === "connected") {
          if (data?.snapshot) {
            get().hydrateFromSnapshot(data.snapshot);
          }
          return;
        }

        // 2. Agent state events (targeted updates without network storm)
        if (type.startsWith("agent.")) {
          if (type === "agent.started") {
            set({
              isAgentRunning: true,
              isWaitingForSelection: false,
              agentMessage: data?.message || "EVENTRA autonomous operations started",
            });
          } else if (type === "agent.progress") {
            set({
              isAgentRunning: true,
              agentMessage: data?.current_step || data?.message || "Agent operation in progress",
            });
          } else if (type === "agent.completed") {
            set({
              isAgentRunning: false,
              agentMessage: data?.message || "Operations completed",
            });
            get().refreshOpsStatus(eventId);
          } else if (type === "agent.failed") {
            set({
              isAgentRunning: false,
              isWaitingForSelection: false,
              agentMessage: data?.error || data?.message || "Agent encountered an issue.",
            });
            get().refreshOpsStatus(eventId);
          } else if (type === "agent.waiting_approval") {
            set({
              isAgentRunning: false,
              agentMessage: data?.message || "Awaiting human approval",
            });
            get().refreshApprovals(eventId);
            get().refreshOpsStatus(eventId);
          } else if (type === "agent.waiting_for_selection" || type === "agent.waiting_selection") {
            set({
              isAgentRunning: false,
              isWaitingForSelection: true,
              agentMessage: data?.message || "EVENTRA has found suitable options and is waiting for your selection.",
            });
            get().refreshShortlist(eventId);
            get().refreshOpsStatus(eventId);
          }
          return;
        }

        // 3. Discovery realtime events
        if (type.startsWith("discovery.")) {
          if (type === "discovery.started") {
            set({
              isAgentRunning: true,
              agentMessage: data?.message || `Finding suitable options for ${data?.category || 'requirements'}...`,
            });
          } else if (type === "discovery.progress") {
            set({
              isAgentRunning: true,
              agentMessage: data?.message || data?.current_step || "Evaluating candidates...",
            });
          } else if (type === "discovery.completed") {
            set({
              agentMessage: data?.message || `Discovery completed for ${data?.category || 'requirements'}.`,
            });
            get().refreshOpsStatus(eventId);
          } else if (type === "discovery.failed") {
            set({
              agentMessage: data?.error || data?.message || "Discovery encountered an issue.",
            });
            get().refreshOpsStatus(eventId);
          }
          return;
        }

        // 4. Recommendations ready (targeted shortlist and status refresh)
        if (type === "recommendations.ready") {
          get().refreshShortlist(eventId);
          get().refreshOpsStatus(eventId);
          return;
        }

        // 5. Shortlist and selection realtime events
        if (type === "shortlist.selected") {
          const candidateId = data?.candidate_id || data?.entry_id;
          if (candidateId) {
            set((state) => ({
              shortlist: state.shortlist.map((s) =>
                s.candidate_id === candidateId || s.id === candidateId || s.provider_id === candidateId
                  ? {
                      ...s,
                      status: "SELECTED",
                      selection_source: "ORGANIZER_SELECTION",
                      selected_by: data?.selected_by || "organizer",
                      selected_at: data?.selected_at || new Date().toISOString(),
                    }
                  : s
              ),
            }));
          }
          get().refreshOpsStatus(eventId);
          return;
        }

        if (type === "shortlist.updated") {
          get().refreshShortlist(eventId);
          get().refreshOpsStatus(eventId);
          return;
        }

        // 6. Communication realtime events
        if (type.startsWith("communication.") || type.startsWith("call.") || type.startsWith("message.")) {
          get().refreshOpsStatus(eventId);
          get().refreshShortlist(eventId);
          return;
        }

        // 7. Approvals, assignments, incidents
        if (type.startsWith("approval.")) {
          get().refreshApprovals(eventId);
          get().refreshOpsStatus(eventId);
        } else if (type.startsWith("assignment.")) {
          get().refreshOpsStatus(eventId);
        } else if (type.startsWith("incident.")) {
          get().refreshWorkspace(eventId);
        }
      };

      // Listen for named SSE event types
      const registeredTypes = [
        "connected",
        "CONNECTED",
        "agent.started",
        "agent.progress",
        "agent.completed",
        "agent.failed",
        "agent.waiting_approval",
        "agent.waiting_for_selection",
        "agent.waiting_selection",
        "discovery.started",
        "discovery.progress",
        "discovery.completed",
        "discovery.failed",
        "recommendations.ready",
        "shortlist.updated",
        "shortlist.selected",
        "approval.created",
        "approval.updated",
        "communication.started",
        "communication.completed",
        "communication.failed",
        "call.started",
        "call.completed",
        "call.failed",
        "message.started",
        "message.sent",
        "message.failed",
        "assignment.created",
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
    activeEventId = null;
    set({ sseConnected: false });
  },
}));
