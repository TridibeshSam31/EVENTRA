"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  User,
  Shield,
  ShieldAlert,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  XCircle,
  PhoneCall,
  MessageSquare,
  Sparkles,
  TrendingDown,
  Clock,
  DollarSign,
  ExternalLink,
  Radio,
  Flame,
} from "lucide-react";

import {
  getLiveNegotiation,
  takeOverNegotiation,
  resumeNegotiation,
  cancelNegotiation,
  sendOrganizerMessage,
  runDemoSimulation,
  LiveNegotiationTimeline,
  NegotiationMessage,
} from "@/lib/api/negotiations";
import { getOperatorId } from "@/lib/api/client";
import { getEvent } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";
import { EventShell } from "@/components/v2/EventShell";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import { CueChip, EmptyState } from "@/components/ds";

export default function LiveNegotiationPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params?.eventId as string;
  const assignmentId = params?.assignmentId as string;

  // State
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [timeline, setTimeline] = useState<LiveNegotiationTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamConnected, setStreamConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<"LIVE" | "CONNECTING" | "OFFLINE">("CONNECTING");
  const [hangupWarning, setHangupWarning] = useState<string | null>(null);

  // Interaction State
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [organizerText, setOrganizerText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  // Auto-scroll messages to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Show auto-dismissing toast
  const showToast = useCallback((text: string, type: "success" | "info" | "error" = "info") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  }, []);

  // 1. Fetch Authoritative Snapshot
  const fetchSnapshot = useCallback(async () => {
    if (!eventId || !assignmentId) return;
    try {
      const [ev, snap] = await Promise.all([
        getEvent(eventId).catch(() => null),
        getLiveNegotiation(eventId, assignmentId),
      ]);
      if (ev) setEventData(ev);
      if (snap) {
        setTimeline(snap);
      }
    } catch (err: any) {
      console.error("Failed to load live negotiation snapshot:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, assignmentId]);

  // Initial load
  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  // 2. Setup Server-Sent Events (SSE) Stream via fetch-based reader with Auto-Reconnect & Polling Fallback
  useEffect(() => {
    if (!eventId || !assignmentId) return;

    let isMounted = true;
    let fallbackInterval: NodeJS.Timeout | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let abortController: AbortController | null = null;

    const handleEventPayload = (eventType: string, rawData: string) => {
      if (!isMounted) return;
      try {
        const data = JSON.parse(rawData);

        if (eventType === "message_added") {
          setTimeline((prev) => {
            if (!prev) return prev;
            const exists = prev.messages.some((m) => m.id === data.id);
            if (exists) return prev;
            const newMessages = [...prev.messages, data].sort((a, b) => a.timestamp - b.timestamp);
            return {
              ...prev,
              messages: newMessages,
            };
          });
          setTimeout(scrollToBottom, 50);
        } else if (eventType === "quote_updated") {
          setTimeline((prev) => (prev ? { ...prev, latest_vendor_quote: data.quoted_amount } : prev));
        } else if (eventType === "counter_sent") {
          setTimeline((prev) =>
            prev
              ? {
                  ...prev,
                  latest_agent_counter: data.counter_amount,
                  round_number: data.round || prev.round_number + 1,
                }
              : prev
          );
        } else if (eventType === "control_changed") {
          setTimeline((prev) =>
            prev ? { ...prev, control: data.negotiation_control || data.control } : prev
          );
          if (data.hangup_failed) {
            showToast("could not end call, agent paused instead", "error");
            setHangupWarning("could not end call, agent paused instead");
          } else {
            showToast(`Negotiation control changed to ${data.negotiation_control || data.control}`, "info");
          }
        } else if (eventType === "status_changed") {
          setTimeline((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status || prev.status,
                  approval_id: data.approval_id || prev.approval_id,
                }
              : prev
          );
          if (data.status === "AWAITING_APPROVAL") {
            showToast("Negotiation reached agreement! Ready for approval.", "success");
          }
        } else if (eventType === "cap_blocked") {
          showToast(
            `Agent counter blocked: Amount exceeded budget cap of ₹${data.cap?.toLocaleString()}`,
            "error"
          );
        }
      } catch (err) {
        console.error("Error parsing SSE frame:", err);
      }
    };

    const startPollingFallback = () => {
      if (!fallbackInterval) {
        fallbackInterval = setInterval(() => {
          if (isMounted) fetchSnapshot();
        }, 4000);
      }
    };

    const stopPollingFallback = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const readSseStream = async () => {
      if (!isMounted) return;

      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();

      setConnectionState("CONNECTING");

      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
      const sseUrl = new URL(`${apiBase}/events/${eventId}/negotiations/stream`);
      sseUrl.searchParams.set("assignment_id", assignmentId);
      if (lastEventIdRef.current) {
        sseUrl.searchParams.set("since", lastEventIdRef.current);
      }

      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "x-user-id": getOperatorId(),
      };
      if (lastEventIdRef.current) {
        headers["Last-Event-ID"] = lastEventIdRef.current;
      }

      try {
        const response = await fetch(sseUrl.toString(), {
          headers,
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE stream connection failed with HTTP ${response.status}`);
        }

        // Active connection confirmed
        setStreamConnected(true);
        setConnectionState("LIVE");
        stopPollingFallback();

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (isMounted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (!part.trim()) continue;
            const lines = part.split(/\r?\n/);
            let eventType = "message";
            let eventIdVal = "";
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith(":")) continue; // comment / keepalive
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
              } else if (line.startsWith("id:")) {
                eventIdVal = line.slice(3).trim();
              }
            }

            if (eventIdVal) {
              lastEventIdRef.current = eventIdVal;
            }

            if (dataLines.length > 0) {
              handleEventPayload(eventType, dataLines.join("\n"));
            }
          }
        }
      } catch (err: any) {
        if (abortController?.signal?.aborted) return;
        console.warn("SSE fetch reader encountered error:", err?.message || err);
      } finally {
        if (!isMounted) return;
        setStreamConnected(false);
        setConnectionState("OFFLINE");
        startPollingFallback();

        // Schedule auto-reconnect with cursor
        reconnectTimeout = setTimeout(() => {
          if (isMounted) {
            readSseStream();
          }
        }, 3000);
      }
    };

    // Begin stream
    readSseStream();

    return () => {
      isMounted = false;
      if (abortController) {
        abortController.abort();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      stopPollingFallback();
    };
  }, [eventId, assignmentId, fetchSnapshot, scrollToBottom, showToast]);

  // Actions: Takeover, Resume, Cancel, Send Message
  const handleTakeOver = async () => {
    setActionLoading("takeover");
    try {
      const res = await takeOverNegotiation(eventId, assignmentId);
      // Take-over must still set HUMAN control even when hangup fails
      setTimeline((prev) => (prev ? { ...prev, control: "HUMAN" } : prev));
      if (res.hangup_success === false || res.message?.toLowerCase().includes("could not end call")) {
        showToast("could not end call, agent paused instead", "error");
        setHangupWarning("could not end call, agent paused instead");
      } else {
        showToast("You have taken manual control. Agent paused.", "success");
        setHangupWarning(null);
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to take over negotiation", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    setActionLoading("resume");
    try {
      const res = await resumeNegotiation(eventId, assignmentId);
      setTimeline((prev) => (prev ? { ...prev, control: "AGENT" } : prev));
      setHangupWarning(null);
      showToast("Autonomous agent resumed.", "success");
    } catch (err: any) {
      showToast(err?.message || "Failed to resume agent", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmCancel = async () => {
    setActionLoading("cancel");
    try {
      const res = await cancelNegotiation(eventId, assignmentId, cancelReason || undefined);
      // Cancel must still set HUMAN control even when hangup fails
      setTimeline((prev) => (prev ? { ...prev, status: "CANCELLED", control: "HUMAN" } : prev));
      setShowCancelDialog(false);
      if (res.hangup_success === false || res.message?.toLowerCase().includes("could not end call")) {
        showToast("could not end call, agent paused instead", "error");
        setHangupWarning("could not end call, agent paused instead");
      } else {
        showToast("Negotiation cancelled.", "info");
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to cancel negotiation", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizerText.trim() || sendingMessage) return;

    setSendingMessage(true);
    const textToSend = organizerText.trim();
    setOrganizerText("");

    try {
      const res = await sendOrganizerMessage(eventId, assignmentId, textToSend);
      setTimeline((prev) => {
        if (!prev) return prev;
        const exists = prev.messages.some((m) => m.id === res.id);
        if (exists) return prev;
        return {
          ...prev,
          messages: [...prev.messages, res],
        };
      });
      setTimeout(scrollToBottom, 50);
    } catch (err: any) {
      showToast(err?.message || "Failed to send message", "error");
    } finally {
      setSendingMessage(false);
    }
  };

  const handleRunDemo = async () => {
    setSimulationRunning(true);
    try {
      showToast("Simulating vendor round-trip...", "info");
      await runDemoSimulation(eventId, assignmentId);
      await fetchSnapshot();
      showToast("Simulation completed! Inspected within-ceiling agreement.", "success");
    } catch (err: any) {
      showToast(err?.message || "Demo simulation failed", "error");
    } finally {
      setSimulationRunning(false);
    }
  };

  if (loading && !timeline) {
    return (
      <EventShell event={eventData} eventId={eventId} currentStage="READY">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="workspace-shimmer h-20 rounded-xl" />
          <div className="workspace-shimmer h-44 rounded-xl" />
          <div className="workspace-shimmer h-[420px] rounded-xl" />
          <p className="text-center text-[12.5px] text-ink-500">Connecting to the live negotiation…</p>
        </div>
      </EventShell>
    );
  }

  if (!timeline) {
    return (
      <EventShell event={eventData} eventId={eventId} currentStage="READY">
        <div className="mx-auto max-w-xl">
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5 text-standby-600" />}
            title="Negotiation not found"
            description="This negotiation could not be found or has ended."
            action={
              <Link href={`/events/${eventId}/negotiations`} className="btn-secondary">
                <ArrowLeft className="h-3.5 w-3.5" /> All negotiations
              </Link>
            }
          />
        </div>
      </EventShell>
    );
  }

  const isHuman = timeline.control === "HUMAN";
  const cap = timeline.cap || 0;
  const target = timeline.target || 0;
  const vendorQuote = timeline.latest_vendor_quote || 0;
  const agentCounter = timeline.latest_agent_counter || 0;

  // Cap meter scale: the largest of 125% cap, 110% quote, 135% target.
  const maxScale = Math.max(cap * 1.25, vendorQuote * 1.1, target * 1.35, 100);
  const pct = (v: number) => Math.min(100, Math.max(0, (v / maxScale) * 100));
  const targetPct = pct(target);
  const capPct = pct(cap);
  const quotePct = pct(vendorQuote);
  const counterPct = pct(agentCounter);

  const isQuoteOverCap = vendorQuote > cap && cap > 0;
  const hasApproval = Boolean(timeline.approval_id || timeline.status === "AWAITING_APPROVAL");
  const rupee = (n: number) => (n ? `₹${n.toLocaleString()}` : "—");

  return (
    <EventShell event={eventData} eventId={eventId} currentStage="READY">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Toast */}
        {toastMessage && (
          <div
            role="status"
            className={`fixed right-4 top-4 z-50 flex max-w-sm animate-rise-in items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-medium shadow-xl ${
              toastMessage.type === "success"
                ? "border-go-200 bg-go-50 text-go-900"
                : toastMessage.type === "error"
                ? "border-cue-200 bg-cue-50 text-cue-900"
                : "border-ink-200 bg-[#FDFCFA] text-ink-800"
            }`}
          >
            {toastMessage.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0 text-go-600" />}
            {toastMessage.type === "error" && <AlertTriangle className="h-4 w-4 shrink-0 text-cue-600" />}
            {toastMessage.type === "info" && <Sparkles className="h-4 w-4 shrink-0 text-agent-500" />}
            <span>{toastMessage.text}</span>
          </div>
        )}

        {hangupWarning && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-standby-200 bg-standby-50 px-4 py-3 text-[13px] font-medium text-standby-900">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-standby-600" />
              {hangupWarning}
            </span>
            <button onClick={() => setHangupWarning(null)} className="btn-ghost h-7 !px-2 text-standby-800">
              Dismiss
            </button>
          </div>
        )}

        {/* ── Header ─────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href={`/events/${eventId}/negotiations`}
              className="mt-1 rounded-lg border border-ink-200 bg-[#FDFCFA] p-1.5 text-ink-500 shadow-sm transition hover:text-ink-900"
              aria-label="All negotiations"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="eyebrow mb-1.5 flex flex-wrap items-center gap-2">
                Live negotiation
                <span className="text-ink-300">·</span>
                <span>{timeline.vendor_type}</span>
                {timeline.round_number > 0 && (
                  <>
                    <span className="text-ink-300">·</span>
                    <span className="text-ink-700">Round {timeline.round_number}</span>
                  </>
                )}
              </div>
              <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.025em] text-ink-900" style={{ fontStretch: "88%" }}>
                {timeline.vendor_name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isHuman ? (
                  <CueChip tone="standby">
                    <User className="h-3 w-3" /> You are in control
                  </CueChip>
                ) : (
                  <CueChip tone="agent" pulse>
                    <Bot className="h-3 w-3" /> Agent negotiating
                  </CueChip>
                )}
                <CueChip tone="idle">{String(timeline.status).replace(/_/g, " ").toLowerCase()}</CueChip>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <CueChip
              tone={connectionState === "LIVE" ? "go" : connectionState === "CONNECTING" ? "standby" : "idle"}
              pulse={connectionState !== "OFFLINE"}
              className="font-mono !text-[10.5px] uppercase"
            >
              {connectionState === "LIVE" ? "Live" : connectionState === "CONNECTING" ? "Connecting" : "Offline · polling"}
            </CueChip>
            <button
              onClick={handleRunDemo}
              disabled={simulationRunning}
              className="btn-secondary h-8"
              title="Plays a scripted multi-turn negotiation (demo data)"
            >
              {simulationRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Demo simulation
            </button>
          </div>
        </div>

        {/* ── Cap meter ──────────────────────────────── */}
        <section className="surface overflow-hidden">
          <header className="flex flex-col gap-2 border-b border-ink-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-engine-600" />
                <h3 className="text-[14px] font-semibold text-ink-900">Your budget cap</h3>
                <ProvenanceBadge source="ENGINE" size="sm" />
              </div>
              <p className="mt-1 text-[12.5px] text-ink-500">
                The agent can never offer above your cap, and the cap is never told to the vendor.
              </p>
            </div>
            {timeline.budget_validation && (
              <div className="text-right">
                <div className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Event budget left after this</div>
                <div className="font-display text-[18px] font-bold tabular-nums text-go-700" style={{ fontStretch: "90%" }}>
                  ₹{timeline.budget_validation.remaining_after?.toLocaleString() || "—"}
                </div>
              </div>
            )}
          </header>

          <div className="grid grid-cols-2 divide-ink-200 sm:grid-cols-4 sm:divide-x">
            <Readout label="Target" value={rupee(target)} swatch="bg-info-500" />
            <Readout label="Agent's last offer" value={rupee(agentCounter)} swatch="bg-agent-500" />
            <Readout
              label="Vendor's quote"
              value={rupee(vendorQuote)}
              swatch={isQuoteOverCap ? "bg-cue-600" : "bg-ink-900"}
              tone={isQuoteOverCap ? "text-cue-700" : undefined}
              note={isQuoteOverCap ? "Above your cap" : undefined}
            />
            <Readout label="Hard cap" value={rupee(cap)} swatch="bg-go-500" tone="text-go-700" strong />
          </div>

          <div className="border-t border-ink-200 px-5 pb-5 pt-6">
            <div className="relative h-3 rounded-full bg-ink-100 ring-1 ring-inset ring-ink-200">
              {/* allowed zone */}
              <div className="absolute inset-y-0 left-0 rounded-l-full bg-go-500/25" style={{ width: `${capPct}%` }} />
              {/* blocked zone */}
              <div
                className="absolute inset-y-0 right-0 rounded-r-full"
                style={{
                  left: `${capPct}%`,
                  backgroundImage: "repeating-linear-gradient(135deg, rgba(214,0,60,0.22) 0 6px, rgba(214,0,60,0.08) 6px 12px)",
                }}
              />
              {target > 0 && <Marker pct={targetPct} cls="bg-info-500" label={`Target ${rupee(target)}`} />}
              {agentCounter > 0 && <Marker pct={counterPct} cls="bg-agent-500" label={`Agent ${rupee(agentCounter)}`} />}
              {vendorQuote > 0 && (
                <Marker
                  pct={quotePct}
                  cls={isQuoteOverCap ? "bg-cue-600 animate-cue-blink" : "bg-ink-900"}
                  label={`Vendor ${rupee(vendorQuote)}`}
                  big
                />
              )}
              {/* cap line */}
              <div className="absolute -bottom-1.5 -top-1.5 w-[3px] -translate-x-1/2 rounded-full bg-go-600" style={{ left: `${capPct}%` }} title={`Cap ${rupee(cap)}`} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10.5px] text-ink-400">
              <span>₹0</span>
              <span className="font-semibold text-go-700">cap {rupee(cap)}</span>
              <span className="text-cue-600">blocked above cap</span>
            </div>
          </div>
        </section>

        {/* ── Agreement ──────────────────────────────── */}
        {hasApproval && (
          <section className="flex animate-rise-in flex-col justify-between gap-4 rounded-xl border border-go-200 bg-go-50 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-go-600" />
              <div>
                <h3 className="text-[15px] font-semibold text-go-900">Agreement reached within your cap</h3>
                <p className="mt-0.5 text-[12.5px] text-go-800">
                  Nothing is booked yet. An approval request is waiting for your review.
                </p>
              </div>
            </div>
            <Link
              href={timeline.approval_id ? `/events/${eventId}/approvals/${timeline.approval_id}` : `/events/${eventId}/approvals`}
              className="btn-cue shrink-0"
            >
              {timeline.approval_id ? "Review & approve" : "View approvals"} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </section>
        )}

        {/* ── Transcript (ink console) ───────────────── */}
        <section className="surface-ink flex h-[520px] flex-col overflow-hidden shadow-lg">
          <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-200">
              <Radio className="h-4 w-4 text-cue-400" />
              Transcript
              <span className="font-mono text-[11px] font-normal text-ink-500">{timeline.messages.length} messages</span>
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-label text-ink-500">WhatsApp + voice</span>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-dots-dark px-4 py-5">
            {timeline.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-[12.5px] text-ink-500">
                <Clock className="mb-2 h-6 w-6 opacity-50" />
                Waiting for the first exchange…
              </div>
            ) : (
              timeline.messages.map((msg) => {
                const isAgent = msg.sender_type === "AGENT";
                const isVendor = msg.sender_type === "VENDOR";
                const isOrganizer = msg.sender_type === "ORGANIZER";
                const isVoice = msg.channel === "voice";

                if (msg.sender_type === "SYSTEM") {
                  return (
                    <div key={msg.id} className="flex items-center gap-3">
                      <span className="h-px flex-1 bg-white/[0.08]" />
                      <span className="font-mono text-[10.5px] text-ink-500">{msg.text}</span>
                      <span className="h-px flex-1 bg-white/[0.08]" />
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${isOrganizer ? "ml-auto items-end" : "mr-auto items-start"}`}
                  >
                    <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[10.5px] uppercase tracking-label">
                      {isAgent && <span className="text-agent-300">✦ Agent</span>}
                      {isVendor && <span className="text-ink-300">{timeline.vendor_name}</span>}
                      {isOrganizer && <span className="text-standby-300">You</span>}
                      <span className="flex items-center gap-1 normal-case tracking-normal text-ink-500">
                        {isVoice ? <PhoneCall className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                        {isVoice ? "voice" : "whatsapp"}
                      </span>
                    </div>
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        isOrganizer
                          ? "rounded-tr-md bg-standby-500/15 text-ink-50 ring-1 ring-standby-400/30"
                          : isAgent
                          ? "rounded-tl-md bg-agent-500/15 text-ink-50 ring-1 ring-agent-400/30"
                          : "rounded-tl-md bg-white/[0.06] text-ink-100 ring-1 ring-white/10"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      {msg.amount_extracted != null && (
                        <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                          <span className="font-mono text-[10px] uppercase tracking-label text-agent-300">✦ Amount read</span>
                          <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-white">
                            ₹{msg.amount_extracted.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="mt-1 px-1 font-mono text-[10px] text-ink-500">
                      {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-white/[0.07] bg-black/20 p-3">
            {!isHuman ? (
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <span className="flex items-center gap-2 text-[12.5px] text-ink-400">
                  <span className="cue-light animate-cue-blink bg-agent-400" />
                  The agent is negotiating. Your cap is enforced automatically.
                </span>
                <button onClick={handleTakeOver} disabled={Boolean(actionLoading)} className="btn bg-standby-500 text-ink-950 hover:bg-standby-400">
                  {actionLoading === "takeover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                  Stop agent &amp; take over
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-col justify-between gap-2 rounded-lg bg-standby-500/10 px-3 py-2 text-[12.5px] text-standby-200 ring-1 ring-standby-400/20 sm:flex-row sm:items-center">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    You are in control. The agent won&apos;t reply until you resume it.
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={handleResume} disabled={Boolean(actionLoading)} className="btn h-7 bg-go-500 px-2.5 text-[12px] text-white hover:bg-go-600">
                      {actionLoading === "resume" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Resume agent
                    </button>
                    <button
                      onClick={() => setShowCancelDialog(true)}
                      disabled={Boolean(actionLoading)}
                      className="btn h-7 px-2.5 text-[12px] text-cue-300 ring-1 ring-cue-400/40 hover:bg-cue-500/15"
                    >
                      <XCircle className="h-3 w-3" />
                      End negotiation
                    </button>
                  </div>
                </div>
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={organizerText}
                    onChange={(e) => setOrganizerText(e.target.value)}
                    placeholder="Write to the vendor on WhatsApp…"
                    aria-label="Message to vendor"
                    className="h-10 flex-1 rounded-lg border border-white/10 bg-black/30 px-3.5 text-[13.5px] text-white placeholder:text-ink-500 focus:border-standby-400/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!organizerText.trim() || sendingMessage}
                    className="btn h-10 bg-ink-50 text-ink-950 hover:bg-white"
                    aria-label="Send"
                  >
                    {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        {showCancelDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md animate-rise-in space-y-4 rounded-2xl border border-ink-200 bg-[#FDFCFA] p-6 shadow-2xl">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-cue-50 text-cue-600">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <h3 className="text-[16px] font-semibold text-ink-900">End this negotiation?</h3>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-600">
                The conversation stops now and this vendor is marked as declined. Any call in progress will be hung up.
              </p>
              <div>
                <label htmlFor="cancel-reason" className="eyebrow mb-1.5 block">
                  Reason (optional)
                </label>
                <input
                  id="cancel-reason"
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Over budget, booked elsewhere"
                  className="h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-cue-400 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCancelDialog(false)} className="btn-ghost">
                  Keep negotiating
                </button>
                <button type="button" onClick={handleConfirmCancel} disabled={Boolean(actionLoading)} className="btn-cue">
                  {actionLoading === "cancel" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  End negotiation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}

function Readout({
  label,
  value,
  swatch,
  tone,
  note,
  strong,
}: {
  label: string;
  value: string;
  swatch: string;
  tone?: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className={`px-5 py-3.5 ${strong ? "bg-go-50/60" : ""}`}>
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-label text-ink-500">
        <span className={`h-2 w-2 rounded-sm ${swatch}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-[22px] font-bold tabular-nums ${tone || "text-ink-900"}`} style={{ fontStretch: "90%" }}>
        {value}
      </div>
      {note && <div className="text-[11px] font-semibold text-cue-600">{note}</div>}
    </div>
  );
}

function Marker({ pct, cls, label, big }: { pct: number; cls: string; label: string; big?: boolean }) {
  return (
    <div
      className={`absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#FDFCFA] transition-[left] duration-700 ${cls} ${big ? "h-5 w-5" : "h-3.5 w-3.5"}`}
      style={{ left: `${pct}%` }}
      title={label}
      aria-label={label}
    />
  );
}
