"use client";

import React, { useEffect, useRef, useState } from "react";
import { Clock, HelpCircle, Loader2, MessageSquare, Phone, RotateCcw, Send, Sparkles } from "lucide-react";

import {
  draftWhatsAppFollowup,
  getCandidateCommunication,
  sendWhatsAppFollowup,
  type CandidateCommunicationSummary,
  type ChannelCommunicationState,
  type CommunicationChannel,
} from "@/lib/api/shortlist";

type Tone = "ok" | "progress" | "warn" | "fail" | "idle";

// Labels mirror exactly what each provider reported; nothing is upgraded in the UI.
const WHATSAPP_LABELS: Record<string, [string, Tone]> = {
  NOT_ATTEMPTED: ["Not sent", "idle"],
  SENDING: ["Sending…", "progress"],
  ACCEPTED: ["Accepted by WhatsApp", "progress"],
  SENT: ["Sent", "ok"],
  DELIVERED: ["Delivered", "ok"],
  READ: ["Read", "ok"],
  REPLIED: ["Vendor replied", "ok"],
  FAILED: ["Failed", "fail"],
  UNAVAILABLE: ["Not configured", "warn"],
};

const CALL_LABELS: Record<string, [string, Tone]> = {
  NOT_ATTEMPTED: ["Not called", "idle"],
  INITIATING: ["Placing call…", "progress"],
  QUEUED: ["Queued", "progress"],
  INITIATED: ["Dialing", "progress"],
  RINGING: ["Ringing", "progress"],
  IN_PROGRESS: ["Answered · AI speaking", "progress"],
  COMPLETED: ["Call ended", "ok"],
  NO_CONVERSATION: ["Ended before AI spoke", "fail"],
  BUSY: ["Busy", "fail"],
  NO_ANSWER: ["No answer", "fail"],
  FAILED: ["Failed", "fail"],
  CANCELED: ["Cancelled", "fail"],
  UNAVAILABLE: ["Not configured", "warn"],
};

const OVERALL_LABELS: Record<string, [string, Tone]> = {
  CONTACTED: ["Contacted", "ok"],
  PARTIAL: ["Partially contacted", "warn"],
  PROCESSING: ["In progress", "progress"],
  FAILED: ["Failed", "fail"],
  UNAVAILABLE: ["Not configured", "warn"],
  EXPIRED: ["Request expired", "warn"],
};

const NEGOTIATION_LABELS: Record<string, [string, string]> = {
  WITHIN_BUDGET: ["Within budget", "text-emerald-700"],
  COUNTER: ["Counter-offer pending", "text-amber-700"],
  ABOVE_BUDGET: ["Above budget", "text-rose-600"],
};

const VERDICT_TONES: Record<string, Tone> = {
  AGREED: "ok",
  AVAILABLE: "ok",
  YES: "ok",
  NO_AGREEMENT: "warn",
  OVER_BUDGET: "warn",
  MAYBE: "warn",
  QUESTION: "warn",
  DECLINED: "fail",
  NO: "fail",
};

const REPLY_LABELS: Record<string, [string, Tone]> = {
  YES: ["Said yes", "ok"],
  NO: ["Said no", "fail"],
  MAYBE: ["Undecided — read their reply", "warn"],
  QUESTION: ["Asked a question", "warn"],
  UNCLEAR: ["Unclear — read their reply", "warn"],
};

/** Decisions the user must judge by reading the original words. */
const NEEDS_READING = new Set(["MAYBE", "UNCLEAR", "QUESTION"]);

/** No-reply fields (UX v3 contract §6) may sit on the summary or on the WhatsApp channel. */
function noReplyInfo(summary: CandidateCommunicationSummary): { noReply: boolean; since: string | null; due: string | null } {
  const top = summary as unknown as Record<string, unknown>;
  const wa = summary.whatsapp as unknown as Record<string, unknown>;
  const pick = (k: string) => (top[k] ?? wa[k]) as unknown;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { noReply: pick("no_reply") === true, since: str(pick("awaiting_reply_since")), due: str(pick("follow_up_due_at")) };
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 3600000));
}

const TONE_CLASSES: Record<Tone, string> = {
  ok: "text-emerald-700",
  progress: "text-blue-600",
  warn: "text-amber-700",
  fail: "text-rose-600",
  idle: "text-slate-400",
};

const BADGE_CLASSES: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  progress: "bg-blue-50 text-blue-700 border-blue-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  fail: "bg-rose-50 text-rose-700 border-rose-200",
  idle: "bg-slate-100 text-slate-600 border-slate-200",
};

const CALL_ACTIVE = new Set(["INITIATING", "QUEUED", "INITIATED", "RINGING", "IN_PROGRESS"]);
// Delivered/read messages are still polled (within the poll window) to pick up the vendor's reply.
const WHATSAPP_AWAITING_RECEIPT = new Set(["SENDING", "ACCEPTED", "SENT", "DELIVERED", "READ"]);
const POLL_INTERVAL_MS = 5000;
const POLL_WINDOW_MS = 10 * 60 * 1000;

/** Builds the per-channel summary from the persisted candidate_data.communication record. */
export function summaryFromCommunication(comm: Record<string, any>): CandidateCommunicationSummary {
  const legacy = (status?: string, error?: string | null): ChannelCommunicationState => ({
    status: status || "NOT_ATTEMPTED",
    error: error ?? null,
    attempt_count: 0,
    retryable: false,
  });
  return {
    contact_name: comm.contact_name ?? null,
    destination_masked: comm.phone ?? null,
    whatsapp: comm.channels?.whatsapp ?? legacy(comm.whatsapp_status, comm.whatsapp_error),
    call: comm.channels?.call ?? legacy(comm.call_status, comm.call_error),
    overall_status: comm.overall_status || "PROCESSING",
  };
}

export function needsPolling(summary: CandidateCommunicationSummary): boolean {
  return CALL_ACTIVE.has(summary.call.status) || WHATSAPP_AWAITING_RECEIPT.has(summary.whatsapp.status);
}

interface ContactResultPanelProps {
  eventId: string;
  candidateId: string;
  communication: Record<string, any>;
  onRetry: (channel: CommunicationChannel) => Promise<unknown>;
}

export function ContactResultPanel({ eventId, candidateId, communication, onRetry }: ContactResultPanelProps) {
  const [summary, setSummary] = useState<CandidateCommunicationSummary>(() => summaryFromCommunication(communication));
  const [retrying, setRetrying] = useState<CommunicationChannel | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const pollStartedAt = useRef(Date.now());

  // Workspace refreshes (SSE) replace the persisted record; adopt it.
  const communicationKey = JSON.stringify(communication);
  useEffect(() => {
    setSummary(summaryFromCommunication(JSON.parse(communicationKey)));
  }, [communicationKey]);

  // The persisted snapshot can predate newer fields (e.g. can_follow_up); load the live view once.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getCandidateCommunication(eventId, candidateId))
      .then((live) => {
        if (!cancelled && live) setSummary(live);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId, candidateId]);

  const shouldPoll = needsPolling(summary);
  useEffect(() => {
    if (!shouldPoll) return;
    pollStartedAt.current = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - pollStartedAt.current > POLL_WINDOW_MS) {
        clearInterval(timer);
        return;
      }
      try {
        setSummary(await getCandidateCommunication(eventId, candidateId, true));
      } catch {
        // Transient: the next tick or the next SSE refresh will catch up.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, eventId, candidateId]);

  const handleRetry = async (channel: CommunicationChannel) => {
    setRetrying(channel);
    setRetryError(null);
    try {
      await onRetry(channel);
      setSummary(await getCandidateCommunication(eventId, candidateId));
    } catch (err: any) {
      setRetryError(err?.message || `Could not retry the ${channel === "call" ? "call" : "WhatsApp message"}.`);
    } finally {
      setRetrying(null);
    }
  };

  const [overallLabel, overallTone] = OVERALL_LABELS[summary.overall_status] || [summary.overall_status, "idle"];
  const outcome = summary.call.conversation_outcome;
  const negotiation = summary.call.negotiation;
  const transcript = summary.call.transcript || [];
  const verdict = summary.call.verdict;
  const replies = summary.whatsapp.replies || [];
  const followups = summary.whatsapp.followups || [];
  // One WhatsApp thread: vendor replies and our follow-ups in the order they were sent.
  const thread = [
    ...replies.map((r) => ({ key: r.id, who: "Vendor", text: r.text, t: r.t ?? 0 })),
    ...followups.map((f) => ({ key: f.message_id, who: "You", text: f.text, t: f.t ?? 0 })),
  ].sort((a, b) => a.t - b.t);
  const replyAnalysis = summary.whatsapp.reply_analysis;
  const history = summary.call.history || [];
  const { noReply, since, due } = noReplyInfo(summary);
  const quietHours = hoursSince(since);
  const canResendWhatsApp = summary.whatsapp.retryable;
  const canTryCall = summary.call.retryable || !!summary.call.can_call_again;
  const decision = replyAnalysis?.decision;
  // The approval to contact this vendor lapsed before anyone decided (UX v3 §6).
  const approvalStatus = String((summary as unknown as Record<string, unknown>).approval_status || "").toUpperCase();
  const expired = summary.overall_status === "EXPIRED" || approvalStatus === "EXPIRED";

  return (
    <div className="rounded-lg p-3 bg-slate-50 border border-slate-200 space-y-2" data-testid="contact-result">
      <div className="text-[11px] font-medium uppercase tracking-label font-mono text-slate-700 flex items-center justify-between">
        <span>Contact Result</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${BADGE_CLASSES[overallTone]}`}>
          {overallLabel}
        </span>
      </div>

      {summary.contact_name && (
        <div className="text-[11px] text-slate-600">
          Contact: <span className="font-semibold text-slate-800">{summary.contact_name}</span>
          {summary.destination_masked && <span className="font-mono text-slate-500"> · {summary.destination_masked}</span>}
        </div>
      )}

      {expired && (
        <div
          className="flex items-start gap-2 rounded-lg border border-standby-300 bg-standby-50 p-2.5 text-[12px] text-standby-900"
          data-testid="request-expired"
        >
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-standby-600" />
          <div>
            <div className="font-semibold">Request expired — pick again to re-request</div>
            <div className="text-[11.5px] text-standby-800">
              Nobody approved contacting this vendor in time, so nothing was sent. Pick them again to create a new request.
            </div>
          </div>
        </div>
      )}

      {noReply && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-standby-300 bg-standby-50 p-2.5 text-[12px] text-standby-900"
          data-testid="no-reply"
        >
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-standby-600" />
            <div>
              <div className="font-semibold">
                {quietHours !== null && quietHours > 0 ? `No reply for ${quietHours} h` : "No reply yet"}
              </div>
              <div className="text-[11.5px] text-standby-800">
                The vendor hasn&apos;t answered.
                {due ? ` Follow-up due ${new Date(due).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}
                {!canResendWhatsApp && !canTryCall && summary.whatsapp.can_follow_up ? " Write a follow-up below." : ""}
              </div>
            </div>
          </div>
          {(canResendWhatsApp || canTryCall) && (
            <div className="flex flex-wrap gap-1.5">
              {canResendWhatsApp && (
                <button
                  onClick={() => handleRetry("whatsapp")}
                  disabled={retrying !== null}
                  data-guide-step="awaiting_replies"
                  className="btn-primary h-7 !px-2.5 text-[11.5px]"
                >
                  {retrying === "whatsapp" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                  Send WhatsApp again
                </button>
              )}
              {canTryCall && (
                <button
                  onClick={() => handleRetry("call")}
                  disabled={retrying !== null}
                  data-guide-step={canResendWhatsApp ? undefined : "awaiting_replies"}
                  className={`${canResendWhatsApp ? "btn-secondary" : "btn-primary"} h-7 !px-2.5 text-[11.5px]`}
                >
                  {retrying === "call" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Phone className="h-3 w-3" />}
                  Try a call
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <ChannelTile
          channel="whatsapp"
          title="WhatsApp"
          icon={<MessageSquare className="w-3 h-3 text-emerald-600" />}
          state={summary.whatsapp}
          labels={WHATSAPP_LABELS}
          hint={summary.whatsapp.status === "ACCEPTED" ? "Waiting for WhatsApp delivery receipt" : undefined}
          retrying={retrying}
          onRetry={handleRetry}
        />
        <ChannelTile
          channel="call"
          title={summary.call.ai_voice ? "AI phone call" : "Phone call"}
          icon={<Phone className="w-3 h-3 text-purple-600" />}
          state={summary.call}
          labels={CALL_LABELS}
          hint={
            summary.call.status === "COMPLETED" && summary.call.duration_seconds != null
              ? `Duration ${summary.call.duration_seconds}s`
              : undefined
          }
          retrying={retrying}
          onRetry={handleRetry}
        />
      </div>

      {verdict && (
        <div className={`p-2 rounded border text-[11px] ${BADGE_CLASSES[VERDICT_TONES[verdict.code] ?? "idle"]}`} data-testid="call-verdict">
          <div className="text-[10px] uppercase font-bold">Call result · {verdict.label}</div>
          {verdict.detail && <div className="mt-0.5">{verdict.detail}</div>}
        </div>
      )}

      {thread.length > 0 && (
        <div className="p-2 rounded bg-[#FDFCFA] border border-slate-200 text-[11px] space-y-1" data-testid="whatsapp-reply">
          <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center justify-between">
            <span>WhatsApp reply</span>
            {replyAnalysis && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px normal-case ${
                  BADGE_CLASSES[(REPLY_LABELS[replyAnalysis.decision] || REPLY_LABELS.UNCLEAR)[1]]
                } ${NEEDS_READING.has(decision || "UNCLEAR") ? "border-dashed" : ""}`}
                data-testid="reply-decision"
              >
                {NEEDS_READING.has(decision || "UNCLEAR") && <HelpCircle className="h-2.5 w-2.5" />}
                {(REPLY_LABELS[replyAnalysis.decision] || REPLY_LABELS.UNCLEAR)[0]}
              </span>
            )}
          </div>
          {thread.map((m) => (
            <div key={m.key} className={`break-words ${m.who === "You" ? "text-emerald-800" : "italic text-slate-700"}`}>
              <span className="not-italic font-semibold">{m.who}:</span> &ldquo;{m.text}&rdquo;
            </div>
          ))}
          {replyAnalysis && (
            <div className="space-y-0.5 text-slate-600">
              {replyAnalysis.summary && <div>{replyAnalysis.summary}</div>}
              {replyAnalysis.quoted_price != null && (
                <div>Quoted price: <span className="font-semibold">{replyAnalysis.quoted_price.toLocaleString("en-IN")}</span></div>
              )}
              {replyAnalysis.next_step && <div className="font-semibold text-slate-800">Next: {replyAnalysis.next_step}</div>}
              {replyAnalysis.method === "KEYWORDS" && (
                <div className="text-[10px] text-amber-700">Quick reading. A smarter AI reading will be tried again when you refresh.</div>
              )}
            </div>
          )}
        </div>
      )}

      {summary.whatsapp.can_follow_up && (
        <WhatsAppFollowup
          eventId={eventId}
          candidateId={candidateId}
          onSent={(next) => setSummary(next)}
        />
      )}

      {retryError && (
        <div className="text-[11px] text-rose-600 bg-rose-50 p-1.5 rounded border border-rose-200">{retryError}</div>
      )}

      {outcome && (
        <div className="p-2 rounded bg-[#FDFCFA] border border-slate-200 text-[11px] space-y-0.5" data-testid="call-outcome">
          <div className="text-[10px] uppercase font-bold text-slate-500">What the vendor said</div>
          <div>Outcome: <span className="font-semibold">{String(outcome.outcome).replace(/_/g, " ").toLowerCase()}</span></div>
          {outcome.available != null && <div>Available: {outcome.available ? "yes" : "no"}</div>}
          {outcome.estimated_price && <div>Estimated price: {outcome.estimated_price}</div>}
          {outcome.price_details && <div>Price details: {outcome.price_details}</div>}
          {outcome.service_details && <div>Service details: {outcome.service_details}</div>}
          {outcome.vendor_notes && <div>Notes: {outcome.vendor_notes}</div>}
          {outcome.final_price && <div>Final price: <span className="font-semibold">{outcome.final_price}</span></div>}
          {outcome.language && <div>Language: {outcome.language}</div>}
          <div className="text-[10px] text-slate-400 pt-0.5">Recorded quote only, not a booking or agreement.</div>
        </div>
      )}

      {negotiation?.rounds?.length ? (
        <div className="p-2 rounded bg-[#FDFCFA] border border-slate-200 text-[11px] space-y-0.5" data-testid="call-negotiation">
          <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center justify-between">
            <span>Negotiation</span>
            {negotiation.final_decision && !verdict && (
              <span className={NEGOTIATION_LABELS[negotiation.final_decision]?.[1] ?? "text-slate-600"}>
                {NEGOTIATION_LABELS[negotiation.final_decision]?.[0] ?? negotiation.final_decision}
              </span>
            )}
          </div>
          {negotiation.rounds.map((r, i) => (
            <div key={i}>
              Vendor asked {r.vendor_price.toLocaleString("en-IN")}
              {r.counter_offer != null && <> → AI countered {r.counter_offer.toLocaleString("en-IN")}</>}
            </div>
          ))}
        </div>
      ) : null}

      {history.length > 0 && (
        <details className="text-[11px]" data-testid="call-history">
          <summary className="cursor-pointer text-slate-500">Previous calls ({history.length})</summary>
          <div className="mt-1 space-y-1">
            {history.map((h, i) => (
              <details key={i} className="p-2 bg-[#FDFCFA] rounded border border-slate-200">
                <summary className="cursor-pointer">
                  {h.verdict?.label || h.status}
                  {h.duration_seconds != null && <span className="text-slate-400"> · {h.duration_seconds}s</span>}
                </summary>
                {h.verdict?.detail && <div className="text-slate-600">{h.verdict.detail}</div>}
                {(h.transcript || []).map((t, j) => (
                  <div key={j}>
                    <span className="font-semibold">{t.speaker === "VENDOR" ? "Vendor" : "AI"}:</span> {t.text}
                  </div>
                ))}
              </details>
            ))}
          </div>
        </details>
      )}

      {transcript.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-slate-500">Call transcript ({transcript.length} turns)</summary>
          <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5 p-2 bg-[#FDFCFA] rounded border border-slate-200">
            {transcript.map((t, i) => (
              <div key={i}>
                <span className="font-semibold">{t.speaker === "VENDOR" ? "Vendor" : "AI"}:</span> {t.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

interface ChannelTileProps {
  channel: CommunicationChannel;
  title: string;
  icon: React.ReactNode;
  state: ChannelCommunicationState;
  labels: Record<string, [string, Tone]>;
  hint?: string;
  retrying: CommunicationChannel | null;
  onRetry: (channel: CommunicationChannel) => void;
}

function ChannelTile({ channel, title, icon, state, labels, hint, retrying, onRetry }: ChannelTileProps) {
  const [label, tone] = labels[state.status] || [state.status, "idle"];
  const isRetrying = retrying === channel;
  return (
    <div className="p-2 rounded bg-[#FDFCFA] border border-slate-200 space-y-1" data-testid={`channel-${channel}`}>
      <div className="flex items-center gap-1 text-slate-500 text-[10px] uppercase font-bold">
        {icon}
        <span>{title}</span>
      </div>
      <div className={`font-semibold text-[11px] flex items-center gap-1 ${TONE_CLASSES[tone]}`}>
        {tone === "progress" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
        <span>{label}</span>
      </div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
      {state.error && <div className="text-[10px] text-rose-600 break-words">{state.error}</div>}
      {(state.retryable || state.can_call_again) && (
        <button
          onClick={() => onRetry(channel)}
          disabled={retrying !== null}
          className="mt-0.5 text-[10px] font-semibold text-emerald-700 hover:underline disabled:opacity-50 flex items-center gap-1"
        >
          {isRetrying ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RotateCcw className="w-2.5 h-2.5" />}
          {isRetrying
            ? "Retrying…"
            : state.can_call_again
              ? "Call again"
              : channel === "call"
                ? "Retry call"
                : "Retry WhatsApp"}
        </button>
      )}
    </div>
  );
}

interface WhatsAppFollowupProps {
  eventId: string;
  candidateId: string;
  onSent: (summary: CandidateCommunicationSummary) => void;
}

/** Drafts the next message (in the vendor's language) for the organizer to edit and send with one click. */
function WhatsAppFollowup({ eventId, candidateId, onSent }: WhatsAppFollowupProps) {
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const handleDraft = async () => {
    setDrafting(true);
    setError(null);
    setSentNote(null);
    try {
      const draft = await draftWhatsAppFollowup(eventId, candidateId);
      setText(draft.text);
    } catch (err: any) {
      setError(err?.message || "Could not draft a reply.");
    } finally {
      setDrafting(false);
    }
  };

  const handleSend = async () => {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      onSent(await sendWhatsAppFollowup(eventId, candidateId, message));
      setText("");
      setSentNote("Sent on WhatsApp.");
    } catch (err: any) {
      setError(err?.message || "WhatsApp did not accept the message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-2 rounded bg-[#FDFCFA] border border-emerald-200 text-[11px] space-y-1.5" data-testid="whatsapp-followup">
      <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center justify-between">
        <span>Reply on WhatsApp</span>
        <button
          onClick={handleDraft}
          disabled={drafting || sending}
          className="flex items-center gap-1 normal-case font-semibold text-emerald-700 hover:underline disabled:opacity-50"
        >
          {drafting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
          {drafting ? "Drafting…" : "Suggest reply"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Write a message, or click Suggest reply"
        aria-label="WhatsApp reply"
        className="w-full rounded border border-slate-200 p-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-400"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">Sent only when you click Send.</span>
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || drafting}
          className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white font-semibold disabled:opacity-50"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {sending ? "Sending…" : "Send on WhatsApp"}
        </button>
      </div>
      {sentNote && <div className="text-[10px] text-emerald-700">{sentNote}</div>}
      {error && <div className="text-[10px] text-rose-600 break-words">{error}</div>}
    </div>
  );
}
