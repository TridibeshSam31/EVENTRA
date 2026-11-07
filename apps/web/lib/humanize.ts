/**
 * Turn machine output (codes, IDs, raw JSON, timestamps) into words people read.
 * Never invents information: it only rephrases what it is given, and returns
 * null/"" when there is nothing meaningful to show.
 */

const ACRONYMS = new Set(["AV", "DJ", "ID", "OK", "PA", "SMS", "API", "LLM", "INR", "USD", "ETA", "VIP"]);

/** "COMMUNICATION_OUTREACH" → "Communication outreach"; leaves normal sentences alone. */
export function humanizeCode(code?: string | null, fallback = ""): string {
  if (!code) return fallback;
  const text = String(code).trim();
  if (!/^[A-Za-z0-9]+([_\-. ][A-Za-z0-9]+)*$/.test(text) || (/[a-z]/.test(text) && !text.includes("_"))) {
    return text; // already human (has lowercase and no underscores)
  }
  const words = text.split(/[_\-. ]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** Category codes: "AV_TECH" → "AV & tech", "CATERING" → "Catering". */
const CATEGORY_NAMES: Record<string, string> = {
  AV: "AV",
  AV_TECH: "AV & tech",
  AUDIO_VISUAL: "Audio-visual",
  DECOR: "Décor",
  DECORATION: "Decoration",
  PHOTOGRAPHY: "Photography",
  CATERING: "Catering",
  TRANSPORT: "Transport",
  SECURITY: "Security",
  LIGHTING: "Lighting",
  MUSIC: "Music",
  VENUE: "Venue",
  INTERNET: "Internet",
  STAGE: "Stage",
  LOGISTICS: "Logistics",
  EQUIPMENT: "Equipment",
};

export function humanizeCategory(category?: string | null): string {
  if (!category) return "";
  const key = String(category).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return CATEGORY_NAMES[key] ?? humanizeCode(category);
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function isUuid(value?: string | null): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** "30dbd1b8-677d-…" → "30dbd1b8". Use only where an ID must stay visible. */
export function shortId(id?: string | null): string {
  if (!id) return "";
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** Remove UUIDs (and the brackets around them) from free text. */
export function stripIds(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/\s*\(\s*[0-9a-f-]{36}\s*\)/gi, "")
    .replace(UUID_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Operator / actor ids → a name people recognise. */
export function humanizeActor(actor?: string | null): string {
  if (!actor) return "Someone";
  const a = actor.trim();
  const map: Record<string, string> = {
    "default-operator": "You",
    default_operator: "You",
    anonymous_operator: "You",
    system: "EVENTRA",
    SYSTEM: "EVENTRA",
    agent: "EVENTRA agent",
    AGENT: "EVENTRA agent",
  };
  return map[a] ?? humanizeCode(a);
}

/** Money with currency symbol; null when amount is missing. */
export function formatMoney(amount?: number | string | null, currency = "INR"): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

/** "3 minutes ago", "yesterday", or a short date. */
export function timeAgo(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Clock time, or null if the value is missing / midnight placeholder is meaningless. */
export function clockTime(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Structured facts the agent extracted from a provider reply → one sentence.
 * e.g. {available:false, quoted_price:10000, currency:"INR"} → "Unavailable · quoted ₹10,000"
 */
export function describeFacts(facts: unknown, currency = "INR"): string {
  let obj: Record<string, unknown> | null = null;
  if (typeof facts === "string") {
    try {
      obj = JSON.parse(facts);
    } catch {
      return facts;
    }
  } else if (facts && typeof facts === "object") {
    obj = facts as Record<string, unknown>;
  }
  if (!obj) return "";
  const parts: string[] = [];
  if (typeof obj.available === "boolean") parts.push(obj.available ? "Available" : "Unavailable");
  const price = obj.quoted_price ?? obj.quoted_amount ?? obj.price ?? obj.quote ?? obj.amount;
  const money = formatMoney(price as number, (obj.currency as string) || currency);
  if (money) parts.push(`quoted ${money}`);
  const cap = obj.capacity ?? obj.guest_capacity;
  if (cap !== undefined && cap !== null && cap !== "") parts.push(`capacity ${cap}`);
  const eta = obj.eta_minutes ?? obj.arrival_minutes;
  if (eta !== undefined && eta !== null && eta !== "") parts.push(`${eta} min away`);
  const notes = obj.notes ?? obj.summary;
  if (typeof notes === "string" && notes.trim()) parts.push(notes.trim());
  return parts.join(" · ");
}

/** Activity / audit action codes → readable phrase. */
const ACTION_PHRASES: Record<string, string> = {
  INBOUND_MESSAGE_RECEIVED: "Reply received",
  OUTBOUND_MESSAGE_DISPATCHED: "Message sent",
  COMMUNICATION_OUTREACH: "Contact a vendor",
  APPROVAL_REQUESTED: "Approval requested",
  APPROVAL_GRANTED: "Approved",
  APPROVAL_REJECTED: "Declined",
  ASSIGNMENT_CREATED: "Booking proposed",
  CANDIDATE_SELECTED: "Vendor picked",
  DISCOVERY_COMPLETED: "Discovery finished",
  DISCOVERY_STARTED: "Discovery started",
  INCIDENT_CREATED: "Problem reported",
  RECOVERY_EXECUTED: "Recovery carried out",
};

export function humanizeAction(code?: string | null): string {
  if (!code) return "";
  const key = String(code).toUpperCase();
  return ACTION_PHRASES[key] ?? humanizeCode(code);
}
