/**
 * Fetch-based Server-Sent Events reader.
 *
 * Used instead of `EventSource` because EVENTRA authenticates every request
 * with request headers (x-user-id), which `EventSource` cannot send.
 */

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental SSE parser: feed decoded text chunks, receive complete frames.
 * Comment lines (`:` keepalives) are ignored; multi-line `data:` is joined.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
      boundary = this.buffer.indexOf("\n\n");
    }
    return frames;
  }
}

function parseBlock(block: string): SseFrame | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0 && !id) return null;
  return { event, data: data.join("\n"), id };
}

export interface OpenSseOptions {
  url: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onFrame: (frame: SseFrame) => void;
  onOpen?: () => void;
}

/**
 * Opens an authenticated SSE connection and dispatches frames until the
 * server closes the stream (resolves) or the request fails (rejects).
 */
export async function openSseStream({ url, headers, signal, onFrame, onOpen }: OpenSseOptions): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/event-stream", ...headers },
    signal,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const error = new Error(`SSE connection failed with status ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  onOpen?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      onFrame(frame);
    }
  }
}
