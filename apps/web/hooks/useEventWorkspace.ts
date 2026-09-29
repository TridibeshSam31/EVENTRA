"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export function useEventWorkspace(eventId?: string) {
  const store = useWorkspaceStore();

  useEffect(() => {
    if (eventId) {
      store.setEventId(eventId);
    }
  }, [eventId]);

  return {
    eventId: store.eventId,
    event: store.event,
    opsStatus: store.opsStatus,
    shortlist: store.shortlist,
    approvals: store.approvals,
    incidents: store.incidents,
    isLoading: store.isLoading,
    sseConnected: store.sseConnected,
    isAgentRunning: store.isAgentRunning,
    isWaitingForSelection: store.isWaitingForSelection,
    agentMessage: store.agentMessage,

    refreshWorkspace: store.refreshWorkspace,
    refreshShortlist: store.refreshShortlist,
    refreshApprovals: store.refreshApprovals,
    refreshOpsStatus: store.refreshOpsStatus,
    toggleShortlist: store.toggleShortlist,
    selectCandidate: store.selectCandidate,
    approveCommunication: store.approveCommunication,
    dismissCommunication: store.dismissCommunication,
    isShortlisted: store.isShortlisted,
    isCandidateSelected: store.isCandidateSelected,
  };
}

