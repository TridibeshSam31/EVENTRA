import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_ID, RUN_ID, makeEvent, makeRun } from "./fixtures";
import { createStreamHarness } from "./streamHarness";

const harness = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import("./streamHarness").createStreamHarness> }));

vi.mock("@/lib/api/discoveryRuns", () => ({ startOperations: vi.fn() }));
vi.mock("@/lib/api/agentRuns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agentRuns")>()),
  getCurrentAgentRun: vi.fn(),
  cancelAgentRun: vi.fn(),
}));
vi.mock("@/lib/sse", () => ({
  openSseStream: (opts: any) => harness.current!.openSseStream(opts),
}));

import { startOperations } from "@/lib/api/discoveryRuns";
import { getCurrentAgentRun } from "@/lib/api/agentRuns";
import { useAgentRunStore } from "@/stores/agentRunStore";

const initialState = useAgentRunStore.getState();
const store = () => useAgentRunStore.getState();

beforeEach(() => {
  harness.current = createStreamHarness();
  useAgentRunStore.setState(initialState, true);
  vi.mocked(startOperations).mockReset();
  vi.mocked(getCurrentAgentRun).mockReset();
});

afterEach(() => {
  store().disconnect();
  vi.useRealTimers();
});

function snapshot(status: string, events = [makeEvent(1, "agent.run_started")]) {
  return { run: makeRun(status), events, last_sequence: events.length ? events[events.length - 1].sequence : 0 };
}

describe("agent run store", () => {
  it("starts the backend run exactly once for rapid repeated clicks", async () => {
    vi.mocked(startOperations).mockResolvedValue({ status: "STARTED", run_id: RUN_ID, message: "ok" });
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));

    await Promise.all([store().startRun(EVENT_ID), store().startRun(EVENT_ID)]);
    // A run is now executing: further clicks must not start another.
    await store().startRun(EVENT_ID);

    expect(startOperations).toHaveBeenCalledTimes(1);
    expect(store().run?.run_id).toBe(RUN_ID);
  });

  it("applies live stream events without a refresh, ignoring duplicates and other runs", async () => {
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));
    await store().hydrate(EVENT_ID);
    const conn = harness.current!.connections[0];
    expect(store().connection).toBe("live");

    conn.send(makeEvent(2, "agent.phase_changed", { phase: "VENUE_DISCOVERY", label: "Discovering venues in Delhi" }));
    conn.send(makeEvent(2, "agent.phase_changed", { phase: "DUPLICATE" }));
    conn.send(makeEvent(3, "agent.phase_changed", { phase: "OTHER" }, "RUN-OTHER"));

    expect(store().events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(store().events[1].data.label).toBe("Discovering venues in Delhi");
  });

  it("restores history on refresh without navigating, then navigates on live events", async () => {
    vi.mocked(getCurrentAgentRun).mockResolvedValue(
      snapshot("DISCOVERING", [makeEvent(1, "agent.run_started"), makeEvent(2, "venue.discovery_started", { location: "Delhi" })])
    );
    await store().hydrate(EVENT_ID);
    expect(store().events).toHaveLength(2);
    expect(store().pendingNav).toBeNull();

    harness.current!.connections[0].send(makeEvent(3, "provider.discovery_started", { category: "CATERING" }));
    expect(store().pendingNav?.path).toBe(`/events/${EVENT_ID}/vendors`);
    expect(store().resolvePendingNav(`/events/${EVENT_ID}`)).toBe(`/events/${EVENT_ID}/vendors`);
  });

  it("does not override the user's navigation after they leave the agent's page", async () => {
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));
    await store().hydrate(EVENT_ID);
    const conn = harness.current!.connections[0];

    conn.send(makeEvent(2, "venue.discovery_started", { location: "Delhi" }));
    expect(store().resolvePendingNav(`/events/${EVENT_ID}`)).toBe(`/events/${EVENT_ID}/venue`);

    // The user deliberately opens the budget page; the agent moves on to providers.
    conn.send(makeEvent(3, "provider.discovery_started", { category: "CATERING" }));
    expect(store().resolvePendingNav(`/events/${EVENT_ID}/budget`)).toBeNull();
    expect(store().suggestion?.path).toBe(`/events/${EVENT_ID}/vendors`);
    expect(store().navSuppressed).toBe(true);
  });

  it("treats events recorded before the client attached to its own new run as live", async () => {
    vi.mocked(startOperations).mockResolvedValue({ status: "STARTED", run_id: RUN_ID, message: "ok" });
    vi.mocked(getCurrentAgentRun).mockResolvedValue(
      snapshot("DISCOVERING", [makeEvent(1, "agent.run_started"), makeEvent(2, "venue.discovery_started", { location: "Delhi" })])
    );
    await store().startRun(EVENT_ID);
    expect(store().pendingNav?.path).toBe(`/events/${EVENT_ID}/venue`);
  });

  it("restores an already-running run silently when the start request is a duplicate", async () => {
    vi.mocked(startOperations).mockResolvedValue({ status: "ALREADY_RUNNING", run_id: RUN_ID, message: "busy" });
    vi.mocked(getCurrentAgentRun).mockResolvedValue(
      snapshot("DISCOVERING", [makeEvent(1, "agent.run_started"), makeEvent(2, "venue.discovery_started", { location: "Delhi" })])
    );
    await store().startRun(EVENT_ID);
    expect(store().pendingNav).toBeNull();
    expect(store().events).toHaveLength(2);
  });

  it("reconnects after a dropped connection, resuming from the last sequence", async () => {
    vi.useFakeTimers();
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));
    await store().hydrate(EVENT_ID);
    const first = harness.current!.connections[0];
    first.send(makeEvent(2, "agent.phase_changed", { phase: "VENUE_DISCOVERY" }));

    first.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(store().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);

    expect(harness.current!.connections).toHaveLength(2);
    expect(harness.current!.connections[1].opts.headers?.["Last-Event-ID"]).toBe(`${RUN_ID}:2`);
    expect(store().connection).toBe("live");
  });

  it("stops streaming after a terminal event instead of reconnecting", async () => {
    vi.useFakeTimers();
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));
    await store().hydrate(EVENT_ID);
    const conn = harness.current!.connections[0];
    conn.send(makeEvent(2, "agent.run_failed", { status: "FAILED", error: "scraper down" }));
    conn.end();
    await vi.advanceTimersByTimeAsync(20000);

    expect(harness.current!.connections).toHaveLength(1);
    expect(store().connection).toBe("closed");
  });

  it("does not open a stream for a run that already finished", async () => {
    vi.mocked(getCurrentAgentRun).mockResolvedValue(
      snapshot("CANCELLED", [makeEvent(1, "agent.run_started"), makeEvent(2, "agent.run_cancelled")])
    );
    await store().hydrate(EVENT_ID);
    expect(harness.current!.connections).toHaveLength(0);
    expect(store().connection).toBe("closed");
  });

  it("does not retry a stream the user is not authorized to read", async () => {
    vi.useFakeTimers();
    vi.mocked(getCurrentAgentRun).mockResolvedValue(snapshot("RUNNING"));
    await store().hydrate(EVENT_ID);
    harness.current!.connections[0].fail(403);
    await vi.advanceTimersByTimeAsync(20000);

    expect(harness.current!.connections).toHaveLength(1);
    expect(store().connection).toBe("closed");
  });
});
