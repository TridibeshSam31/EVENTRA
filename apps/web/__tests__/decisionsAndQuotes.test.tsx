import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

import { toDisplayItem } from "@/features/approvals/describe";
import { quoteState } from "@/components/v2/QuoteBoard";
import type { ApprovalRequestResponse } from "@/types/api";
import type { QuoteItem } from "@/lib/api/quotes";

vi.mock("@/lib/api/shortlist", () => ({
  getCandidateCommunication: vi.fn(() => new Promise(() => {})),
  draftWhatsAppFollowup: vi.fn(),
  sendWhatsAppFollowup: vi.fn(),
}));
import { ContactResultPanel } from "@/components/v2/ContactResultPanel";

const base = (over: Partial<ApprovalRequestResponse> & Record<string, unknown> = {}) =>
  ({
    id: "a1",
    event_id: "e1",
    requester_id: "default-operator",
    action_type: "COMMUNICATION_OUTREACH",
    target_type: "TRANSPORT",
    target_id: "t1",
    impact_level: "MAJOR",
    requested_action: { candidate_name: "Car-Van-Bus Rental" },
    status: "PENDING",
    created_at: "2026-11-07T10:00:00Z",
    ...over,
  }) as unknown as ApprovalRequestResponse;

describe("approval money & consequences", () => {
  it("outreach is not a money decision and can be batch-approved", () => {
    const v = toDisplayItem(base());
    expect(v.money.involvesMoney).toBe(false);
    expect(v.money.amount).toBeNull();
    expect(v.canBatch).toBe(true);
  });

  it("uses server summary, amount, budget impact and consequences when present", () => {
    const v = toDisplayItem(
      base({
        action_type: "CONTRACT_VENDOR",
        summary: "Book Royal Feast for catering",
        involves_money: true,
        amount: 85000,
        currency: "INR",
        budget_impact: { category: "CATERING", category_budget: 80000, committed_before: 0, committed_after: 85000, over_category_budget: true },
        on_approve: "EVENTRA confirms the booking.",
        on_reject: "Royal Feast is not booked.",
        reversible: false,
      })
    );
    expect(v.title).toBe("Book Royal Feast for catering");
    expect(v.money.amount).toBe(85000);
    expect(v.money.budgetImpact?.overCategoryBudget).toBe(true);
    expect(v.onApprove).toBe("EVENTRA confirms the booking.");
    expect(v.onReject).toBe("Royal Feast is not booked.");
    expect(v.reversible).toBe(false);
    expect(v.canBatch).toBe(false);
  });

  it("flags money actions with no amount instead of inventing one", () => {
    const v = toDisplayItem(base({ action_type: "CONTRACT_VENDOR" }));
    expect(v.money.involvesMoney).toBe(true);
    expect(v.money.amount).toBeNull();
    expect(v.canBatch).toBe(false);
  });
});

const q = (over: Partial<QuoteItem>): QuoteItem => ({
  assignment_id: "x",
  vendor_id: null,
  vendor_name: "V",
  category: "CATERING",
  status: "ASSIGNED",
  quoted_amount: null,
  currency: "INR",
  available: null,
  coverage_start: null,
  coverage_end: null,
  advance_required: null,
  summary: null,
  quoted_at: null,
  cap: null,
  within_cap: null,
  negotiation_round: null,
  previous_amount: null,
  ...over,
});

describe("quote states", () => {
  it("maps backend status and quote presence to one state", () => {
    expect(quoteState(q({ status: "DISCOVERED" }))).toBe("not_requested");
    expect(quoteState(q({ status: "ENGAGED" }))).toBe("requested");
    expect(quoteState(q({ status: "ENGAGED", quoted_amount: 50000 }))).toBe("quoted");
    expect(quoteState(q({ status: "AWAITING_APPROVAL", quoted_amount: 50000 }))).toBe("awaiting_approval");
    expect(quoteState(q({ status: "APPROVED" }))).toBe("approved");
    expect(quoteState(q({ status: "CONFIRMED" }))).toBe("booked");
    expect(quoteState(q({ status: "NO_RESPONSE" }))).toBe("no_reply");
  });
});

describe("ContactResultPanel reply states", () => {
  const comm = (extra: Record<string, unknown>) => ({
    contact_name: "Test",
    overall_status: "CONTACTED",
    channels: {
      whatsapp: { status: "SENT", attempt_count: 1, retryable: true, ...extra },
      call: { status: "NOT_ATTEMPTED", attempt_count: 0, retryable: false },
    },
  });

  it("shows a no-reply banner with a resend action", () => {
    render(
      <ContactResultPanel
        eventId="e1"
        candidateId="c1"
        communication={comm({ no_reply: true, awaiting_reply_since: new Date(Date.now() - 7 * 3600000).toISOString() })}
        onRetry={vi.fn()}
      />
    );
    const banner = screen.getByTestId("no-reply");
    expect(within(banner).getByText("No reply for 7 h")).toBeTruthy();
    expect(within(banner).getByText("Send WhatsApp again")).toBeTruthy();
  });

  it("marks an unclear reply as needing to be read, next to the original words", () => {
    render(
      <ContactResultPanel
        eventId="e1"
        candidateId="c1"
        communication={comm({
          status: "REPLIED",
          replies: [{ id: "r1", text: "dekhte hain", t: 1 }],
          reply_analysis: { decision: "UNCLEAR" },
        })}
        onRetry={vi.fn()}
      />
    );
    const reply = screen.getByTestId("whatsapp-reply");
    expect(within(reply).getByText("Unclear — read their reply")).toBeTruthy();
    expect(within(reply).getByText(/dekhte hain/)).toBeTruthy();
  });
});
