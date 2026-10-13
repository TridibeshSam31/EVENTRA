import { describe, expect, it } from "vitest";
import { SseParser } from "@/lib/sse";

describe("SseParser", () => {
  it("parses frames split across arbitrary chunk boundaries", () => {
    const parser = new SseParser();
    expect(parser.push("id: RUN-1:1\nevent: agent.run_st")).toEqual([]);
    const frames = parser.push('arted\ndata: {"sequence":1}\n\nid: RUN-1:2\n');
    expect(frames).toEqual([{ id: "RUN-1:1", event: "agent.run_started", data: '{"sequence":1}' }]);
    expect(parser.push('event: agent.phase_changed\ndata: {"sequence":2}\n\n')).toEqual([
      { id: "RUN-1:2", event: "agent.phase_changed", data: '{"sequence":2}' },
    ]);
  });

  it("ignores keepalive comments and joins multi-line data", () => {
    const parser = new SseParser();
    const frames = parser.push(": keepalive\n\nevent: x\ndata: line1\ndata: line2\n\n");
    expect(frames).toEqual([{ event: "x", data: "line1\nline2", id: undefined }]);
  });

  it("handles CRLF line endings", () => {
    const parser = new SseParser();
    expect(parser.push("event: connected\r\ndata: {}\r\n\r\n")).toEqual([{ event: "connected", data: "{}", id: undefined }]);
  });
});
