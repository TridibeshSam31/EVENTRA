import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/shortlist", () => ({
  getCandidateCommunication: vi.fn(),
  draftWhatsAppFollowup: vi.fn(),
  sendWhatsAppFollowup: vi.fn(),
}));

import { draftWhatsAppFollowup, getCandidateCommunication, sendWhatsAppFollowup } from "@/lib/api/shortlist";
import { ContactResultPanel, needsPolling, summaryFromCommunication } from "@/components/v2/ContactResultPanel";

const channel = (status: string, extra: Record<string, any> = {}) => ({
  status,
  attempt_count: 1,
  retryable: ["FAILED", "UNAVAILABLE", "BUSY", "NO_ANSWER", "CANCELED"].includes(status),
  error: null,
  ...extra,
});

const persisted = (whatsapp: any, call: any, overall: string) => ({
  approval_status: "APPROVED",
  overall_status: overall,
  contact_name: "Test Contact",
  phone: "+91******0001",
  whatsapp_status: whatsapp.status,
  call_status: call.status,
  channels: { whatsapp, call },
});

describe("ContactResultPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getCandidateCommunication).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("restores persisted per-channel state after a refresh and shows the contact", () => {
    const comm = persisted(channel("DELIVERED"), channel("COMPLETED", { duration_seconds: 42, ai_voice: true }), "CONTACTED");
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={comm} onRetry={vi.fn()} />);

    expect(screen.getByText("Test Contact")).toBeTruthy();
    expect(screen.getByText(/\+91\*\*\*\*\*\*0001/)).toBeTruthy();
    expect(within(screen.getByTestId("channel-whatsapp")).getByText("Delivered")).toBeTruthy();
    expect(within(screen.getByTestId("channel-call")).getByText("Call ended")).toBeTruthy();
    expect(screen.getByText("Duration 42s")).toBeTruthy();
    expect(screen.getByText("AI phone call")).toBeTruthy();
  });

  it("never upgrades provider state: an accepted message is not shown as delivered and a queued call not as answered", () => {
    const comm = persisted(channel("ACCEPTED"), channel("QUEUED"), "CONTACTED");
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={comm} onRetry={vi.fn()} />);

    const wa = screen.getByTestId("channel-whatsapp");
    expect(within(wa).getByText("Accepted by WhatsApp")).toBeTruthy();
    expect(within(wa).queryByText("Delivered")).toBeNull();
    expect(within(screen.getByTestId("channel-call")).getByText("Queued")).toBeTruthy();
  });

  it("shows partial failure with the provider error and retries only the failed channel", async () => {
    const comm = persisted(
      channel("ACCEPTED"),
      channel("FAILED", { error: "Twilio rejected the call: unverified number" }),
      "PARTIAL",
    );
    const onRetry = vi.fn().mockResolvedValue({});
    vi.mocked(getCandidateCommunication).mockResolvedValue(
      summaryFromCommunication(persisted(channel("ACCEPTED"), channel("QUEUED"), "CONTACTED")),
    );
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={comm} onRetry={onRetry} />);

    expect(screen.getByText("Partially contacted")).toBeTruthy();
    expect(screen.getByText("Twilio rejected the call: unverified number")).toBeTruthy();
    expect(screen.queryByText("Retry WhatsApp")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Retry call"));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("call");
    expect(within(screen.getByTestId("channel-call")).getByText("Queued")).toBeTruthy();
  });

  it("disables retry while a retry is in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    const onRetry = vi.fn(() => new Promise((r) => (resolve = r)));
    const comm = persisted(channel("FAILED", { error: "Session disconnected" }), channel("NO_ANSWER"), "FAILED");
    vi.mocked(getCandidateCommunication).mockResolvedValue(summaryFromCommunication(comm));
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={comm} onRetry={onRetry} />);

    fireEvent.click(screen.getByText("Retry WhatsApp"));
    const callRetry = screen.getByText("Retry call").closest("button") as HTMLButtonElement;
    expect(callRetry.disabled).toBe(true);
    fireEvent.click(callRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => resolve({}));
  });

  it("shows the recorded call outcome as a quote, not a booking", () => {
    const call = channel("COMPLETED", {
      conversation_outcome: { outcome: "AVAILABLE", available: true, estimated_price: "25,000 INR" },
      transcript: [{ speaker: "AGENT", text: "Hi, I am an AI assistant." }],
    });
    render(
      <ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(channel("READ"), call, "CONTACTED")} onRetry={vi.fn()} />,
    );
    const outcome = screen.getByTestId("call-outcome");
    expect(within(outcome).getByText(/25,000 INR/)).toBeTruthy();
    expect(within(outcome).getByText(/not a booking or agreement/)).toBeTruthy();
    expect(screen.getByText("Call transcript (1 turns)")).toBeTruthy();
  });

  it("polls for provider updates only while a channel is still in flight", async () => {
    vi.mocked(getCandidateCommunication).mockResolvedValue(
      summaryFromCommunication(persisted(channel("REPLIED"), channel("COMPLETED"), "CONTACTED")),
    );
    render(
      <ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(channel("ACCEPTED"), channel("RINGING"), "CONTACTED")} onRetry={vi.fn()} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getCandidateCommunication).toHaveBeenCalledWith("e1", "c1", true);
    expect(within(screen.getByTestId("channel-call")).getByText("Call ended")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    // One live load on mount, plus exactly one provider refresh while the call was in flight.
    expect(vi.mocked(getCandidateCommunication).mock.calls.filter((c) => c[2] === true)).toHaveLength(1);
  });

  it("shows the negotiation rounds and whether the price landed within budget", () => {
    const call = channel("COMPLETED", {
      conversation_outcome: { outcome: "AVAILABLE", final_price: "22,500 INR", language: "Hinglish" },
      negotiation: {
        final_decision: "WITHIN_BUDGET",
        rounds: [
          { vendor_price: 40000, counter_offer: 20000, decision: "COUNTER" },
          { vendor_price: 22500, decision: "WITHIN_BUDGET" },
        ],
      },
    });
    render(
      <ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(channel("READ"), call, "CONTACTED")} onRetry={vi.fn()} />,
    );
    const neg = screen.getByTestId("call-negotiation");
    expect(within(neg).getByText("Within budget")).toBeTruthy();
    expect(within(neg).getByText(/Vendor asked 40,000/)).toBeTruthy();
    expect(within(neg).getByText(/AI countered 20,000/)).toBeTruthy();
    expect(screen.getByText("Language: Hinglish")).toBeTruthy();
  });

  it("falls back to legacy flat statuses for records created before per-channel tracking", () => {
    const summary = summaryFromCommunication({ whatsapp_status: "SENT", call_status: "FAILED", call_error: "x", overall_status: "PARTIAL" });
    expect(summary.whatsapp.status).toBe("SENT");
    expect(summary.call.error).toBe("x");
    expect(summary.call.retryable).toBe(false);
    expect(needsPolling(summary)).toBe(true);
  });

  it("shows a final call result instead of a pending counter-offer, and offers to call again", async () => {
    const call = channel("COMPLETED", {
      retryable: false,
      can_call_again: true,
      verdict: { code: "NO_AGREEMENT", label: "No agreement", detail: "Vendor quoted 50,000 and did not accept the counter-offer of 900." },
      negotiation: { final_decision: "COUNTER", rounds: [{ vendor_price: 50000, counter_offer: 900, decision: "COUNTER" }] },
      history: [{ status: "COMPLETED", verdict: { code: "ENDED", label: "Call ended", detail: "" }, transcript: [{ speaker: "VENDOR", text: "Hello" }] }],
    });
    const onRetry = vi.fn().mockResolvedValue({});
    vi.mocked(getCandidateCommunication).mockResolvedValue(summaryFromCommunication(persisted(channel("REPLIED"), call, "CONTACTED")));
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(channel("REPLIED"), call, "CONTACTED")} onRetry={onRetry} />);

    expect(within(screen.getByTestId("call-verdict")).getByText(/No agreement/)).toBeTruthy();
    expect(screen.queryByText("Counter-offer pending")).toBeNull();
    expect(screen.getByText("Previous calls (1)")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Call again"));
    });
    expect(onRetry).toHaveBeenCalledWith("call");
  });

  it("shows the vendor's WhatsApp reply and what it means", () => {
    const wa = channel("REPLIED", {
      replies: [{ id: "r1", text: "Haan ji, 30 hazaar lagega" }],
      reply_analysis: { decision: "YES", quoted_price: 30000, summary: "Available, asks 30,000", next_step: "Price is above target. Suggested counter-offer: 20000.", method: "AI" },
    });
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(wa, channel("NOT_ATTEMPTED"), "PARTIAL")} onRetry={vi.fn()} />);
    const reply = screen.getByTestId("whatsapp-reply");
    expect(within(reply).getByText("Said yes")).toBeTruthy();
    expect(within(reply).getByText(/Haan ji, 30 hazaar lagega/)).toBeTruthy();
    expect(within(reply).getByText(/Suggested counter-offer: 20000/)).toBeTruthy();
    expect(within(screen.getByTestId("channel-whatsapp")).getByText("Vendor replied")).toBeTruthy();
  });

  it("drafts a reply for review and sends it only on an explicit click", async () => {
    const wa = channel("REPLIED", { can_follow_up: true, replies: [{ id: "r1", text: "yes available", t: 1 }] });
    vi.mocked(draftWhatsAppFollowup).mockResolvedValue({ text: "Thank you! Could you share your price?", goal: "ask price", method: "AI" });
    const after = summaryFromCommunication(
      persisted({ ...wa, followups: [{ text: "Thank you! Could you share your price? (edited)", message_id: "m2", t: 2 }] }, channel("NOT_ATTEMPTED"), "PARTIAL"),
    );
    vi.mocked(sendWhatsAppFollowup).mockResolvedValue(after);
    vi.mocked(getCandidateCommunication).mockResolvedValue(after);
    render(<ContactResultPanel eventId="e1" candidateId="c1" communication={persisted(wa, channel("NOT_ATTEMPTED"), "PARTIAL")} onRetry={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Suggest reply"));
    });
    const box = screen.getByLabelText("WhatsApp reply") as HTMLTextAreaElement;
    expect(box.value).toBe("Thank you! Could you share your price?");
    expect(sendWhatsAppFollowup).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "Thank you! Could you share your price? (edited)" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Send on WhatsApp"));
    });
    expect(sendWhatsAppFollowup).toHaveBeenCalledWith("e1", "c1", "Thank you! Could you share your price? (edited)");
    expect(within(screen.getByTestId("whatsapp-reply")).getByText(/\(edited\)/)).toBeTruthy();
  });
});
