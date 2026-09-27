"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
} from "lucide-react";

import { getEvent } from "@/lib/api/events";
import {
  getConversations,
  getMessages,
  sendMessage,
} from "@/lib/api/conversations";
import type { Conversation, Message } from "@/types/communication";
import { EventHeader } from "@/components/v2/EventHeader";

export default function ConversationsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [eventData, setEventData] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");

  const loadConversations = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const [ev, convsRes] = await Promise.allSettled([
        getEvent(eventId),
        getConversations(eventId),
      ]);

      if (ev.status === "fulfilled") {
        setEventData(ev.value);
      }

      if (convsRes.status === "fulfilled" && convsRes.value?.items) {
        setConversations(convsRes.value.items);
        if (convsRes.value.items.length > 0 && !selectedConv) {
          setSelectedConv(convsRes.value.items[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedConv]);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      setLoadingMessages(true);
      const res = await getMessages(eventId, convId);
      if (res?.items) {
        setMessages(res.items);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
    }
  }, [selectedConv, loadMessages]);

  // Polling for new messages in selected conversation
  useEffect(() => {
    if (!selectedConv) return;
    const interval = setInterval(() => {
      loadMessages(selectedConv.id);
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedConv, loadMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedConv) return;

    try {
      setSending(true);
      await sendMessage(eventId, selectedConv.id, {
        raw_text: replyText.trim(),
        channel: selectedConv.channel || "whatsapp",
        direction: "outbound",
      });
      setReplyText("");
      await loadMessages(selectedConv.id);
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const filteredConvs = conversations.filter(
    (c) =>
      !search ||
      c.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.recipient_contact?.toLowerCase().includes(search.toLowerCase())
  );

  // Latest extracted facts from the most recent inbound message with facts
  const latestFactMessage = [...messages]
    .reverse()
    .find((m) => m.extracted_facts && Object.keys(m.extracted_facts).length > 0);
  const facts = latestFactMessage?.extracted_facts;

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <EventHeader
        eventId={eventId}
        name={eventData?.name}
        startDate={eventData?.start_datetime}
        location={eventData?.location}
        guestCount={eventData?.guest_count}
        totalBudget={Number(eventData?.total_budget) || 1000000}
        currency={eventData?.currency}
        lifecycleState={eventData?.lifecycle_state}
        state={eventData?.state}
        currentStage="READY"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[720px] rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl overflow-hidden">
          {/* Left Panel: Conversation Master List (4 Cols) */}
          <div className="lg:col-span-4 border-r border-zinc-800/60 flex flex-col bg-zinc-950/40">
            <div className="p-4 border-b border-zinc-800/60">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-cyan-400" />
                  Vendor Communications
                </h3>
                <span className="text-[11px] font-mono text-zinc-500">
                  {conversations.length} threads
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search provider threads..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/30">
              {filteredConvs.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs px-4">
                  {loading
                    ? "Loading communication threads..."
                    : "No vendor conversations yet. Dispatch discovery to trigger outreach."}
                </div>
              ) : (
                filteredConvs.map((conv) => {
                  const isSelected = selectedConv?.id === conv.id;
                  const isCall = conv.channel === "call";

                  return (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConv(conv)}
                      className={`w-full text-left p-3.5 transition-all flex items-start gap-3 ${
                        isSelected
                          ? "bg-zinc-800/60 border-l-2 border-cyan-400"
                          : "hover:bg-zinc-900/40"
                      }`}
                    >
                      <div
                        className={`p-2 rounded-xl mt-0.5 ${
                          isCall
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {isCall ? (
                          <PhoneCall className="w-4 h-4" />
                        ) : (
                          <MessageSquare className="w-4 h-4" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <h4 className="text-xs font-bold text-zinc-200 truncate">
                            {conv.vendor_name || "Provider Contact"}
                          </h4>
                          <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">
                            {new Date(conv.last_message_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <p className="text-[11px] text-zinc-400 truncate">
                          {conv.latest_message?.raw_text || "Outreach initiated"}
                        </p>

                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                            {conv.channel}
                          </span>
                          <span className="text-[10px] font-semibold text-emerald-400">
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

          {/* Center Panel: Threaded Messages (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col bg-black/40">
            {selectedConv ? (
              <>
                {/* Thread Header */}
                <div className="p-4 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/60">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-100 flex items-center gap-2">
                      {selectedConv.vendor_name || "Provider"}
                      <span className="text-[10px] font-mono font-normal text-zinc-500">
                        ({selectedConv.recipient_contact || "Direct Channel"})
                      </span>
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Channel: <span className="uppercase text-cyan-400 font-mono">{selectedConv.channel}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => loadMessages(selectedConv.id)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 ? (
                    <div className="py-12 text-center text-zinc-500 text-xs">
                      No messages recorded yet in this thread.
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isInbound = msg.direction === "inbound";
                      const isCall = msg.channel === "call";

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isInbound ? "items-start" : "items-end"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <span className="text-[10px] font-mono text-zinc-500">
                              {isInbound ? "Vendor" : "Eventra Agent"}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-600">
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>

                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                              isInbound
                                ? "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm"
                                : "bg-cyan-600 text-white rounded-tr-sm shadow-md"
                            }`}
                          >
                            {isCall && (
                              <div className="flex items-center gap-1 text-[10px] font-mono text-cyan-300 mb-1 border-b border-white/10 pb-1">
                                <PhoneCall className="w-3 h-3" /> Voice Call Transcript
                              </div>
                            )}
                            <p className="whitespace-pre-wrap">{msg.raw_text}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Message Input Form */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 border-t border-zinc-800/60 bg-zinc-950/60 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type dispatch message or quote inquiry..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    disabled={sending || !replyText.trim()}
                    className="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white transition disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
                Select a conversation thread to view communications.
              </div>
            )}
          </div>

          {/* Right Panel: Structured Facts Card & Confidence (3 Cols) */}
          <div className="lg:col-span-3 border-l border-zinc-800/60 p-4 bg-zinc-950/60 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-800/60">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                  Extracted Operational Facts
                </h4>
              </div>

              {facts ? (
                <div className="space-y-3.5 text-xs">
                  {/* Availability */}
                  <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
                      Availability Status
                    </span>
                    <div className="flex items-center gap-2">
                      {facts.available === true ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-4 h-4" /> Confirmed Available
                        </span>
                      ) : facts.available === false ? (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                          <AlertCircle className="w-4 h-4" /> Declining / Booked
                        </span>
                      ) : (
                        <span className="text-zinc-400 font-medium">Pending Confirmation</span>
                      )}
                    </div>
                  </div>

                  {/* Quoted Amount */}
                  <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
                      Quoted Price
                    </span>
                    <div className="text-base font-bold text-cyan-400 font-mono">
                      {facts.quoted_amount
                        ? `${facts.currency || "₹"} ${facts.quoted_amount.toLocaleString()}`
                        : "Awaiting Quote"}
                    </div>
                  </div>

                  {/* Notes / Conditions */}
                  {facts.notes && (
                    <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
                        Terms & Notes
                      </span>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">
                        {facts.notes}
                      </p>
                    </div>
                  )}

                  {/* Extraction Confidence & Provenance */}
                  <div className="pt-2 border-t border-zinc-800/40 text-[10px] font-mono text-zinc-500 space-y-1">
                    <div className="flex justify-between">
                      <span>Extraction Confidence:</span>
                      <span className="text-zinc-300 font-semibold">
                        {Math.round((facts.confidence || 0.85) * 100)}%
                      </span>
                    </div>
                    {facts.field_sources && (
                      <div className="flex justify-between">
                        <span>Parser Engine:</span>
                        <span className="text-cyan-400 uppercase">
                          {facts.field_sources.available || "NLP_PARSER"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-500 text-xs">
                  No extracted quote facts available yet. Facts will appear automatically when the provider replies with availability or rate quotes.
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/40 text-[11px] text-zinc-400 mt-4">
              <span className="font-semibold text-zinc-300 block mb-0.5">Authoritative Verification:</span>
              Quotes extracted here are synchronized directly into the operational budget & approval service.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
