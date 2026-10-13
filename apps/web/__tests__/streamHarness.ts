import { vi } from "vitest";
import type { OpenSseOptions } from "@/lib/sse";
import type { AgentRunEvent } from "@/lib/api/agentRuns";

export interface FakeConnection {
  opts: OpenSseOptions;
  /** Delivers a run event exactly as the backend SSE endpoint frames it. */
  send: (ev: AgentRunEvent) => void;
  /** Server closes the stream. */
  end: () => void;
  /** Request fails (e.g. network drop or HTTP error). */
  fail: (status?: number) => void;
}

/** Controllable stand-in for `openSseStream` that records each connection. */
export function createStreamHarness() {
  const connections: FakeConnection[] = [];
  const openSseStream = vi.fn(
    (opts: OpenSseOptions) =>
      new Promise<void>((resolve, reject) => {
        opts.signal.addEventListener("abort", () => resolve());
        opts.onOpen?.();
        connections.push({
          opts,
          send: (ev) => opts.onFrame({ event: ev.type, data: JSON.stringify(ev), id: ev.id }),
          end: () => resolve(),
          fail: (status) => reject(Object.assign(new Error(`HTTP ${status ?? "network"}`), { status })),
        });
      })
  );
  return { connections, openSseStream };
}
