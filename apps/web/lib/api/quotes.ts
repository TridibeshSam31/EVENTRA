/**
 * Quote comparison — UX v3 contract §4 (`GET /events/{id}/quotes`).
 *
 * Until the backend ships that route, this falls back to the existing vendor
 * assignments endpoint and maps the same fields (quoted_amount, coverage,
 * advance_required, cap). Fields the fallback can't know (summary, previous
 * amount, quoted_at) stay null — never guessed.
 */
import { apiRequest, ApiError } from "./client";
import { getAssignmentsForEvent } from "./vendors";
import type { VendorAssignmentResponse } from "@/types/api";

export interface QuoteItem {
  assignment_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  category: string;
  status: string;
  quoted_amount: number | null;
  currency: string;
  available: boolean | null;
  coverage_start: string | null;
  coverage_end: string | null;
  advance_required: boolean | null;
  summary: string | null;
  quoted_at: string | null;
  cap: number | null;
  within_cap: boolean | null;
  negotiation_round: number | null;
  previous_amount: number | null;
  /** only known via the assignments fallback */
  approval_id?: string | null;
  is_simulation?: boolean;
}

export interface QuoteCategorySummary {
  count: number;
  lowest: number | null;
  category_budget: number | null;
}

export interface QuotesResponse {
  items: QuoteItem[];
  by_category: Record<string, QuoteCategorySummary>;
  /** "quotes" = new endpoint, "assignments" = fallback */
  source: "quotes" | "assignments";
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function fromAssignment(a: VendorAssignmentResponse): QuoteItem {
  const quoted = num(a.quoted_amount);
  const cap = num(a.max_approved_amount);
  const round = num(a.negotiation_round);
  const extra = a as unknown as Record<string, unknown>;
  return {
    assignment_id: a.id,
    vendor_id: a.vendor_id ?? null,
    vendor_name: a.vendor?.name ?? null,
    category: a.category,
    status: (a.negotiation_status || a.status || "").toUpperCase(),
    quoted_amount: quoted,
    currency: a.currency || "INR",
    available: typeof extra.provider_available === "boolean" ? (extra.provider_available as boolean) : null,
    coverage_start: a.coverage_start ?? null,
    coverage_end: a.coverage_end ?? null,
    advance_required: typeof a.advance_required === "boolean" ? a.advance_required : null,
    summary: null,
    quoted_at: null,
    cap,
    within_cap: quoted !== null && cap !== null ? quoted <= cap : null,
    negotiation_round: round,
    previous_amount: null,
    approval_id: a.approval_id ?? null,
    is_simulation: a.is_simulation,
  };
}

function summarize(items: QuoteItem[]): Record<string, QuoteCategorySummary> {
  const out: Record<string, QuoteCategorySummary> = {};
  for (const it of items) {
    const s = (out[it.category] ??= { count: 0, lowest: null, category_budget: null });
    s.count += 1;
    if (it.quoted_amount !== null) s.lowest = s.lowest === null ? it.quoted_amount : Math.min(s.lowest, it.quoted_amount);
  }
  return out;
}

export async function getEventQuotes(eventId: string, category?: string): Promise<QuotesResponse> {
  try {
    const res = await apiRequest<{ items?: Partial<QuoteItem>[]; by_category?: Record<string, QuoteCategorySummary> }>(
      `/events/${eventId}/quotes`,
      { params: { category } }
    );
    const items: QuoteItem[] = (res.items || []).map((q) => ({
      assignment_id: String(q.assignment_id),
      vendor_id: q.vendor_id ?? null,
      vendor_name: q.vendor_name ?? null,
      category: String(q.category || "OTHER"),
      status: String(q.status || "").toUpperCase(),
      quoted_amount: num(q.quoted_amount),
      currency: q.currency || "INR",
      available: typeof q.available === "boolean" ? q.available : null,
      coverage_start: q.coverage_start ?? null,
      coverage_end: q.coverage_end ?? null,
      advance_required: typeof q.advance_required === "boolean" ? q.advance_required : null,
      summary: q.summary ?? null,
      quoted_at: q.quoted_at ?? null,
      cap: num(q.cap),
      within_cap: typeof q.within_cap === "boolean" ? q.within_cap : null,
      negotiation_round: num(q.negotiation_round),
      previous_amount: num(q.previous_amount),
      approval_id: (q as { approval_id?: string | null }).approval_id ?? null,
    }));
    return { items, by_category: res.by_category || summarize(items), source: "quotes" };
  } catch (err) {
    // Route not deployed yet → same data from assignments. Other errors propagate.
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      const assignments = await getAssignmentsForEvent(eventId);
      const items = (assignments || [])
        .map(fromAssignment)
        .filter((q) => !category || q.category.toUpperCase() === category.toUpperCase());
      return { items, by_category: summarize(items), source: "assignments" };
    }
    throw err;
  }
}
