/**
 * How EVENTRA reads an approval request — shared by the queue and the detail
 * page so a request is described the same way everywhere.
 * Everything is derived from the backend record; nothing is invented.
 */
import type { CueTone } from "@/components/ds";
import { humanizeAction, humanizeActor, humanizeCategory, isUuid, stripIds } from "@/lib/humanize";
import type { ApprovalRequestResponse } from "@/types/api";

/* ── Impact: the backend's own scale (MINOR · MODERATE · MAJOR · CRITICAL) ── */

export type ImpactKey = "critical" | "major" | "moderate" | "minor" | "unknown";

export const IMPACT: Record<ImpactKey, { tone: CueTone; label: string; bar: string }> = {
  critical: { tone: "cue", label: "Critical impact", bar: "bg-cue-600" },
  major: { tone: "standby", label: "Major impact", bar: "bg-standby-500" },
  moderate: { tone: "info", label: "Moderate impact", bar: "bg-info-400" },
  minor: { tone: "idle", label: "Minor impact", bar: "bg-ink-300" },
  unknown: { tone: "idle", label: "Impact not given", bar: "bg-ink-200" },
};

/** One mapping used by both the queue card and the decision sheet. */
export function impactOf(level?: string | null): ImpactKey {
  const l = (level || "").toUpperCase();
  if (l === "CRITICAL") return "critical";
  if (l === "MAJOR" || l === "HIGH") return "major";
  if (l === "MODERATE" || l === "MEDIUM") return "moderate";
  if (l === "MINOR" || l === "LOW") return "minor";
  return "unknown";
}

/* ── Reading a request ────────────────────────────────────── */

/* ── Money & consequences (UX v3 contract §1 — every field optional) ── */

export interface BudgetImpact {
  category: string | null;
  categoryBudget: number | null;
  committedBefore: number | null;
  committedAfter: number | null;
  totalBudget: number | null;
  overCategoryBudget: boolean;
}

export interface MoneyView {
  /** true when this decision commits or changes money */
  involvesMoney: boolean;
  amount: number | null;
  currency: string;
  budgetImpact: BudgetImpact | null;
  advanceRequired: boolean | null;
}

/** Action types that commit or change money even when the backend omits involves_money. */
const MONEY_ACTIONS = new Set([
  "CONTRACT_VENDOR",
  "PROVIDER_ENGAGEMENT",
  "ADJUST_BUDGET",
  "BUDGET_CHANGE",
  "BUDGET_INCREASE",
  "BOOKING",
  "VENDOR_ASSIGNMENT",
  "ASSIGNMENT",
]);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface DisplayApproval {
  id: string;
  actionType: string;
  groupKey: string;
  groupLabel: string;
  title: string;
  subjectName: string | null;
  category: string | null;
  channel: string | null;
  requestedBy: string;
  createdAt: string | null;
  impact: ImpactKey;
  whatHappens: string;
  why: string;
  whyIsDerived: boolean;
  money: MoneyView;
  /** "If you approve" — server sentence when provided */
  onApprove: string;
  /** "If you decline" — server sentence or null when unknown */
  onReject: string | null;
  /** false = can't be undone; null = backend didn't say */
  reversible: boolean | null;
  expiresAt: string | null;
  /** Approve-all only for non-money, same-type requests */
  canBatch: boolean;
  raw: ApprovalRequestResponse;
}

/** Sentence-start actor name ("You", "EVENTRA agent"). */
const req = (id?: string | null) => humanizeActor(id);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Verb phrase for each action type, so the title says what will actually happen. */
function verbFor(actionType: string): string {
  switch (actionType.toUpperCase()) {
    case "COMMUNICATION_OUTREACH":
      return "Contact";
    case "VENDOR_ASSIGNMENT":
    case "ASSIGNMENT":
    case "BOOKING":
      return "Book";
    case "VENUE_SELECTION":
      return "Choose venue";
    case "BUDGET_CHANGE":
    case "BUDGET_INCREASE":
      return "Change budget for";
    case "RECOVERY":
    case "RECOVERY_ACTION":
      return "Run recovery for";
    default:
      return humanizeAction(actionType);
  }
}

/** Plural group label, e.g. "Contact vendors". */
function groupLabelFor(actionType: string): string {
  switch (actionType.toUpperCase()) {
    case "COMMUNICATION_OUTREACH":
      return "Contact vendors";
    case "VENDOR_ASSIGNMENT":
    case "ASSIGNMENT":
    case "BOOKING":
      return "Bookings";
    default:
      return humanizeAction(actionType) || "Other requests";
  }
}

export function toDisplayItem(r: ApprovalRequestResponse): DisplayApproval {
  const a = (r.requested_action || {}) as Record<string, unknown>;
  // New server-computed fields (contract §1) are optional; older backends simply omit them.
  const srv = r as unknown as Record<string, unknown>;
  const actionType = r.action_type || "ACTION";
  const subjectName =
    str(srv.vendor_name) || str(a.candidate_name) || str(a.vendor_name) || str(a.provider_name) || str(a.name);
  const rawCategory =
    str(srv.category) || str(a.category) || (r.target_type && !isUuid(r.target_type) ? r.target_type : null);
  const category = rawCategory ? humanizeCategory(rawCategory) : null;
  const channel = str(srv.channel) || str(a.channel) || str(a.preferred_channel);

  // Title: server summary wins, then explicit payload title; otherwise "<verb> <who>".
  const explicitTitle = str(srv.summary) || str(a.title);
  const verb = verbFor(actionType);
  const title =
    explicitTitle ||
    (subjectName ? `${verb} ${subjectName}` : category ? `${verb} a ${category.toLowerCase()} vendor` : humanizeAction(actionType));

  // What happens: backend description wins; otherwise describe the action from the payload only.
  const explicitDesc = str(a.description) || str(a.reason) || r.decision_notes || null;
  let whatHappens: string;
  if (explicitDesc) {
    whatHappens = stripIds(explicitDesc);
  } else if (actionType.toUpperCase() === "COMMUNICATION_OUTREACH") {
    const who = subjectName || (category ? `this ${category.toLowerCase()} vendor` : "this vendor");
    const how =
      channel?.toLowerCase() === "whatsapp" ? "message" : channel?.toLowerCase() === "call" ? "call" : "message or call";
    whatHappens = `EVENTRA will ${how} ${who}${category && subjectName ? ` (${category})` : ""} to ask about availability and a quote. Nothing is booked by this step.`;
  } else {
    whatHappens = `${humanizeAction(actionType)}${category ? ` · ${category}` : ""}${subjectName ? ` · ${subjectName}` : ""}`;
  }

  // Why: the agent's own reasoning if present; otherwise a sentence built only from the payload.
  const explicitWhy = str(a.ai_context) || str(a.reasoning) || str(a.recommendation);
  const impact = impactOf(r.impact_level);
  const proposal =
    actionType.toUpperCase() === "COMMUNICATION_OUTREACH"
      ? `contacting ${category ? `this ${category.toLowerCase()} vendor` : "this vendor"}`
      : `this ${humanizeAction(actionType).toLowerCase()} step${category ? ` for ${category.toLowerCase()}` : ""}`;
  const why = explicitWhy
    ? stripIds(explicitWhy)
    : impact === "unknown"
    ? `${req(r.requester_id)} proposed ${proposal}. It waits here until you decide.`
    : `${req(r.requester_id)} proposed ${proposal}. It's rated ${IMPACT[impact].label.toLowerCase()}${
        impact === "major" || impact === "critical" ? ", so nothing is sent until you approve" : ""
      }.`;

  // Money: server fields first, then amounts the payload itself carries. Never invented.
  const amount =
    num(srv.amount) ??
    num(a.amount) ??
    num(a.cost) ??
    num(a.price) ??
    num(a.quoted_amount) ??
    num(a.proposed_cost) ??
    num(a.total);
  const currency = str(srv.currency) || str(a.currency) || "INR";
  const bi = (srv.budget_impact && typeof srv.budget_impact === "object" ? srv.budget_impact : null) as Record<
    string,
    unknown
  > | null;
  const budgetImpact: BudgetImpact | null = bi
    ? {
        category: str(bi.category),
        categoryBudget: num(bi.category_budget),
        committedBefore: num(bi.committed_before),
        committedAfter: num(bi.committed_after),
        totalBudget: num(bi.total_budget),
        overCategoryBudget: bi.over_category_budget === true,
      }
    : null;
  const involvesMoney =
    typeof srv.involves_money === "boolean"
      ? (srv.involves_money as boolean)
      : MONEY_ACTIONS.has(actionType.toUpperCase()) || amount !== null;
  const advanceRequired =
    typeof a.advance_required === "boolean" ? (a.advance_required as boolean) : null;

  const onApprove = str(srv.on_approve) || whatHappens;
  const onReject = str(srv.on_reject);
  const reversible = typeof srv.reversible === "boolean" ? (srv.reversible as boolean) : null;

  return {
    id: r.id,
    actionType,
    groupKey: actionType.toUpperCase(),
    groupLabel: groupLabelFor(actionType),
    title,
    subjectName,
    category,
    channel,
    requestedBy: humanizeActor(r.requester_id),
    createdAt: r.created_at || null,
    impact,
    whatHappens,
    why,
    whyIsDerived: !explicitWhy,
    money: { involvesMoney, amount, currency, budgetImpact, advanceRequired },
    onApprove,
    onReject,
    reversible,
    expiresAt: str(srv.expires_at) || r.expires_at || null,
    canBatch: !involvesMoney,
    raw: r,
  };
}

