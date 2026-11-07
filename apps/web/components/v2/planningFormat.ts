/**
 * Plain-language formatting for the planning views (plan, critical path,
 * run of show, tasks, budget). Builds on lib/humanize — rephrases backend
 * values, never invents them.
 */
import { humanizeCategory, humanizeCode } from "@/lib/humanize";
import type { ExecutionPlanTask } from "@/types/api";

/** 90 → "1 h 30 min", 45 → "45 min". */
export function fmtDuration(min?: number | null): string {
  if (min == null || !Number.isFinite(Number(min))) return "—";
  const m = Math.round(Number(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Slack in words: 0 → "No slack", 20 → "20 min slack". */
export function fmtSlack(min?: number | null): string | null {
  if (min == null || !Number.isFinite(Number(min))) return null;
  const m = Math.round(Number(min));
  return m <= 0 ? "No slack" : `${fmtDuration(m)} slack`;
}

/** Clock time for a planned timestamp, or null — never "--:--". */
export function clockOrNull(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** True when an ISO timestamp is exactly local midnight (a date-only value). */
export function isMidnight(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getHours() === 0 && d.getMinutes() === 0;
}

export type StatusTone = "go" | "standby" | "cue" | "ink" | "agent";

/** Backend task / readiness statuses → label + tone. */
export function taskStatus(status?: string | null): { label: string; tone: StatusTone } {
  const s = String(status || "").toUpperCase();
  switch (s) {
    case "COMPLETED":
    case "DONE":
      return { label: "Done", tone: "go" };
    case "IN_PROGRESS":
    case "RUNNING":
      return { label: "In progress", tone: "go" };
    case "READY":
      return { label: "Ready", tone: "ink" };
    case "BLOCKED":
      return { label: "Blocked", tone: "cue" };
    case "PENDING":
    case "PLANNED":
      return { label: "Pending", tone: "standby" };
    case "":
      return { label: "Unknown", tone: "ink" };
    default:
      return { label: humanizeCode(s), tone: "ink" };
  }
}

export const STATUS_CHIP: Record<StatusTone, string> = {
  go: "border-go-200 bg-go-50 text-go-700",
  standby: "border-standby-200 bg-standby-50 text-standby-800",
  cue: "border-cue-200 bg-cue-50 text-cue-700",
  ink: "border-ink-200 bg-ink-100/70 text-ink-700",
  agent: "border-agent-200 bg-agent-50 text-agent-700",
};

/**
 * Work out which provider category a blocker/warning is about.
 * Prefers the task's own category; falls back to a "(category)" hint in the
 * backend message, e.g. "Task 'X' (venue) is on the critical path…".
 */
export function categoryForIssue(
  issue: { task_id?: string | null; message?: string | null },
  tasksById: Map<string, ExecutionPlanTask>
): string | null {
  const task = issue.task_id ? tasksById.get(issue.task_id) : undefined;
  const fromTask = task?.required_provider_category || task?.assigned_provider_category || null;
  if (fromTask) return String(fromTask).toUpperCase();
  const msg = issue.message || "";
  const paren = msg.match(/\)?\s\(([a-z_ &-]{2,30})\)\s/i) || msg.match(/'\s*\(([a-z_ &-]{2,30})\)/i);
  if (paren?.[1]) return paren[1].trim().toUpperCase().replace(/[\s&-]+/g, "_");
  const req = msg.match(/requires an? ([a-z_ ]{2,30}?) provider/i);
  if (req?.[1]) return req[1].trim().toUpperCase().replace(/\s+/g, "_");
  return null;
}

/** Task name quoted in a backend message: "Task 'Venue Access' (venue) …" → "Venue Access". */
export function taskNameFromMessage(message?: string | null): string | null {
  const m = (message || "").match(/'([^']{2,120})'/);
  return m ? m[1] : null;
}

/** Where to go to fix a missing vendor for a category. */
export function findVendorHref(eventId: string, category: string | null): string {
  if (!category) return `/events/${eventId}/vendors`;
  if (category === "VENUE") return `/events/${eventId}/venue`;
  return `/events/${eventId}/vendors?category=${encodeURIComponent(category)}`;
}

export function categoryLabel(category: string | null): string {
  return category ? humanizeCategory(category) : "Other";
}
