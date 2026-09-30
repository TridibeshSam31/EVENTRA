import { apiClient } from "./client";

export interface EventMemberItem {
  id: string;
  event_id: string;
  user_id: string;
  name: string;
  email: string;
  role: "main_organizer" | "event_manager" | "collaborator" | "vendor" | "viewer" | string;
  avatar?: string;
  status: "active" | "invited" | "offline";
  lastActive?: string;
  permissions: {
    canApproveCritical: boolean;
    canEditTasks: boolean;
    canManageBudget: boolean;
    canTriggerAgentCalls: boolean;
  };
}

const DEFAULT_MEMBERS: EventMemberItem[] = [
  {
    id: "mem-1",
    event_id: "conference_demo",
    user_id: "user-organizer",
    name: "Alex Thorne (You)",
    email: "commander@eventra.ops",
    role: "main_organizer",
    status: "active",
    lastActive: "Just now",
    permissions: {
      canApproveCritical: true,
      canEditTasks: true,
      canManageBudget: true,
      canTriggerAgentCalls: true,
    },
  },
  {
    id: "mem-2",
    event_id: "conference_demo",
    user_id: "user-ops-lead",
    name: "Sarah Chen",
    email: "sarah.ops@eventra.ops",
    role: "event_manager",
    status: "active",
    lastActive: "4 mins ago",
    permissions: {
      canApproveCritical: false,
      canEditTasks: true,
      canManageBudget: false,
      canTriggerAgentCalls: true,
    },
  },
  {
    id: "mem-3",
    event_id: "conference_demo",
    user_id: "user-collab-1",
    name: "Marcus Vance",
    email: "marcus.floor@apexevents.com",
    role: "collaborator",
    status: "active",
    lastActive: "18 mins ago",
    permissions: {
      canApproveCritical: false,
      canEditTasks: true,
      canManageBudget: false,
      canTriggerAgentCalls: false,
    },
  },
  {
    id: "mem-4",
    event_id: "conference_demo",
    user_id: "user-vendor-av",
    name: "Apex Sound & Visual (Lead)",
    email: "dispatch@apexav.io",
    role: "vendor",
    status: "active",
    lastActive: "1 hour ago",
    permissions: {
      canApproveCritical: false,
      canEditTasks: false,
      canManageBudget: false,
      canTriggerAgentCalls: false,
    },
  },
];

export async function listCollaborators(eventId: string): Promise<EventMemberItem[]> {
  try {
    const raw = await apiClient.get<any[]>(`/events/${eventId}/members`);
    if (raw && raw.length > 0) {
      return raw.map((m: any, idx: number) => ({
        id: m.id || `mem-${idx}`,
        event_id: eventId,
        user_id: m.user_id || `user-${idx}`,
        name: m.name || m.user_name || (m.role === "main_organizer" ? "Alex Thorne (Lead)" : `Operator ${idx + 1}`),
        email: m.email || m.user_email || `${m.role || "operator"}@eventra.ops`,
        role: (m.role || "collaborator").toLowerCase(),
        status: "active",
        lastActive: "Active recently",
        permissions: {
          canApproveCritical: m.role?.toLowerCase() === "main_organizer",
          canEditTasks: ["main_organizer", "event_manager", "collaborator"].includes(m.role?.toLowerCase()),
          canManageBudget: m.role?.toLowerCase() === "main_organizer",
          canTriggerAgentCalls: ["main_organizer", "event_manager"].includes(m.role?.toLowerCase()),
        },
      }));
    }
    return DEFAULT_MEMBERS;
  } catch {
    return DEFAULT_MEMBERS;
  }
}

export async function addCollaborator(
  eventId: string,
  payload: { user_id: string; role: string; email?: string; name?: string }
): Promise<EventMemberItem> {
  try {
    const res = await apiClient.post<any>(`/events/${eventId}/members`, payload);
    return {
      id: res.id || `mem-${Date.now()}`,
      event_id: eventId,
      user_id: payload.user_id,
      name: payload.name || payload.email?.split("@")[0] || "New Operative",
      email: payload.email || "collaborator@eventra.ops",
      role: payload.role,
      status: "active",
      lastActive: "Just added",
      permissions: {
        canApproveCritical: payload.role === "main_organizer",
        canEditTasks: ["main_organizer", "event_manager", "collaborator"].includes(payload.role),
        canManageBudget: payload.role === "main_organizer",
        canTriggerAgentCalls: ["main_organizer", "event_manager"].includes(payload.role),
      },
    };
  } catch {
    // Return optimistic response if running locally without backend persistence
    return {
      id: `mem-${Date.now()}`,
      event_id: eventId,
      user_id: payload.user_id,
      name: payload.name || payload.email?.split("@")[0] || "New Operative",
      email: payload.email || "collaborator@eventra.ops",
      role: payload.role,
      status: "active",
      lastActive: "Just added",
      permissions: {
        canApproveCritical: payload.role === "main_organizer",
        canEditTasks: ["main_organizer", "event_manager", "collaborator"].includes(payload.role),
        canManageBudget: payload.role === "main_organizer",
        canTriggerAgentCalls: ["main_organizer", "event_manager"].includes(payload.role),
      },
    };
  }
}

export async function updateCollaboratorRole(
  eventId: string,
  memberId: string,
  role: string
): Promise<any> {
  try {
    return await apiClient.patch(`/events/${eventId}/members/${memberId}`, { role });
  } catch {
    return { id: memberId, role };
  }
}

export async function removeCollaborator(eventId: string, memberId: string): Promise<void> {
  try {
    await apiClient.delete(`/events/${eventId}/members/${memberId}`);
  } catch {
    // Optimistic fallback
  }
}
