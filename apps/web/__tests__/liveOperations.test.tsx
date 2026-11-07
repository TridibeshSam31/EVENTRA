import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not vi.fn: the spy re-reports rejected promises it records as unhandled.
const live = vi.hoisted(() => ({ impl: (_id: string): Promise<any> => Promise.resolve(null) }));
vi.mock("@/lib/api/live", () => ({ getOperationalSummary: (id: string) => live.impl(id) }));
vi.mock("@/lib/api/incidents", () => ({ getIncident: vi.fn(), listIncidents: vi.fn(), createIncident: vi.fn() }));
vi.mock("@/lib/api/recovery", () => ({
  listRecoveryOptions: vi.fn(),
  generateRecoveryOptions: vi.fn(),
  recalculateRecoveryOptions: vi.fn(),
  executeRecoveryOption: vi.fn(),
}));
vi.mock("@/lib/api/approvals", () => ({ listApprovals: vi.fn() }));
vi.mock("@/hooks/useEventWorkspace", () => ({ useEventWorkspace: () => ({ sseConnected: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { getIncident, listIncidents } from "@/lib/api/incidents";
import { listRecoveryOptions } from "@/lib/api/recovery";
import { listApprovals } from "@/lib/api/approvals";
import { LiveOperationsOverview } from "@/components/v2/LiveOperationsOverview";
import { IncidentResponseView } from "@/components/v2/IncidentResponseView";

const summary = (over: Record<string, any> = {}) => ({
  event: { id: "e1", name: "Launch", start_datetime: null, lifecycle_state: "PLANNED", state: "AT_RISK" },
  status: "CRITICAL",
  status_reasons: ["Open critical incident: Vendor Cancellation: Sharma Caterers"],
  tasks: { total: 4, completed: 1, in_progress: 0, blocked: 1, failed: 0, by_status: {} },
  vendors: [
    { vendor_id: "v1", name: "Sharma Caterers", category: "CATERING", selected: true, contact_approval: "APPROVED", whatsapp: "READ", call: "NOT_ATTEMPTED", commitment: "ASSIGNED", agreed_cost: null },
  ],
  pending_approvals: [],
  milestones: [],
  budget: { currency: "INR", total: 10000, committed: 0, pending_quotes: 0, remaining: 10000, basis: "" },
  issues: [
    {
      kind: "INCIDENT", id: "inc1", title: "Vendor Cancellation: Sharma Caterers", severity: "CRITICAL", status: "OPEN",
      evidence: "Sorry, we have to cancel", detected_at: null, consequence: "critical path affected",
      action: { label: "Review recovery options", href: "/events/e1/recovery?incidentId=inc1" },
    },
  ],
  next_action: { title: "Vendor Cancellation: Sharma Caterers", reason: "critical path affected", label: "Review recovery options", href: "/events/e1/recovery?incidentId=inc1" },
  timeline: [],
  generated_at: new Date().toISOString(),
  ...over,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("LiveOperationsOverview", () => {
  afterEach(() => cleanup());

  it("shows the real status, the evidence and the next action link", async () => {
    live.impl = () => Promise.resolve(summary());
    render(<LiveOperationsOverview eventId="e1" />);
    await flush();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText(/Sorry, we have to cancel/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /Review recovery options/ });
    expect(links[0].getAttribute("href")).toBe("/events/e1/recovery?incidentId=inc1");
  });

  it("keeps message state and booking state apart", async () => {
    live.impl = () => Promise.resolve(summary());
    render(<LiveOperationsOverview eventId="e1" />);
    await flush();
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("Assigned, not confirmed")).toBeTruthy();
    expect(screen.getByText("0 / 1")).toBeTruthy(); // vendors confirmed
  });

  it("shows an error state with retry when the first load fails", async () => {
    live.impl = () => Promise.reject(new Error("Network down"));
    render(<LiveOperationsOverview eventId="e1" />);
    await flush();
    expect(screen.getByText("Network down")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });
});

describe("IncidentResponseView", () => {
  afterEach(() => cleanup());

  it("marks an unquoted replacement cost as unknown and lists ruled-out options with reasons", async () => {
    vi.mocked(getIncident).mockResolvedValue({
      id: "inc1", title: "Vendor Cancellation: Sharma Caterers", severity: "CRITICAL", status: "OPEN", source: "INBOUND_WHATSAPP",
      detected_at: "2026-10-14T10:00:00", evidence_metadata: { signals: [{ message: "Sorry, we have to cancel" }] },
      impact_result: { schedule_impact: { delay_minutes: 60, critical_path_breached: true }, directly_affected_tasks: [{ name: "Food service" }], indirectly_affected_tasks: [] },
    } as any);
    vi.mocked(listRecoveryOptions).mockResolvedValue({
      items: [
        { id: "o1", strategy_type: "BACKUP", status: "FEASIBLE", is_feasible: true, is_stale: false, rank: 1, budget_delta: { additional_cost: 0, cost_known: false }, schedule_delta: { total_delay_change_minutes: 0 }, feasibility_result: {} },
        { id: "o2", strategy_type: "WAIT", status: "INFEASIBLE", is_feasible: false, is_stale: false, budget_delta: {}, schedule_delta: {}, feasibility_result: { violations: ["Delay exceeds the event end."] } },
      ],
    } as any);
    vi.mocked(listApprovals).mockResolvedValue({ items: [] } as any);
    render(<IncidentResponseView eventId="e1" incidentId="inc1" />);
    await flush();
    await flush();
    expect(screen.getByText(/unknown — no quote yet/)).toBeTruthy();
    expect(screen.getByText(/Delay exceeds the event end/)).toBeTruthy();
    expect(screen.getByText("Food service", { exact: false })).toBeTruthy();
  });

  it("lists problems when no incident is selected", async () => {
    vi.mocked(listIncidents).mockResolvedValue({ items: [{ id: "inc9", title: "Projector failed", severity: "HIGH", status: "OPEN", detected_at: "2026-10-14T10:00:00" }] } as any);
    render(<IncidentResponseView eventId="e1" />);
    await flush();
    expect(screen.getByText("Projector failed")).toBeTruthy();
    // Open problems link to the single Problems page with a "Respond" action.
    expect(screen.getByRole("link", { name: /Respond/ }).getAttribute("href")).toBe("/events/e1/incidents?incidentId=inc9");
  });
});
