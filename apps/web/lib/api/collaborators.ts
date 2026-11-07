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

// The members API (EventMemberResponse) returns only id, event_id, user_id, role and
// timestamps — no names, emails or presence. We show exactly that and never invent
// people, contact details or "active recently" status. Errors propagate to the caller.

const ROLE_PERMISSIONS = (role: string) => ({
  canApproveCritical: role === "main_organizer",
  canEditTasks: ["main_organizer", "event_manager", "collaborator"].includes(role),
  canManageBudget: role === "main_organizer",
  canTriggerAgentCalls: ["main_organizer", "event_manager"].includes(role),
});

function toMember(eventId: string, m: any): EventMemberItem {
  const role = String(m?.role || "collaborator").toLowerCase();
  const userId = String(m?.user_id || "");
  return {
    id: String(m?.id || ""),
    event_id: m?.event_id || eventId,
    user_id: userId,
    // Prefer a real name if the backend ever sends one; otherwise the user id itself.
    name: m?.name || m?.user_name || userId || "Unknown member",
    email: m?.email || m?.user_email || "",
    role,
    status: "active",
    lastActive: m?.updated_at || m?.created_at || undefined,
    permissions: ROLE_PERMISSIONS(role),
  };
}

/** Throws on failure so the page can show "Couldn't load your team" instead of fake people. */
export async function listCollaborators(eventId: string): Promise<EventMemberItem[]> {
  const raw = await apiClient.get<any[]>(`/events/${eventId}/members`);
  return Array.isArray(raw) ? raw.map((m) => toMember(eventId, m)) : [];
}

/** Throws on failure — never reports success for a member that wasn't saved. */
export async function addCollaborator(
  eventId: string,
  payload: { user_id: string; role: string; email?: string; name?: string }
): Promise<EventMemberItem> {
  const res = await apiClient.post<any>(`/events/${eventId}/members`, {
    user_id: payload.user_id,
    role: payload.role,
  });
  return toMember(eventId, res);
}

/** Throws on failure. */
export async function updateCollaboratorRole(eventId: string, memberId: string, role: string): Promise<any> {
  return apiClient.patch(`/events/${eventId}/members/${memberId}`, { role });
}

/** Throws on failure. */
export async function removeCollaborator(eventId: string, memberId: string): Promise<void> {
  await apiClient.delete(`/events/${eventId}/members/${memberId}`);
}
