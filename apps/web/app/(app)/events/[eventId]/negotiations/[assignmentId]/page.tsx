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
import { getEvent } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";
import { EventShell } from "@/components/v2/EventShell";

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

  // 2. Setup Server-Sent Events (SSE) Stream with Auto-Reconnect & Polling Fallback
  useEffect(() => {
    if (!eventId || !assignmentId) return;

    let isMounted = true;
    let fallbackInterval: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setConnectionState("CONNECTING");

      // Construct SSE URL
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
      const sseUrl = new URL(`${apiBase}/events/${eventId}/negotiations/stream`);
      sseUrl.searchParams.set("assignment_id", assignmentId);
      if (lastEventIdRef.current) {
        sseUrl.searchParams.set("since", lastEventIdRef.current);
      }

      const es = new EventSource(sseUrl.toString());
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!isMounted) return;
        setStreamConnected(true);
        setConnectionState("LIVE");
      };

      const handleEvent = (event: MessageEvent, eventType: string) => {
        if (!isMounted) return;
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }

        try {
          const data = JSON.parse(event.data);

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
            showToast(`Negotiation control changed to ${data.negotiation_control}`, "info");
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

      es.addEventListener("message_added", (e) => handleEvent(e, "message_added"));
      es.addEventListener("quote_updated", (e) => handleEvent(e, "quote_updated"));
      es.addEventListener("counter_sent", (e) => handleEvent(e, "counter_sent"));
      es.addEventListener("control_changed", (e) => handleEvent(e, "control_changed"));
      es.addEventListener("status_changed", (e) => handleEvent(e, "status_changed"));
      es.addEventListener("cap_blocked", (e) => handleEvent(e, "cap_blocked"));

      es.onerror = () => {
        if (!isMounted) return;
        setStreamConnected(false);
        setConnectionState("OFFLINE");
        es.close();

        // Start fallback polling while disconnected
        if (!fallbackInterval) {
          fallbackInterval = setInterval(fetchSnapshot, 4000);
        }

        // Retry SSE in 5 seconds
        setTimeout(() => {
          if (isMounted) connectSSE();
        }, 5000);
      };
    };

    connectSSE();

    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [eventId, assignmentId, fetchSnapshot, scrollToBottom, showToast]);

  // Actions: Takeover, Resume, Cancel, Send Message
  const handleTakeOver = async () => {
    setActionLoading("takeover");
    try {
      const res = await takeOverNegotiation(eventId, assignmentId);
      setTimeline((prev) => (prev ? { ...prev, control: "HUMAN" } : prev));
      showToast("You have taken manual control. Agent paused.", "success");
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
      setTimeline((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
      setShowCancelDialog(false);
      showToast("Negotiation cancelled.", "info");
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
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-sm text-zinc-400">Connecting to live negotiation stream...</p>
        </div>
      </EventShell>
    );
  }

  if (!timeline) {
    return (
      <EventShell event={eventData} eventId={eventId} currentStage="READY">
        <div className="max-w-xl mx-auto py-12 px-4 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white">Negotiation Not Found</h2>
          <p className="text-sm text-zinc-400 mt-1">This negotiation session could not be located or has expired.</p>
          <Link
            href={`/events/${eventId}/negotiations`}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Negotiations
          </Link>
        </div>
      </EventShell>
    );
  }

  const isHuman = timeline.control === "HUMAN";
  const cap = timeline.cap || 0;
  const target = timeline.target || 0;
  const vendorQuote = timeline.latest_vendor_quote || 0;
  const agentCounter = timeline.latest_agent_counter || 0;

  // Cap Meter Math
  // Scale max value is 120% of cap or 110% of quote, whichever is larger
  const maxScale = Math.max(cap * 1.25, vendorQuote * 1.1, target * 1.35, 100);
  const targetPct = Math.min(100, Math.max(0, (target / maxScale) * 100));
  const capPct = Math.min(100, Math.max(0, (cap / maxScale) * 100));
  const quotePct = Math.min(100, Math.max(0, (vendorQuote / maxScale) * 100));
  const counterPct = Math.min(100, Math.max(0, (agentCounter / maxScale) * 100));

  const isQuoteOverCap = vendorQuote > cap && cap > 0;
  const hasApproval = Boolean(timeline.approval_id || timeline.status === "AWAITING_APPROVAL");

  return (
    <EventShell event={eventData} eventId={eventId} currentStage="READY">
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Toast Alert */}
        {toastMessage && (
          <div
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium flex items-center gap-2.5 transition-all animate-in fade-in slide-in-from-top-4 ${
              toastMessage.type === "success"
                ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/30"
                : toastMessage.type === "error"
                ? "bg-red-950/90 text-red-200 border-red-500/30"
                : "bg-zinc-900/90 text-zinc-200 border-white/20"
            }`}
          >
            {toastMessage.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastMessage.type === "error" && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
            {toastMessage.type === "info" && <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
        )}

        {/* 1. Header Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-zinc-900/80 border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Link
              href={`/events/${eventId}/negotiations`}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-white tracking-tight">{timeline.vendor_name}</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-medium">
                  {timeline.vendor_type}
                </span>

                {/* Control Chip */}
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 transition-all ${
                    isHuman
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/20"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/20"
                  }`}
                >
                  {isHuman ? (
                    <>
                      <User className="w-3.5 h-3.5" />
                      YOU (HUMAN)
                    </>
                  ) : (
                    <>
                      <Bot className="w-3.5 h-3.5" />
                      AGENT AUTONOMOUS
                    </>
                  )}
                </span>

                {/* Round Chip */}
                {timeline.round_number > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-white/10 font-medium">
                    Round {timeline.round_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">Status: {timeline.status}</p>
            </div>
          </div>

          {/* Connection state & Demo action */}
          <div className="flex items-center gap-2.5 self-end sm:self-center">
            {/* Live Indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionState === "LIVE"
                    ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400"
                    : connectionState === "CONNECTING"
                    ? "bg-amber-400 animate-ping"
                    : "bg-zinc-600"
                }`}
              />
              <span className="text-zinc-300 font-mono text-[11px] font-semibold">{connectionState}</span>
            </div>

            {/* Hackathon Demo Simulation Trigger */}
            <button
              onClick={handleRunDemo}
              disabled={simulationRunning}
              className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 font-medium flex items-center gap-1.5 transition-colors"
              title="Plays scripted multi-turn negotiation for demo"
            >
              {simulationRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3 text-indigo-400" />
              )}
              Demo Sim
            </button>
          </div>
        </div>

        {/* 2. CAP METER (The Authority & Safety Guard) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-white/10 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white tracking-wide">ORGANIZER BUDGET CAP GUARD</h3>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Deterministic
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                The agent is strictly prohibited from exceeding your cap. Ceiling is never disclosed to vendors.
              </p>
            </div>
            {timeline.budget_validation && (
              <div className="text-right text-xs">
                <span className="text-zinc-400">Remaining Event Budget: </span>
                <span className="font-bold text-emerald-400">
                  ₹{timeline.budget_validation.remaining_after?.toLocaleString() || "—"}
                </span>
              </div>
            )}
          </div>

          {/* Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="text-zinc-400 block text-[11px]">Target Goal</span>
              <span className="text-sm font-bold text-white">₹{target ? target.toLocaleString() : "—"}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="text-zinc-400 block text-[11px]">Latest Agent Counter</span>
              <span className="text-sm font-bold text-indigo-400">
                ₹{agentCounter ? agentCounter.toLocaleString() : "—"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="text-zinc-400 block text-[11px]">Vendor Quote</span>
              <span
                className={`text-sm font-bold ${
                  isQuoteOverCap ? "text-red-400 animate-pulse" : "text-emerald-400"
                }`}
              >
                ₹{vendorQuote ? vendorQuote.toLocaleString() : "—"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-emerald-300 block text-[11px] font-medium">Your Hard Cap</span>
              <span className="text-sm font-black text-emerald-400">₹{cap ? cap.toLocaleString() : "—"}</span>
            </div>
          </div>

          {/* Visual Horizontal Cap Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="relative h-6 bg-zinc-800/80 rounded-full overflow-hidden border border-white/10">
              {/* Safe Zone (0 to Cap) */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-emerald-600/30 to-emerald-500/40"
                style={{ width: `${capPct}%` }}
              />

              {/* Red Zone (Beyond Cap) */}
              <div
                className="absolute top-0 bottom-0 right-0 bg-red-600/30 border-l border-red-500/40"
                style={{ left: `${capPct}%` }}
              />

              {/* Target Marker */}
              {target > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10"
                  style={{ left: `${targetPct}%` }}
                  title={`Target: ₹${target.toLocaleString()}`}
                />
              )}

              {/* Agent Counter Position */}
              {agentCounter > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-1.5 bg-indigo-400 z-20 shadow-md"
                  style={{ left: `${counterPct}%` }}
                  title={`Agent Counter: ₹${agentCounter.toLocaleString()}`}
                />
              )}

              {/* Vendor Quote Position */}
              {vendorQuote > 0 && (
                <div
                  className={`absolute top-0 bottom-0 w-2 z-30 shadow-lg ${
                    isQuoteOverCap ? "bg-red-500 animate-pulse" : "bg-emerald-400"
                  }`}
                  style={{ left: `${quotePct}%` }}
                  title={`Vendor Quote: ₹${vendorQuote.toLocaleString()}`}
                />
              )}

              {/* Hard Cap Line */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-emerald-300 z-20 shadow-[0_0_10px_rgba(52,211,153,0.8)]"
                style={{ left: `${capPct}%` }}
                title={`Budget Cap: ₹${cap.toLocaleString()}`}
              />
            </div>

            {/* Scale Labels */}
            <div className="flex justify-between text-[10px] text-zinc-400 px-1 font-mono">
              <span>₹0</span>
              {target > 0 && (
                <span className="text-blue-400 font-semibold" style={{ marginLeft: `${Math.max(0, targetPct - 15)}%` }}>
                  Target: ₹{target.toLocaleString()}
                </span>
              )}
              <span className="text-emerald-400 font-bold" style={{ marginLeft: `${Math.max(0, capPct - 25)}%` }}>
                Cap: ₹{cap.toLocaleString()}
              </span>
              <span className="text-red-400 font-bold">Red Zone (Blocked)</span>
            </div>
          </div>
        </div>

        {/* 3. Approval Card (When agreement reached within ceiling) */}
        {hasApproval && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-950/60 to-zinc-900 border border-emerald-500/40 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Negotiation Agreed Within Budget Cap!</h3>
              </div>
              <p className="text-xs text-zinc-300">
                Final negotiated offer sits comfortably under your cap. Per policy, an operational approval request is
                staged for formal review.
              </p>
            </div>
            {timeline.approval_id ? (
              <Link
                href={`/events/${eventId}/approvals/${timeline.approval_id}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-black bg-emerald-400 hover:bg-emerald-300 transition-all shadow-lg shadow-emerald-500/20 shrink-0"
              >
                Review & Approve <ExternalLink className="w-4 h-4" />
              </Link>
            ) : (
              <Link
                href={`/events/${eventId}/approvals`}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-black bg-emerald-400 hover:bg-emerald-300 transition-all shadow-lg shadow-emerald-500/20 shrink-0"
              >
                View Approvals <ExternalLink className="w-4 h-4" />
              </Link>
            )}
          </div>
        )}

        {/* 4. Chat-style Transcript Stream */}
        <div className="rounded-2xl bg-zinc-950/90 border border-white/10 shadow-2xl flex flex-col h-[480px]">
          {/* Transcript Header */}
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-zinc-900/40 rounded-t-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <MessageSquare className="w-4 h-4 text-indigo-400" />
              <span>Real-Time Transcript ({timeline.messages.length} messages)</span>
            </div>
            <span className="text-[11px] text-zinc-400">WhatsApp & Voice Synced</span>
          </div>

          {/* Scrollable Bubble Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {timeline.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-xs">
                <Clock className="w-8 h-8 mb-2 opacity-40" />
                <p>Waiting for first conversation exchange...</p>
              </div>
            ) : (
              timeline.messages.map((msg) => {
                const isAgent = msg.sender_type === "AGENT";
                const isVendor = msg.sender_type === "VENDOR";
                const isOrganizer = msg.sender_type === "ORGANIZER";
                const isVoice = msg.channel === "voice";

                if (msg.sender_type === "SYSTEM") {
                  return (
                    <div key={msg.id} className="flex justify-center my-2">
                      <span className="text-[11px] px-3 py-1 rounded-full bg-white/5 text-zinc-400 border border-white/5">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isOrganizer ? "items-end" : "items-start"
                    } max-w-[85%] sm:max-w-[75%] ${isOrganizer ? "ml-auto" : "mr-auto"}`}
                  >
                    {/* Sender Identity & Channel Badge */}
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 mb-1 px-1">
                      {isAgent && (
                        <>
                          <Bot className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Autonomous Agent</span>
                        </>
                      )}
                      {isVendor && (
                        <>
                          <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-blue-400">{timeline.vendor_name}</span>
                        </>
                      )}
                      {isOrganizer && (
                        <>
                          <User className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-amber-400">You (Organizer)</span>
                        </>
                      )}

                      {/* Channel Icon */}
                      <span className="text-zinc-600">•</span>
                      <span className="text-zinc-400 text-[10px] flex items-center gap-0.5">
                        {isVoice ? (
                          <>
                            <PhoneCall className="w-3 h-3 text-purple-400" /> Voice Call
                          </>
                        ) : (
                          <>
                            <MessageSquare className="w-3 h-3 text-emerald-400" /> WhatsApp
                          </>
                        )}
                      </span>
                    </div>

                    {/* Message Bubble */}
                    <div
                      className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                        isOrganizer
                          ? "bg-amber-600/20 text-white border border-amber-500/30 rounded-tr-sm"
                          : isAgent
                          ? "bg-zinc-900 text-zinc-100 border border-emerald-500/30 rounded-tl-sm shadow-sm"
                          : "bg-blue-950/30 text-zinc-100 border border-blue-500/30 rounded-tl-sm shadow-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>

                      {/* Highlight Extracted Amount */}
                      {msg.amount_extracted != null && (
                        <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-1.5">
                          <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                            Extracted Quote:
                          </span>
                          <span className="text-xs font-bold text-white bg-black/40 px-2 py-0.5 rounded border border-white/10">
                            ₹{msg.amount_extracted.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span className="text-[10px] text-zinc-400 mt-1 px-1">
                      {new Date(msg.timestamp * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 5. Bottom Action Bar */}
          <div className="p-3 border-t border-white/10 bg-zinc-900/80 rounded-b-2xl">
            {/* If in AGENT mode: Large Takeover Button */}
            {!isHuman ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Agent is actively negotiating. Cap is enforced automatically.</span>
                </div>
                <button
                  onClick={handleTakeOver}
                  disabled={Boolean(actionLoading)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-amber-600 hover:bg-amber-500 active:scale-95 transition-all shadow-lg shadow-amber-600/20 shrink-0"
                >
                  {actionLoading === "takeover" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldAlert className="w-4 h-4" />
                  )}
                  Stop Agent / Take Over
                </button>
              </div>
            ) : (
              /* If in HUMAN mode: Message Input + Resume + Cancel */
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
                  <span className="flex items-center gap-1.5 font-medium">
                    <User className="w-3.5 h-3.5" />
                    You are in manual control. Outbound agent replies are paused.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResume}
                      disabled={Boolean(actionLoading)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      {actionLoading === "resume" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Resume Agent
                    </button>
                    <button
                      onClick={() => setShowCancelDialog(true)}
                      disabled={Boolean(actionLoading)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/30 transition-colors"
                    >
                      <XCircle className="w-3 h-3" />
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Organizer Chat Input */}
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={organizerText}
                    onChange={(e) => setOrganizerText(e.target.value)}
                    placeholder="Type a manual reply to the vendor (WhatsApp)..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!organizerText.trim() || sendingMessage}
                    className="p-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                  >
                    {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Cancel Confirmation Modal */}
        {showCancelDialog && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl bg-zinc-900 border border-white/10 p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3 text-red-400">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-base font-bold text-white">Cancel Negotiation?</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                This will immediately terminate the conversation and mark the vendor assignment as DECLINED. Any active
                call will be disconnected.
              </p>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Reason (Optional):</label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Budget mismatch, venue booked elsewhere"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500/50"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelDialog(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10"
                >
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={Boolean(actionLoading)}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 flex items-center gap-1.5"
                >
                  {actionLoading === "cancel" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Termination
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}
