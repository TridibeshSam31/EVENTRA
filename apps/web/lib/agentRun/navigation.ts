/**
 * Auto-navigation rules for live agent progress.
 *
 * - Only live events (received from the stream, not restored history) request navigation.
 * - Once the user leaves the page the agent last navigated to, auto-navigation is
 *   suppressed for the rest of the run and offered as a suggestion instead.
 */
import type { AgentRunEvent } from "@/lib/api/agentRuns";

export interface NavTarget {
  path: string;
  label: string;
}

export function navTargetForEvent(eventId: string, ev: AgentRunEvent): NavTarget | null {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "venue.discovery_started":
      return { path: `/events/${eventId}/venue`, label: "Venue discovery" };
    case "provider.discovery_started":
      return { path: `/events/${eventId}/vendors`, label: "Provider discovery" };
    case "communication.started":
      return d.assignment_id
        ? { path: `/events/${eventId}/negotiations/${d.assignment_id}`, label: "Negotiation" }
        : { path: `/events/${eventId}/conversations`, label: "Communication" };
    case "approval.required":
      return d.approval_id
        ? { path: `/events/${eventId}/approvals/${d.approval_id}`, label: "Approval required" }
        : { path: `/events/${eventId}/approvals`, label: "Approval required" };
    default:
      return null;
  }
}

export interface AutoNavInput {
  enabled: boolean;
  suppressed: boolean;
  currentPath: string | null;
  lastAutoNavPath: string | null;
  target: NavTarget;
}

export interface AutoNavDecision {
  action: "navigate" | "suggest" | "none";
  suppressed: boolean;
}

export function decideAutoNav({ enabled, suppressed, currentPath, lastAutoNavPath, target }: AutoNavInput): AutoNavDecision {
  const userMovedAway = lastAutoNavPath !== null && currentPath !== lastAutoNavPath;
  const nowSuppressed = suppressed || userMovedAway;
  if (currentPath === target.path) return { action: "none", suppressed: nowSuppressed };
  if (!enabled || nowSuppressed) return { action: "suggest", suppressed: nowSuppressed };
  return { action: "navigate", suppressed: nowSuppressed };
}
