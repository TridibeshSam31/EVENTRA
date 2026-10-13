import { describe, expect, it } from "vitest";
import { deriveRunView, isExecuting, lifecycleOf } from "@/lib/agentRun/view";
import { decideAutoNav, navTargetForEvent } from "@/lib/agentRun/navigation";
import { EVENT_ID, discoveryRunEvents, makeEvent, makeRun } from "./fixtures";

describe("deriveRunView", () => {
  it("builds venue and provider progress from real backend events", () => {
    const view = deriveRunView(makeRun("WAITING_FOR_USER_SELECTION"), discoveryRunEvents());

    expect(view.venue.status).toBe("completed");
    expect(view.venue.location).toBe("Delhi");
    expect(view.venue.candidates.map((c) => c.name)).toEqual(["Grand Hall"]);

    expect(view.providers).toHaveLength(1);
    const catering = view.providers[0];
    expect(catering.status).toBe("completed");
    expect(catering.counts).toMatchObject({ qualified: 1, pending_verification: 1, rejected: 1 });
    expect(catering.candidates.map((c) => c.qualification)).toEqual(["qualified", "pending_verification"]);
    expect(catering.milestones).toHaveLength(1);
  });

  it("never reports a run awaiting selection or approval as a completed success", () => {
    const selection = deriveRunView(makeRun("WAITING_FOR_USER_SELECTION"), discoveryRunEvents());
    expect(selection.lifecycle).toBe("awaiting_selection");

    const approval = deriveRunView(makeRun("PENDING_APPROVAL"), [
      makeEvent(1, "agent.run_started"),
      makeEvent(2, "approval.required", { approval_id: "apr-1", action: "execute_action" }),
    ]);
    expect(approval.lifecycle).toBe("awaiting_approval");
    expect(approval.approval?.approvalId).toBe("apr-1");
    expect(isExecuting(approval.lifecycle)).toBe(false);
  });

  it("reports empty results distinctly from failures", () => {
    const view = deriveRunView(makeRun(), [
      makeEvent(1, "agent.run_started"),
      makeEvent(2, "venue.discovery_started", { location: "Delhi" }),
      makeEvent(3, "venue.results_updated", { status: "EMPTY", total: 0, candidates: [] }),
      makeEvent(4, "provider.discovery_started", { category: "AV_TECH", location: "Delhi" }),
    ]);
    expect(view.venue.status).toBe("empty");
    expect(view.providers[0].status).toBe("searching");
    expect(view.lifecycle).toBe("running");
  });

  it("marks unfinished discoveries as failed when the run fails, with the error", () => {
    const view = deriveRunView(makeRun("FAILED"), [
      makeEvent(1, "agent.run_started"),
      makeEvent(2, "provider.discovery_started", { category: "CATERING" }),
      makeEvent(3, "agent.tool_completed", { tool: "agentic_provider_discovery", category: "CATERING", status: "FAILED", error: "scraper down" }),
      makeEvent(4, "agent.run_failed", { status: "FAILED", error: "scraper down" }),
    ]);
    expect(view.lifecycle).toBe("failed");
    expect(view.error).toBe("scraper down");
    expect(view.providers[0].status).toBe("failed");
    expect(view.providers[0].error).toBe("scraper down");
  });

  it("falls back to the persisted run status when no lifecycle events exist", () => {
    expect(lifecycleOf(makeRun("DISCOVERING"), [])).toBe("running");
    expect(lifecycleOf(makeRun("CANCELLED"), [])).toBe("cancelled");
    expect(lifecycleOf(null, [])).toBe("idle");
  });

  it("tracks communication status updates per provider", () => {
    const view = deriveRunView(makeRun("WAITING_FOR_USER_SELECTION"), [
      ...discoveryRunEvents(),
      makeEvent(12, "communication.started", { candidate_id: "c1", candidate_name: "Spice Caterers", assignment_id: "asg-1" }),
      makeEvent(13, "communication.status_changed", { candidate_id: "c1", assignment_id: "asg-1", channel: "CALL", status: "FAILED", detail: "No phone number" }),
    ]);
    expect(view.communications).toHaveLength(1);
    expect(view.communications[0].assignmentId).toBe("asg-1");
    expect(view.communications[0].updates.map((u) => u.status)).toEqual(["STARTED", "FAILED"]);
  });
});

describe("auto-navigation rules", () => {
  it("maps workflow events to existing pages", () => {
    expect(navTargetForEvent(EVENT_ID, makeEvent(1, "venue.discovery_started"))?.path).toBe(`/events/${EVENT_ID}/venue`);
    expect(navTargetForEvent(EVENT_ID, makeEvent(2, "provider.discovery_started"))?.path).toBe(`/events/${EVENT_ID}/vendors`);
    expect(navTargetForEvent(EVENT_ID, makeEvent(3, "communication.started", { assignment_id: "a1" }))?.path).toBe(
      `/events/${EVENT_ID}/negotiations/a1`
    );
    expect(navTargetForEvent(EVENT_ID, makeEvent(4, "approval.required", { approval_id: "p1" }))?.path).toBe(
      `/events/${EVENT_ID}/approvals/p1`
    );
    expect(navTargetForEvent(EVENT_ID, makeEvent(5, "selection.required"))).toBeNull();
    expect(navTargetForEvent(EVENT_ID, makeEvent(6, "agent.tool_started"))).toBeNull();
  });

  const venue = { path: "/events/e/venue", label: "Venue" };
  const vendors = { path: "/events/e/vendors", label: "Vendors" };

  it("navigates on the first live target", () => {
    expect(decideAutoNav({ enabled: true, suppressed: false, currentPath: "/events/e", lastAutoNavPath: null, target: venue })).toEqual({
      action: "navigate",
      suppressed: false,
    });
  });

  it("stops overriding once the user navigates away from the agent's page", () => {
    const decision = decideAutoNav({
      enabled: true,
      suppressed: false,
      currentPath: "/events/e/budget",
      lastAutoNavPath: venue.path,
      target: vendors,
    });
    expect(decision).toEqual({ action: "suggest", suppressed: true });
  });

  it("does nothing when already on the target page, and only suggests when disabled", () => {
    expect(decideAutoNav({ enabled: true, suppressed: false, currentPath: vendors.path, lastAutoNavPath: vendors.path, target: vendors }).action).toBe("none");
    expect(decideAutoNav({ enabled: false, suppressed: false, currentPath: "/events/e", lastAutoNavPath: null, target: venue }).action).toBe("suggest");
  });
});
