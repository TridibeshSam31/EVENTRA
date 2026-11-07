"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare,
  PhoneCall,
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  RefreshCw,
  Search,
  Filter,
  ArrowLeft,
  FileText,
  Activity,
  Layers,
  AlertTriangle,
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import {
  getConversations,
  getMessages,
  sendMessage,
} from "@/lib/api/conversations";
import { getAssignmentsForEvent } from "@/lib/api/vendors";
import { getActivityStream } from "@/lib/api/activityStream";
import type { Conversation, Message } from "@/types/communication";

import type { VendorAssignmentResponse, EventResponse } from "@/types/api";
import type { ActivityLogItem } from "@/types/activityLog";
import { motion, useReducedMotion } from "framer-motion";
import { SPRING } from "@/components/ds/motion";
import { describeFacts, humanizeCode } from "@/lib/humanize";

import { EventShell } from "@/components/v2/EventShell";
import { WhatsAppDeliveryStatus } from "@/components/v2/WhatsAppDeliveryStatus";
import { CallExecutionCard, CallExecutionData } from "@/components/v2/CallExecutionCard";
import { ResponseFactsCard } from "@/components/v2/ResponseFactsCard";
import {
  ProviderContextPanel,
  ProviderContextData,
} from "@/components/v2/ProviderContextPanel";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import { EngagementDashboard } from "@/components/v2/EngagementDashboard";
import { PageHeader, Segmented, CueChip, type CueTone } from "@/components/ds";

type ViewMode = "CONSOLE" | "DASHBOARD";
type MobileTab = "THREADS" | "CHAT" | "CONTEXT";

export default function ConversationsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  // Mode & navigation
  const [viewMode, setViewMode] = useState<ViewMode>("CONSOLE");
  const [mobileTab, setMobileTab] = useState<MobileTab>("THREADS");

  // Core Data
  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [assignments, setAssignments] = useState<VendorAssignmentResponse[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);

  // Search & Filters
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Input & Action States
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [activeCall, setActiveCall] = useState<CallExecutionData | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [convsLoadError, setConvsLoadError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // 1. Initial Load of Event, Conversations, and Assignments
  const loadConversationsAndEvent = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [evRes, convsRes, assignmentsRes, activityRes] = await Promise.allSettled([
        getEvent(eventId),
        getConversations(eventId),
        getAssignmentsForEvent(eventId),
        getActivityStream(eventId, 20),
      ]);

      if (evRes.status === "fulfilled" && evRes.value) {
        setEventData(evRes.value);
      }

      if (convsRes.status === "rejected") {
        // Never let a failed request read as "no conversations yet".
        setConvsLoadError((convsRes.reason as any)?.message || "The server didn't respond.");
      } else {
        setConvsLoadError(null);
      }

      if (convsRes.status === "fulfilled" && convsRes.value?.items) {
        const items = convsRes.value.items;
        setConversations(items);
        setSelectedConv((prev) => {
          if (!prev && items.length > 0) return items[0];
          if (prev) {
            const found = items.find((c) => c.id === prev.id);
            return found || (items.length > 0 ? items[0] : null);
          }
          return null;
        });
      }

      if (assignmentsRes.status === "fulfilled" && Array.isArray(assignmentsRes.value)) {
        setAssignments(assignmentsRes.value);
      }

      if (activityRes.status === "fulfilled" && activityRes.value?.items) {
        setActivityLogs(activityRes.value.items);
      }
    } catch (err) {
      console.error("Failed to load communications data:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // 2. Load Messages for Selected Conversation
  const loadMessages = useCallback(
    async (convId: string) => {
      try {
        setLoadingMessages(true);
        const res: any = await getMessages(eventId, convId);
        const list: Message[] = Array.isArray(res) ? res : (res?.items || []);
        // Keep messages that failed to send locally: the server never received them, so the
        // poll would otherwise silently erase the "failed" state the organizer needs to see.
        setMessages((prev) => {
          const failedLocal = prev.filter(
            (m) => m.conversation_id === convId && m.status === "failed" && String(m.id).startsWith("temp-")
          );
          return failedLocal.length ? [...list, ...failedLocal] : list;
        });
        setMessagesError(null);
      } catch (err: any) {
        console.error("Failed to load messages:", err);
        // Keep whatever is on screen and say it may be out of date.
        setMessagesError(err?.message || "The server didn't respond.");
      } finally {
        setLoadingMessages(false);
      }
    },
    [eventId]
  );

  useEffect(() => {
    loadConversationsAndEvent();
  }, [loadConversationsAndEvent]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
    }
  }, [selectedConv?.id, loadMessages]);

  // Polling for real-time thread messages with visibility guard
  useEffect(() => {
    if (!selectedConv) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        loadMessages(selectedConv.id);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedConv?.id, loadMessages]);

  // Handle Outbound Message Send with Optimistic Update
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = replyText.trim();
    if (!textToSend || !selectedConv || sending) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: selectedConv.id,
      event_id: eventId,
      vendor_id: selectedConv.vendor_id || undefined,
      direction: "outbound",
      channel: (selectedConv.channel as "whatsapp" | "call" | "email") || "whatsapp",
      sender: "EVENTRA Operator",
      recipient: selectedConv.recipient_contact || undefined,
      raw_text: textToSend,
      extracted_facts: {},
      status: "sending",
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText("");

    try {
      setSending(true);
      setSendError(null);
      await sendMessage(eventId, selectedConv.id, {
        raw_text: textToSend,
        channel: selectedConv.channel || "whatsapp",
        direction: "outbound",
      });
      await loadMessages(selectedConv.id);
      loadConversationsAndEvent();
    } catch (err: any) {
      console.error("Failed to send message:", err);
      setSendError(err.message || "Failed to dispatch message to provider.");
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m))
      );
    } finally {
      setSending(false);
    }
  };

  // Find assignment matching selected conversation
  const currentAssignment = useMemo(() => {
    if (!selectedConv) return null;
    return (
      assignments.find(
        (a) =>
          a.vendor_id === selectedConv.vendor_id ||
          a.vendor?.name?.toLowerCase() === selectedConv.vendor_name?.toLowerCase()
      ) || null
    );
  }, [selectedConv, assignments]);

  // Map Provider Context Data
  const providerContext: ProviderContextData | null = useMemo(() => {
    if (!selectedConv) return null;
    const vendor = currentAssignment?.vendor;

    return {
      id: selectedConv.vendor_id || currentAssignment?.vendor_id || selectedConv.id,
      name: selectedConv.vendor_name || vendor?.name || "Provider",
      category: currentAssignment?.category || "VENDOR",
      city: vendor?.city || "UNKNOWN",
      address: vendor?.address || null,
      phone: vendor?.phone || selectedConv.recipient_contact || null,
      email: vendor?.contact_email || null,
      website: vendor?.website || null,
      maps_url: vendor?.maps_url || null,
      provenance: (vendor as any)?.source_tag || "LIVE_SCRAPE",
      rating: vendor?.rating || null,
      review_count: vendor?.review_count || null,
      communication_state: selectedConv.status,
      last_contact_at: selectedConv.last_message_at,
      response_state: currentAssignment?.negotiation_status || selectedConv.status,
      approval_required: Boolean(currentAssignment?.approval_id),
      approval_id: currentAssignment?.approval_id || null,
    };
  }, [selectedConv, currentAssignment]);

  // Extract structured facts from newest inbound message that has them
  const latestFactMessage = useMemo(() => {
    return [...messages]
      .reverse()
      .find((m) => m.extracted_facts && Object.keys(m.extracted_facts).length > 0);
  }, [messages]);

  // Filtered Conversations List

  const filteredConvs = useMemo(() => {
    return conversations.filter((c) => {
      // Search
      const matchesSearch =
        !search ||
        (c.vendor_name && c.vendor_name.toLowerCase().includes(search.toLowerCase())) ||
        (c.recipient_contact && c.recipient_contact.includes(search));

      if (!matchesSearch) return false;

      // Channel Filter
      if (channelFilter !== "ALL") {
        if (c.channel?.toLowerCase() !== channelFilter.toLowerCase()) return false;
      }

      // Status Filter
      if (statusFilter !== "ALL") {
        const s = (c.status || "").toUpperCase();
        if (statusFilter === "AWAITING" && s !== "AWAITING_RESPONSE" && s !== "SENT" && s !== "OPEN") {
          return false;
        }
        if (statusFilter === "RESPONDED" && s !== "RESPONDED" && s !== "CLOSED") {
          return false;
        }
      }

      return true;
    });
  }, [conversations, search, channelFilter, statusFilter]);

  const threadCountLabel = `${conversations.length} ${conversations.length === 1 ? "thread" : "threads"}`;

  return (
    <EventShell eventId={eventId} currentStage="READY">
      <div className="space-y-5">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              Engage <span className="text-ink-300">/</span> Messages &amp; calls
              <span className="text-ink-400">· {threadCountLabel}</span>
            </span>
          }
          title="Provider conversations"
          description="Every message EVENTRA sends and every reply it receives, with the agent's reading of each reply kept separate from the original words."
          actions={
            <>
              <Segmented<ViewMode>
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: "CONSOLE", label: "Threads" },
                  { value: "DASHBOARD", label: "Outreach overview" },
                ]}
              />
              <button
                onClick={loadConversationsAndEvent}
                disabled={loading}
                className="btn-secondary !px-2.5"
                title="Refresh"
                aria-label="Refresh conversations"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </>
          }
        />

        {viewMode === "DASHBOARD" ? (
          <EngagementDashboard
            eventId={eventId}
            onSelectConversation={(convId) => {
              const match = conversations.find((c) => c.id === convId);
              if (match) {
                setSelectedConv(match);
                setViewMode("CONSOLE");
              }
            }}
          />
        ) : (
          <div className="space-y-3">
            {/* Mobile tabs */}
            <div className="lg:hidden">
              <Segmented<MobileTab>
                value={mobileTab}
                onChange={setMobileTab}
                className="w-full [&>button]:flex-1 [&>button]:justify-center"
                options={[
                  { value: "THREADS", label: "Threads", count: filteredConvs.length },
                  { value: "CHAT", label: "Chat" },
                  { value: "CONTEXT", label: "Facts" },
                ]}
              />
            </div>

            <div className="grid h-[calc(100dvh-220px)] min-h-[560px] grid-cols-1 gap-3 lg:h-[700px] lg:grid-cols-12">
              {/* ── Threads ───────────────────────────── */}
              <aside
                className={`surface flex-col overflow-hidden lg:col-span-4 xl:col-span-3 ${
                  mobileTab !== "THREADS" ? "hidden lg:flex" : "flex"
                }`}
              >
                <div className="space-y-2.5 border-b border-ink-200 p-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search providers or numbers"
                      aria-label="Search conversations"
                      className="h-9 w-full rounded-lg border border-ink-200 bg-ink-50 pl-8 pr-3 text-[13px] text-ink-800 placeholder:text-ink-400 transition focus:border-ink-400 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {["ALL", "WHATSAPP", "CALL", "EMAIL"].map((ch) => {
                      const active = channelFilter === ch;
                      return (
                        <button
                          key={ch}
                          onClick={() => setChannelFilter(ch)}
                          aria-pressed={active}
                          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] font-semibold transition ${
                            active ? "bg-ink-900 text-ink-50" : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                          }`}
                        >
                          {ch !== "ALL" && <ChannelGlyph channel={ch} className="h-3 w-3" />}
                          {ch === "ALL" ? "All" : ch === "WHATSAPP" ? "WhatsApp" : ch === "CALL" ? "Calls" : "Email"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loading && conversations.length === 0 ? (
                    <div className="space-y-2 p-3">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="workspace-shimmer h-[62px] rounded-lg" />
                      ))}
                    </div>
                  ) : convsLoadError && conversations.length === 0 ? (
                    <div role="alert" className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
                      <AlertTriangle className="mb-3 h-6 w-6 text-cue-500" />
                      <p className="text-[13px] font-semibold text-ink-800">Couldn&apos;t load conversations</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                        {convsLoadError} Messages with vendors may exist — we just couldn&apos;t fetch them.
                      </p>
                      <button onClick={loadConversationsAndEvent} className="btn-secondary mt-4">
                        Try again
                      </button>
                    </div>
                  ) : filteredConvs.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <MessageSquare className="mb-3 h-6 w-6 text-ink-300" />
                      <p className="text-[13px] font-semibold text-ink-700">
                        {conversations.length === 0 ? "No conversations yet" : "Nothing matches"}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
                        {conversations.length === 0
                          ? "Threads appear here once EVENTRA contacts shortlisted providers."
                          : "Try a different search or channel."}
                      </p>
                      {conversations.length === 0 && (
                        <Link href={`/events/${eventId}/vendors`} className="btn-secondary mt-4">
                          Go to vendors
                        </Link>
                      )}
                    </div>
                  ) : (
                    <ul>
                      {filteredConvs.map((conv, convIdx) => {
                        const isSelected = selectedConv?.id === conv.id;
                        const tone = statusTone(conv.status);
                        return (
                          <MotionLi key={conv.id} index={convIdx}>
                            <button
                              onClick={() => {
                                setSelectedConv(conv);
                                setMobileTab("CHAT");
                              }}
                              aria-current={isSelected ? "true" : undefined}
                              className={`relative flex w-full items-start gap-3 border-b border-ink-100 px-3 py-3 text-left transition ${
                                isSelected ? "bg-ink-100/80" : "hover:bg-ink-50"
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="conv-selected-bar"
                                  transition={SPRING}
                                  className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-cue-600"
                                />
                              )}
                              <Avatar name={conv.vendor_name || "Provider"} channel={conv.channel} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="truncate text-[13px] font-semibold text-ink-900">
                                    {conv.vendor_name || "Provider contact"}
                                  </span>
                                  <span className="shrink-0 font-mono text-[10.5px] text-ink-400">
                                    {formatClock(conv.last_message_at)}
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate text-[12px] text-ink-500">
                                  {conv.latest_message?.raw_text || "Outreach started"}
                                </p>
                                <div className="mt-1.5">
                                  <CueChip tone={tone} className="!py-0 !text-[10.5px]">
                                    {humanStatus(conv.status)}
                                  </CueChip>
                                </div>
                              </div>
                            </button>
                          </MotionLi>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </aside>

              {/* ── Thread ────────────────────────────── */}
              <section
                className={`surface flex-col overflow-hidden lg:col-span-8 xl:col-span-6 ${
                  mobileTab !== "CHAT" ? "hidden lg:flex" : "flex"
                }`}
              >
                {selectedConv ? (
                  <>
                    <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <button
                          onClick={() => setMobileTab("THREADS")}
                          className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900 lg:hidden"
                          aria-label="Back to threads"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <Avatar name={selectedConv.vendor_name || "Provider"} channel={selectedConv.channel} />
                        <div className="min-w-0">
                          <h3 className="truncate text-[14px] font-semibold text-ink-900">
                            {selectedConv.vendor_name || "Provider"}
                          </h3>
                          <p className="truncate font-mono text-[11px] text-ink-500">
                            {channelName(selectedConv.channel)} · {selectedConv.recipient_contact || "contact unknown"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => setMobileTab("CONTEXT")}
                          className="text-[12px] font-semibold text-ink-600 underline-offset-2 hover:underline lg:hidden"
                        >
                          Facts
                        </button>
                        <CueChip tone={statusTone(selectedConv.status)}>{humanStatus(selectedConv.status)}</CueChip>
                      </div>
                    </header>

                    <div className="flex-1 space-y-4 overflow-y-auto bg-ink-50/70 bg-dots px-4 py-5">
                      {loadingMessages && messages.length === 0 ? (
                        <div className="space-y-3">
                          <div className="workspace-shimmer h-14 w-2/3 rounded-xl" />
                          <div className="workspace-shimmer ml-auto h-14 w-1/2 rounded-xl" />
                          <div className="workspace-shimmer h-20 w-3/5 rounded-xl" />
                        </div>
                      ) : messagesError && messages.length === 0 ? (
                        <div role="alert" className="flex h-full flex-col items-center justify-center text-center">
                          <AlertTriangle className="mb-2 h-5 w-5 text-cue-500" />
                          <p className="text-[13px] font-semibold text-ink-800">Couldn&apos;t load this thread</p>
                          <p className="mt-1 text-[12px] text-ink-600">{messagesError}</p>
                          <button onClick={() => selectedConv && loadMessages(selectedConv.id)} className="btn-secondary mt-3">
                            Try again
                          </button>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center text-center">
                          <p className="text-[13px] font-semibold text-ink-700">No messages in this thread yet</p>
                          <p className="mt-1 text-[12px] text-ink-600">Messages appear here as soon as they are sent or received.</p>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isInbound = msg.direction === "inbound";
                          const facts = msg.extracted_facts || {};
                          const hasFacts = isInbound && Object.keys(facts).length > 0;
                          return (
                            <MessagePop key={msg.id} inbound={isInbound}>
                              <div className={`flex items-center gap-2 px-1 text-[10.5px] ${isInbound ? "" : "flex-row-reverse"}`}>
                                <span className={`font-mono font-medium uppercase tracking-label ${isInbound ? "text-ink-600" : "text-cue-700"}`}>
                                  {isInbound ? cleanSender(msg.sender, selectedConv.vendor_name) : "EVENTRA"}
                                </span>
                                <span className="font-mono text-ink-400">{formatClock(msg.timestamp || msg.created_at)}</span>
                              </div>
                              <div
                                className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm sm:max-w-[75%] ${
                                  isInbound
                                    ? "rounded-tl-md border border-ink-200 bg-[#FDFCFA] text-ink-900"
                                    : "rounded-tr-md bg-ink-900 text-ink-50"
                                } ${msg.status === "failed" ? "ring-2 ring-cue-500/60" : ""}`}
                              >
                                <p className="whitespace-pre-wrap">{msg.raw_text}</p>
                              </div>
                              <div className={`flex items-center gap-2 px-1 ${isInbound ? "" : "flex-row-reverse"}`}>
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-ink-400">
                                  <ChannelGlyph channel={msg.channel} className="h-2.5 w-2.5" />
                                  {channelName(msg.channel)}
                                </span>
                                {!isInbound && (
                                  <WhatsAppDeliveryStatus status={msg.status} timestamp={msg.timestamp} showLabel={true} />
                                )}
                              </div>

                              {/* ✦ Agent interpretation — a separate layer, never overwriting the message */}
                              {hasFacts && <InterpretationLayer facts={facts} />}
                            </MessagePop>
                          );
                        })
                      )}
                    </div>

                    <form
                      onSubmit={handleSendMessage}
                      className="space-y-2 border-t border-ink-200 bg-[#FDFCFA] p-3"
                      data-guide-step="awaiting_replies"
                    >
                      {messagesError && messages.length > 0 && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-standby-200 bg-standby-50 px-2.5 py-1.5 text-[12px] text-standby-800">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Couldn&apos;t refresh this thread — newer messages may be missing.</span>
                        </div>
                      )}
                      {sendError && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-cue-200 bg-cue-50 px-2.5 py-2 text-[12px] text-cue-700">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{sendError}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Write a ${channelName(selectedConv.channel || "whatsapp")} reply…`}
                          aria-label="Reply message"
                          className="h-10 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 transition focus:border-ink-400 focus:bg-white focus:outline-none"
                        />
                        <button type="submit" disabled={sending || !replyText.trim()} className="btn-primary h-10">
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          <span>{sending ? "Sending" : "Send"}</span>
                        </button>
                      </div>
                      <p className="px-0.5 text-[11px] text-ink-400">
                        Sent from EVENTRA to {selectedConv.recipient_contact || "this provider"}. Delivery state updates as the provider receives and reads it.
                      </p>
                    </form>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-ink-50 text-ink-400">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <p className="text-[14px] font-semibold text-ink-800">Pick a provider to open the chat</p>
                    <p className="mt-1 max-w-[36ch] text-[12.5px] text-ink-500">
                      Choose a conversation on the left to read the full thread or send a reply.
                    </p>
                  </div>
                )}
              </section>

              {/* ── Context & facts ───────────────────── */}
              <aside
                className={`space-y-3 overflow-y-auto lg:col-span-12 xl:col-span-3 ${
                  mobileTab !== "CONTEXT" ? "hidden lg:block" : "block"
                }`}
              >
                {activeCall && <CallExecutionCard call={activeCall} />}
                <ResponseFactsCard
                  facts={latestFactMessage?.extracted_facts}
                  vendorName={selectedConv?.vendor_name}
                  timestamp={latestFactMessage?.timestamp}
                />
                <ProviderContextPanel
                  provider={providerContext}
                  eventId={eventId}
                  onSendWhatsApp={() => {
                    if (selectedConv) setMobileTab("CHAT");
                  }}
                  isActionInProgress={actionInProgress === providerContext?.id}
                />
              </aside>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function formatClock(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function channelName(channel?: string | null) {
  const c = (channel || "").toLowerCase();
  if (c === "whatsapp") return "WhatsApp";
  if (c === "call") return "Call";
  if (c === "email") return "Email";
  return channel || "Message";
}

function ChannelGlyph({ channel, className = "h-3 w-3" }: { channel?: string | null; className?: string }) {
  const c = (channel || "").toLowerCase();
  if (c === "call") return <PhoneCall className={className} />;
  if (c === "email") return <Mail className={className} />;
  return <MessageSquare className={className} />;
}

function statusTone(status?: string | null): CueTone {
  const s = (status || "").toUpperCase();
  if (["CONFIRMED", "RESPONDED", "CLOSED", "COMPLETED", "ACCEPTED"].includes(s)) return "go";
  if (["AWAITING_RESPONSE", "SENT", "OPEN", "PENDING", "QUEUED", "DELIVERED", "READ"].includes(s)) return "standby";
  if (["FAILED", "REJECTED", "DECLINED", "BLOCKED", "NO_ANSWER"].includes(s)) return "cue";
  return "idle";
}

function humanStatus(status?: string | null) {
  if (!status) return "Unknown";
  const s = status.toUpperCase();
  if (s === "AWAITING_RESPONSE") return "Awaiting reply";
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function Avatar({ name, channel }: { name: string; channel?: string | null }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-200 font-display text-[12px] font-bold text-ink-700">
      {letters || "?"}
      <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-[#FDFCFA] bg-ink-900 text-ink-50">
        <ChannelGlyph channel={channel} className="h-2 w-2" />
      </span>
    </span>
  );
}

function InterpretationLayer({ facts }: { facts: Record<string, any> }) {
  const rows: Array<{ k: string; v: string }> = [];
  if (facts.available !== undefined && facts.available !== null) rows.push({ k: "Available", v: facts.available ? "Yes" : "No" });
  if (facts.quoted_amount !== undefined && facts.quoted_amount !== null) {
    const sym = (facts.currency || "INR") === "INR" ? "₹" : `${facts.currency} `;
    rows.push({ k: "Quoted", v: `${sym}${Number(facts.quoted_amount).toLocaleString()}` });
  }
  if (facts.capacity !== undefined && facts.capacity !== null && facts.capacity !== "") rows.push({ k: "Capacity", v: String(facts.capacity) });
  if (facts.eta_minutes !== undefined && facts.eta_minutes !== null) rows.push({ k: "Arrives in", v: `${facts.eta_minutes} min` });
  if (facts.intent) rows.push({ k: "Intent", v: humanizeCode(String(facts.intent)) });
  if (facts.notes) rows.push({ k: "Notes", v: String(facts.notes) });
  if (rows.length === 0) return null;
  // describeFacts reads quoted_price; the conversation API calls it quoted_amount.
  const summary = describeFacts({ ...facts, quoted_price: facts.quoted_amount ?? facts.quoted_price, notes: undefined }, facts.currency || "INR");
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay: 0.15 }}
      className="ml-3 max-w-[80%] rounded-xl border border-agent-200 bg-agent-50/80 px-3 py-2 sm:max-w-[65%]"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-label text-agent-700">✦ Agent reading</span>
        {typeof facts.confidence === "number" && (
          <span className="font-mono text-[10px] text-agent-600">{Math.round(facts.confidence * 100)}% confident</span>
        )}
      </div>
      {summary && <p className="mb-1 text-[12.5px] font-semibold text-agent-950">{summary}</p>}
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.k} className="flex gap-3 text-[12px]">
            <dt className="w-16 shrink-0 text-agent-600">{r.k}</dt>
            <dd className="min-w-0 font-semibold text-agent-950">{r.v}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  );
}

/* ── motion helpers ───────────────────────────────────────── */

function MotionLi({ index, children }: { index: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING, delay: reduce ? 0 : Math.min(index, 12) * 0.03 }}
    >
      {children}
    </motion.li>
  );
}

/** A message bubble group that springs in from its own side of the thread. */
function MessagePop({ inbound, children }: { inbound: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 10, x: inbound ? -12 : 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={SPRING}
      className={`flex flex-col gap-1.5 ${inbound ? "items-start" : "items-end"}`}
    >
      {children}
    </motion.div>
  );
}

/** Sender labels sometimes carry call/message IDs ("Vendor Voice Call (CA0435…)"); show a person-readable label. */
function cleanSender(sender?: string | null, vendorName?: string | null): string {
  const base = (sender || "").replace(/\s*\(\s*[A-Za-z0-9_-]{16,}\s*\)/g, "").trim();
  if (!base) return vendorName || "Provider";
  if (/voice call/i.test(base)) return `${vendorName || "Provider"} · phone call`;
  return base;
}
