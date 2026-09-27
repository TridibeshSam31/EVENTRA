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
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import {
  getConversations,
  getMessages,
  sendMessage,
} from "@/lib/api/conversations";
import { getAssignmentsForEvent } from "@/lib/api/vendors";
import { initiateVoiceCall } from "@/lib/api/voice";
import { getActivityStream } from "@/lib/api/activityStream";
import type { Conversation, Message } from "@/types/communication";
import type { VendorAssignmentResponse, EventResponse } from "@/types/api";
import type { ActivityLogItem } from "@/types/activityLog";

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
        const list = Array.isArray(res) ? res : (res?.items || []);
        setMessages(list);
      } catch (err) {
        console.error("Failed to load messages:", err);
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

  // Outbound Telephony Call Action
  const handleInitiateCall = async (provider: ProviderContextData) => {
    if (!provider.phone) return;
    try {
      setActionInProgress(provider.id);
      setActiveCall({
        provider_name: provider.name,
        recipient_phone: provider.phone,
        status: "QUEUED",
        start_time: new Date().toISOString(),
      });

      const res = await initiateVoiceCall({
        recipient_phone: provider.phone,
        vendor_name: provider.name,
        event_id: eventId,
        provider_id: provider.id,
      });

      if (res.success) {
        setActiveCall({
          provider_name: provider.name,
          recipient_phone: provider.phone,
          status: "RINGING",
          start_time: new Date().toISOString(),
          source: res.source,
          transcript_available: true,
        });
      } else {
        setActiveCall({
          provider_name: provider.name,
          recipient_phone: provider.phone,
          status: "FAILED",
          error: res.error || "Call rejected by gateway.",
        });
      }
    } catch (err: any) {
      setActiveCall({
        provider_name: provider.name,
        recipient_phone: provider.phone,
        status: "FAILED",
        error: err.message || "Failed to connect telephony provider.",
      });
    } finally {
      setActionInProgress(null);
    }
  };

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

  return (
    <EventShell eventId={eventId} currentStage="READY">
      <div className="space-y-4">
        {/* Top Workspace Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Engagement Command
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {conversations.length} Active Sessions
              </span>
            </div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight mt-0.5">
              Provider Outreach & Communication Hub
            </h1>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold">
              <button
                onClick={() => setViewMode("CONSOLE")}
                className={`px-3 py-1 rounded-md transition ${
                  viewMode === "CONSOLE"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Thread Console
              </button>
              <button
                onClick={() => setViewMode("DASHBOARD")}
                className={`px-3 py-1 rounded-md transition ${
                  viewMode === "DASHBOARD"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Engagement Registry
              </button>
            </div>

            <button
              onClick={loadConversationsAndEvent}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* View Mode 1: Engagement Dashboard / Registry */}
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
          /* View Mode 2: Master-Detail Communication Workspace */
          <div className="space-y-4">
            {/* Mobile Tab Switcher */}
            <div className="flex lg:hidden bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
              <button
                onClick={() => setMobileTab("THREADS")}
                className={`flex-1 py-1.5 rounded-md text-center transition ${
                  mobileTab === "THREADS" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                }`}
              >
                Threads ({filteredConvs.length})
              </button>
              <button
                onClick={() => setMobileTab("CHAT")}
                className={`flex-1 py-1.5 rounded-md text-center transition ${
                  mobileTab === "CHAT" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setMobileTab("CONTEXT")}
                className={`flex-1 py-1.5 rounded-md text-center transition ${
                  mobileTab === "CONTEXT" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                }`}
              >
                Context & Facts
              </button>
            </div>

            {/* 3-Column Enterprise Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[680px]">
              {/* LEFT COLUMN: Provider / Conversation List (4 cols) */}
              <div
                className={`lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden ${
                  mobileTab !== "THREADS" ? "hidden lg:flex" : "flex"
                }`}
              >
                {/* Search & Channel Filters */}
                <div className="p-3 border-b border-slate-200 space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search provider threads..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
                    />
                  </div>

                  {/* Channel Pills */}
                  <div className="flex items-center gap-1 text-[11px] overflow-x-auto no-scrollbar">
                    {["ALL", "WHATSAPP", "CALL", "EMAIL"].map((ch) => (
                      <button
                        key={ch}
                        onClick={() => setChannelFilter(ch)}
                        className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                          channelFilter === ch
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conversation List Feed */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {loading && conversations.length === 0 ? (
                    <div className="py-16 text-center text-xs text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D6003C]" />
                      Loading communication threads...
                    </div>
                  ) : filteredConvs.length === 0 ? (
                    <div className="py-16 text-center text-xs text-slate-400 px-4">
                      No provider conversations found. Start discovery or engage shortlisted providers to initiate threads.
                    </div>
                  ) : (
                    filteredConvs.map((conv) => {
                      const isSelected = selectedConv?.id === conv.id;
                      const isCall = conv.channel === "call";

                      return (
                        <button
                          key={conv.id}
                          onClick={() => {
                            setSelectedConv(conv);
                            setMobileTab("CHAT");
                          }}
                          className={`w-full text-left p-3 transition flex items-start gap-2.5 ${
                            isSelected
                              ? "bg-slate-50 border-l-4 border-[#D6003C]"
                              : "hover:bg-slate-50/60"
                          }`}
                        >
                          <div
                            className={`p-2 rounded-lg mt-0.5 shrink-0 ${
                              isCall
                                ? "bg-purple-50 text-purple-600 border border-purple-200"
                                : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            }`}
                          >
                            {isCall ? (
                              <PhoneCall className="w-3.5 h-3.5" />
                            ) : (
                              <MessageSquare className="w-3.5 h-3.5" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <h4 className="text-xs font-bold text-slate-900 truncate">
                                {conv.vendor_name || "Provider Contact"}
                              </h4>
                              <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                                {new Date(conv.last_message_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <p className="text-[11px] text-slate-500 truncate">
                              {conv.latest_message?.raw_text || "Outreach initiated"}
                            </p>

                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="text-[9px] uppercase font-mono px-1 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                {conv.channel}
                              </span>
                              <span
                                className={`text-[10px] font-semibold ${
                                  conv.status === "CONFIRMED"
                                    ? "text-emerald-600"
                                    : "text-slate-600"
                                }`}
                              >
                                {conv.status}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* CENTER COLUMN: Threaded Message History (5 cols) */}
              <div
                className={`lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden ${
                  mobileTab !== "CHAT" ? "hidden lg:flex" : "flex"
                }`}
              >
                {selectedConv ? (
                  <>
                    {/* Thread Header */}
                    <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMobileTab("THREADS")}
                          className="lg:hidden p-1 text-slate-500 hover:text-slate-800"
                        >
                          <ArrowLeft className="w-4 h-4" />
                        </button>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-xs font-bold text-slate-900">
                              {selectedConv.vendor_name || "Provider Session"}
                            </h3>
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                              {selectedConv.channel}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Target: {selectedConv.recipient_contact || "UNKNOWN"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMobileTab("CONTEXT")}
                          className="lg:hidden text-[11px] font-semibold text-[#D6003C]"
                        >
                          View Context
                        </button>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase px-2 py-0.5 rounded bg-white border border-slate-200">
                          {selectedConv.status}
                        </span>
                      </div>
                    </div>

                    {/* Messages Scroll Area */}
                    <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/30">
                      {loadingMessages && messages.length === 0 ? (
                        <div className="py-20 text-center text-xs text-slate-400">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D6003C]" />
                          Retrieving message log...
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="py-20 text-center text-xs text-slate-400">
                          No messages recorded in this conversation thread yet.
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isInbound = msg.direction === "inbound";

                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-xl p-3 text-xs shadow-xs space-y-1 ${
                                  isInbound
                                    ? "bg-white border border-slate-200 text-slate-900"
                                    : "bg-slate-900 text-white border border-slate-800"
                                }`}
                              >
                                {/* Header / Sender Info */}
                                <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                                  <span className="font-semibold flex items-center gap-1">
                                    {isInbound ? (
                                      <>
                                        <User className="w-2.5 h-2.5 text-slate-400" />
                                        <span>{msg.sender || selectedConv.vendor_name || "Provider"}</span>
                                      </>
                                    ) : (
                                      <>
                                        <Bot className="w-2.5 h-2.5 text-rose-300" />
                                        <span>{msg.sender || "EVENTRA Operator"}</span>
                                      </>
                                    )}
                                  </span>
                                  <span className="font-mono">
                                    {new Date(msg.timestamp || msg.created_at).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>

                                {/* Raw Text */}
                                <p className="leading-relaxed whitespace-pre-wrap font-sans text-xs">
                                  {msg.raw_text}
                                </p>

                                {/* Delivery Status / Footer */}
                                <div className="pt-1 flex items-center justify-between gap-2 border-t border-slate-200/20 text-[10px]">
                                  <span className="uppercase text-[9px] font-mono tracking-wider opacity-70">
                                    {msg.channel}
                                  </span>

                                  {!isInbound && (
                                    <WhatsAppDeliveryStatus
                                      status={msg.status}
                                      timestamp={msg.timestamp}
                                      showLabel={true}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Send Message Footer */}
                    <form
                      onSubmit={handleSendMessage}
                      className="p-3 border-t border-slate-200 bg-white space-y-2"
                    >
                      {sendError && (
                        <div className="p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-700 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>{sendError}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Reply via ${selectedConv.channel || "WhatsApp"}...`}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
                        />
                        <button
                          type="submit"
                          disabled={sending || !replyText.trim()}
                          className="px-3.5 py-2 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {sending ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Sending...</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-3 h-3" />
                              <span>Send</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
                    <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">Select a Provider Thread</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Choose an active conversation from the left to inspect logs or send messages.
                    </p>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Provider Context & Structured Facts (3 cols) */}
              <div
                className={`lg:col-span-3 space-y-4 overflow-y-auto ${
                  mobileTab !== "CONTEXT" ? "hidden lg:block" : "block"
                }`}
              >
                {/* Active Call Live Card if Triggered */}
                {activeCall && (
                  <CallExecutionCard
                    call={activeCall}
                    onRetryCall={() => {
                      if (providerContext) handleInitiateCall(providerContext);
                    }}
                  />
                )}

                {/* Structured Extracted Response Facts */}
                <ResponseFactsCard
                  facts={latestFactMessage?.extracted_facts}
                  vendorName={selectedConv?.vendor_name}
                  timestamp={latestFactMessage?.timestamp}
                />

                {/* Provider Context & Outreach Actions */}
                <ProviderContextPanel
                  provider={providerContext}
                  eventId={eventId}
                  onInitiateCall={handleInitiateCall}
                  onSendWhatsApp={() => {
                    if (selectedConv) setMobileTab("CHAT");
                  }}
                  isActionInProgress={actionInProgress === providerContext?.id}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}
