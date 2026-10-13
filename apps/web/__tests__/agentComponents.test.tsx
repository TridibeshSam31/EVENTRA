import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EVENT_ID, RUN_ID, discoveryRunEvents, makeEvent, makeRun } from "./fixtures";
import { createStreamHarness } from "./streamHarness";

const harness = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import("./streamHarness").createStreamHarness> }));
const nav = vi.hoisted(() => ({ pathname: "/events/evt-1", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => nav.pathname,
}));
vi.mock("@/lib/api/discoveryRuns", () => ({ startOperations: vi.fn() }));
vi.mock("@/lib/api/agentRuns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agentRuns")>()),
  getCurrentAgentRun: vi.fn(),
  cancelAgentRun: vi.fn(),
}));
vi.mock("@/lib/sse", () => ({
  openSseStream: (opts: any) => harness.current!.openSseStream(opts),
}));
vi.mock("@/lib/api/browserCompanion", () => ({
  browserCompanionApi: { getStatus: vi.fn().mockResolvedValue({ connected: false }) },
}));
vi.mock("@/components/browser/CompanionPairingModal", () => ({ CompanionPairingModal: () => null }));

import { startOperations } from "@/lib/api/discoveryRuns";
import { getCurrentAgentRun } from "@/lib/api/agentRuns";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { AgentPanel } from "@/components/v2/AgentPanel";
import { AgentRunStatusPanel } from "@/components/agent/AgentRunStatusPanel";
import { AgentDiscoveryLive } from "@/components/agent/AgentDiscoveryLive";

const initialState = useAgentRunStore.getState();

beforeEach(() => {
  harness.current = createStreamHarness();
  useAgentRunStore.setState(initialState, true);
  nav.pathname = `/events/${EVENT_ID}`;
  nav.push.mockReset();
  vi.mocked(startOperations).mockReset();
  vi.mocked(getCurrentAgentRun).mockReset();
});

afterEach(() => {
  cleanup();
  useAgentRunStore.getState().disconnect();
});

function renderAgentPanel() {
  return render(<AgentPanel eventId={EVENT_ID} eventName="Summit" lifecycleState="LIVE" />);
}

describe("Agent button", () => {
  it("triggers the real backend run exactly once and shows live status without a refresh", async () => {
    let resolveStart!: (v: { status: string; run_id: string; message: string }) => void;
    vi.mocked(startOperations).mockImplementation(() => new Promise((r) => (resolveStart = r)));
    vi.mocked(getCurrentAgentRun).mockResolvedValue({
      run: makeRun("RUNNING"),
      events: [makeEvent(1, "agent.run_started")],
      last_sequence: 1,
    });

    renderAgentPanel();
    const button = screen.getByRole("button", { name: /Dispatch Autonomous Sourcing/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolveStart({ status: "STARTED", run_id: RUN_ID, message: "ok" }));

    expect(startOperations).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Dispatch Autonomous Sourcing/i })).toBeNull();

    act(() => {
      harness.current!.connections[0].send(
        makeEvent(2, "agent.phase_changed", { phase: "VENUE_DISCOVERY", label: "Discovering venues in Delhi" })
      );
    });
    expect(screen.getAllByText("Discovering venues in Delhi").length).toBeGreaterThan(0);
  });

  it("shows a backend start failure instead of a fake running state", async () => {
    vi.mocked(startOperations).mockRejectedValue(new Error("Event is not allowed to go LIVE"));
    renderAgentPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Dispatch Autonomous Sourcing/i }));
    });
    expect(screen.getByText("Event is not allowed to go LIVE")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dispatch Autonomous Sourcing/i })).toBeTruthy();
  });
});

describe("Global agent status panel", () => {
  async function mountWithRunningRun() {
    vi.mocked(getCurrentAgentRun).mockResolvedValue({
      run: makeRun("RUNNING"),
      events: [makeEvent(1, "agent.run_started")],
      last_sequence: 1,
    });
    const utils = render(<AgentRunStatusPanel eventId={EVENT_ID} />);
    await act(async () => {});
    return utils;
  }

  it("auto-navigates to the venue page when live venue discovery starts", async () => {
    await mountWithRunningRun();
    act(() => {
      harness.current!.connections[0].send(makeEvent(2, "venue.discovery_started", { location: "Delhi" }));
    });
    expect(nav.push).toHaveBeenCalledWith(`/events/${EVENT_ID}/venue`);
  });

  it("does not override a manual navigation choice, offering a link instead", async () => {
    const { rerender } = await mountWithRunningRun();
    act(() => {
      harness.current!.connections[0].send(makeEvent(2, "venue.discovery_started", { location: "Delhi" }));
    });
    expect(nav.push).toHaveBeenCalledTimes(1);

    // The user navigates elsewhere on purpose.
    nav.pathname = `/events/${EVENT_ID}/budget`;
    rerender(<AgentRunStatusPanel eventId={EVENT_ID} />);

    act(() => {
      harness.current!.connections[0].send(makeEvent(3, "provider.discovery_started", { category: "CATERING" }));
    });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Agent is on: Provider discovery/)).toBeTruthy();
  });

  it("restores an awaiting-selection run after refresh and labels it as not completed", async () => {
    vi.mocked(getCurrentAgentRun).mockResolvedValue({
      run: makeRun("WAITING_FOR_USER_SELECTION"),
      events: discoveryRunEvents(),
      last_sequence: 11,
    });
    render(<AgentRunStatusPanel eventId={EVENT_ID} />);
    await act(async () => {});

    expect(nav.push).not.toHaveBeenCalled();
    const pill = screen.getByRole("button", { name: /Agent status/ });
    expect(pill.textContent).toContain("Awaiting your selection");
    expect(pill.textContent).not.toMatch(/completed/i);
  });
});

describe("Live discovery views", () => {
  function seed(events = discoveryRunEvents(), status = "WAITING_FOR_USER_SELECTION") {
    useAgentRunStore.setState({ eventId: EVENT_ID, run: makeRun(status), events, lastSequence: events.length });
  }

  it("shows real venue attributes, their source, and marks missing data as unavailable", () => {
    seed();
    render(<AgentDiscoveryLive eventId={EVENT_ID} kind="VENUE" />);
    expect(screen.getByText("Grand Hall")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getAllByText("Not available").length).toBeGreaterThanOrEqual(2); // hourly rate, phone
    expect(screen.getByText(/Eventra Venue Catalog/)).toBeTruthy();
  });

  it("distinguishes qualified, pending-verification and rejected providers", () => {
    seed();
    render(<AgentDiscoveryLive eventId={EVENT_ID} kind="PROVIDER" />);
    const qualifiedRow = screen.getByText("Spice Caterers").closest("li")!;
    const unverifiedRow = screen.getByText("Unverified Kitchen").closest("li")!;
    expect(qualifiedRow.textContent).toContain("Qualified");
    expect(qualifiedRow.textContent).toContain("Rating: 4.2");
    expect(unverifiedRow.textContent).toContain("Pending verification");
    expect(unverifiedRow.textContent).toContain("Rating: not reported");
    // Funnel counts come straight from the backend, including rejected candidates.
    const rejectedCount = screen.getByText("Rejected").closest("div")!;
    expect(rejectedCount.textContent).toBe("Rejected1");
    expect(screen.getByText(/Rejected candidates are counted/)).toBeTruthy();
  });

  it("shows an in-progress state while the backend is still searching", () => {
    seed(discoveryRunEvents().slice(0, 3), "DISCOVERING");
    render(<AgentDiscoveryLive eventId={EVENT_ID} kind="VENUE" />);
    expect(screen.getByRole("status").textContent).toMatch(/searching venues/i);
  });

  it("shows empty and failed states accurately", () => {
    seed(
      [
        makeEvent(1, "agent.run_started"),
        makeEvent(2, "venue.discovery_started", { location: "Delhi" }),
        makeEvent(3, "venue.results_updated", { status: "EMPTY", total: 0, candidates: [] }),
        makeEvent(4, "provider.discovery_started", { category: "AV_TECH", location: "Delhi" }),
        makeEvent(5, "agent.run_failed", { status: "FAILED", error: "scraper down" }),
      ],
      "FAILED"
    );
    render(
      <>
        <AgentDiscoveryLive eventId={EVENT_ID} kind="VENUE" />
        <AgentDiscoveryLive eventId={EVENT_ID} kind="PROVIDER" />
      </>
    );
    expect(screen.getByText("No suitable venues were found for this query.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Av Tech discovery did not finish/);
  });

  it("renders nothing for another event or when the run has no such workflow", () => {
    useAgentRunStore.setState({ eventId: "evt-other", run: makeRun(), events: discoveryRunEvents(), lastSequence: 11 });
    const { container } = render(<AgentDiscoveryLive eventId={EVENT_ID} kind="VENUE" />);
    expect(container.innerHTML).toBe("");
  });
});
