import { describe, expect, it } from "vitest";
import { deriveFallbackNextStep, pageFromPath, pagePath, samePage } from "@/lib/api/guidance";

const EVENT = {
  name: "College Fest",
  location: "Delhi",
  guest_count: 1000,
  total_budget: 500000,
  start_datetime: "2026-12-12T00:00:00Z",
  lifecycle_state: "PLANNED",
};

describe("deriveFallbackNextStep", () => {
  it("asks for details when the event is missing basics and nothing was found yet", () => {
    const s = deriveFallbackNextStep({ eventId: "e1", event: { ...EVENT, guest_count: null }, shortlist: [] });
    expect(s.step_id).toBe("complete_details");
    expect(s.path).toBe("/events/e1/setup");
    expect(s.unlocked_pages).toBeNull(); // fallback never hides pages
  });

  it("suggests starting discovery when details exist but nothing was found", () => {
    const s = deriveFallbackNextStep({ eventId: "e1", event: EVENT, shortlist: [] });
    expect(s.step_id).toBe("start_discovery");
    expect(s.page).toBe("overview");
  });

  it("shows discovery running while the agent works", () => {
    const s = deriveFallbackNextStep({ eventId: "e1", event: EVENT, shortlist: [], isAgentRunning: true });
    expect(s.step_id).toBe("discovery_running");
  });

  it("asks to pick when a category has options but no pick", () => {
    const s = deriveFallbackNextStep({
      eventId: "e1",
      event: EVENT,
      shortlist: [
        { status: "RECOMMENDED", category: "CATERING" },
        { status: "RECOMMENDED", category: "DECOR" },
        { status: "SELECTED", category: "VENUE" },
      ],
    });
    expect(s.step_id).toBe("pick_vendors");
    expect(s.count).toBe(2);
  });

  it("puts pending approvals ahead of picks", () => {
    const s = deriveFallbackNextStep({
      eventId: "e1",
      event: EVENT,
      shortlist: [{ status: "RECOMMENDED", category: "CATERING" }],
      approvals: [{ status: "PENDING" }, { status: "APPROVED" }, { status: "PENDING" }],
    });
    expect(s.step_id).toBe("approve_requests");
    expect(s.count).toBe(2);
    expect(s.path).toBe("/events/e1/approvals");
  });

  it("puts an open problem first, critical when severe", () => {
    const s = deriveFallbackNextStep({
      eventId: "e1",
      event: EVENT,
      approvals: [{ status: "PENDING" }],
      incidents: [{ status: "OPEN", severity: "CRITICAL", title: "Caterer cancelled" }, { status: "RESOLVED" }],
    });
    expect(s.step_id).toBe("resolve_problem");
    expect(s.urgency).toBe("critical");
    expect(s.title).toBe("Caterer cancelled");
    expect(s.page).toBe("problems");
  });

  it("points to replies once picked vendors were contacted", () => {
    const s = deriveFallbackNextStep({
      eventId: "e1",
      event: EVENT,
      shortlist: [{ status: "SELECTED", category: "CATERING", candidate_data: { communication: { whatsapp_status: "SENT" } } }],
    });
    expect(s.step_id).toBe("awaiting_replies");
  });

  it("falls through to the plan otherwise", () => {
    const s = deriveFallbackNextStep({ eventId: "e1", event: EVENT, shortlist: [{ status: "SELECTED", category: "CATERING" }] });
    expect(s.step_id).toBe("fix_plan_blockers");
  });
});

describe("guide routing helpers", () => {
  it("maps pages to routes and back", () => {
    expect(pagePath("e1", "decisions")).toBe("/events/e1/approvals");
    expect(pagePath("e1", "problems")).toBe("/events/e1/incidents");
    expect(pagePath("e1", "overview")).toBe("/events/e1");
    expect(pageFromPath("/events/e1/approvals")).toBe("decisions");
    expect(pageFromPath("/events/e1/recovery")).toBe("problems");
    expect(pageFromPath("/events/e1")).toBe("overview");
    expect(pageFromPath("/dashboard")).toBeNull();
  });

  it("compares paths ignoring query and trailing slash", () => {
    expect(samePage("/events/e1/vendors?category=CATERING", "/events/e1/vendors/")).toBe(true);
    expect(samePage("/events/e1/vendors", "/events/e1/plan")).toBe(false);
  });
});
