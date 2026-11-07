"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Sparkles,
  Send,
  X,
  Volume2,
  DollarSign,
  Calendar,
  UserCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import {
  engageProvider,
  simulateProviderResponse,
  negotiateWithProvider,
  requestEngagementApproval,
  confirmProviderEngagement,
  getNegotiationConversation,
  NegotiationResult,
  NegotiationConversation,
} from "@/lib/api/negotiation";
import { approveRequest } from "@/lib/api/approvals";

interface ProviderNegotiationModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: any;
  onUpdate: () => void;
}

export function ProviderNegotiationModal({
  isOpen,
  onClose,
  assignment,
  onUpdate,
}: ProviderNegotiationModalProps) {
  const [conversation, setConversation] = useState<NegotiationConversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states for initiating engagement
  const [targetAmount, setTargetAmount] = useState<number>(assignment?.target_amount || 42000);
  const [maxApprovedAmount, setMaxApprovedAmount] = useState<number>(assignment?.max_approved_amount || 45000);
  const [currency, setCurrency] = useState<string>(assignment?.currency || "INR");
  const [coverageStart, setCoverageStart] = useState<string>(assignment?.coverage_start || "10:00");
  const [coverageEnd, setCoverageEnd] = useState<string>(assignment?.coverage_end || "20:00");
  const [channel, setChannel] = useState<"WHATSAPP" | "VOICE">("WHATSAPP");

  // Voice call audio simulation playback
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversation = async () => {
    if (!assignment?.id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getNegotiationConversation(assignment.id);
      setConversation(res);
      if (res.assignment) {
        if (res.assignment.target_amount) setTargetAmount(Number(res.assignment.target_amount));
        if (res.assignment.max_approved_amount) setMaxApprovedAmount(Number(res.assignment.max_approved_amount));
        if (res.assignment.currency) setCurrency(String(res.assignment.currency));
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load negotiation thread.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && assignment?.id) {
      loadConversation();
    }
  }, [isOpen, assignment?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  if (!isOpen || !assignment) return null;

  const currentAssignment = conversation?.assignment || assignment;
  const currentVendor = conversation?.vendor || assignment.vendor;
  const negStatus = (currentAssignment.negotiation_status || "NOT_CONTACTED").toUpperCase();

  // Handlers
  const handleInitiateContact = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await engageProvider(assignment.id, {
        target_amount: Number(targetAmount),
        max_approved_amount: Number(maxApprovedAmount),
        currency,
        required_coverage_start: coverageStart,
        required_coverage_end: coverageEnd,
      });
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Failed to initiate engagement.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSimulate = async (scenario: "ACCEPT" | "COUNTER" | "DECLINE", quotedAmount?: number, message?: string) => {
    try {
      setActionLoading(true);
      setError(null);
      await simulateProviderResponse(assignment.id, {
        scenario,
        quoted_amount: quotedAmount,
        message,
      });
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Simulation failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleNegotiateCounter = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await negotiateWithProvider(assignment.id);
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Counter-offer generation failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestApproval = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await requestEngagementApproval(assignment.id);
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Approval request failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveCommitment = async () => {
    try {
      setActionLoading(true);
      setError(null);
      if (currentAssignment.approval_id) {
        await approveRequest(currentAssignment.approval_id, "Human authorized provider commitment via negotiation panel");
      }
      await confirmProviderEngagement(assignment.id);
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Approval/Confirmation failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDirect = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await confirmProviderEngagement(assignment.id);
      await loadConversation();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || "Confirmation failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "NOT_CONTACTED":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">NOT CONTACTED</span>;
      case "CONTACTED":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-blue-950 text-blue-400 border border-blue-800 animate-pulse">CONTACTED • AWAITING</span>;
      case "NEGOTIATING":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-amber-950 text-amber-400 border border-amber-800">AI NEGOTIATING</span>;
      case "AWAITING_APPROVAL":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-purple-950 text-purple-300 border border-purple-800 animate-bounce">HUMAN APPROVAL REQUIRED</span>;
      case "APPROVED":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">APPROVED</span>;
      case "CONFIRMED":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">CONFIRMED & CONTRACTED</span>;
      case "DECLINED":
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-red-950 text-red-400 border border-red-800">PROVIDER DECLINED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/75 backdrop-blur-md flex items-center justify-center p-3 md:p-6 overflow-hidden animate-in fade-in duration-200">
      <div className="max-w-5xl w-full h-[90vh] bg-[#090d16] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Modal Top Bar */}
        <div className="p-4 md:px-6 md:py-4 border-b border-slate-800/80 bg-[#0c1220] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base md:text-lg font-bold text-slate-100 tracking-tight">
                  {currentVendor?.name || `Vendor #${currentAssignment.vendor_id}`}
                </h2>
                {getStatusBadge(negStatus)}
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span className="uppercase font-mono text-[10px] text-cyan-400 font-semibold">{currentAssignment.category || "PROVIDER"}</span>
                <span>•</span>
                <span>Autonomous Negotiation Agent</span>
                <span>•</span>
                <span className="text-slate-400 font-mono text-[11px]">Contact: {currentVendor?.contact_phone || "+1 (555) 019-2834"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadConversation}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Refresh conversation"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Authority Rule Notice Pill */}
        <div className="bg-blue-950/40 border-b border-blue-900/40 px-6 py-2 flex items-center justify-between text-[11px] text-blue-300">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Deterministic Authority Bound:</strong> Agent negotiates freely towards target quote. Ceiling: <span className="font-mono text-cyan-300 font-bold">{currency} {Number(maxApprovedAmount).toLocaleString()}</span>. <em>Autonomous acceptance is forbidden; final commitment requires human approval.</em>
            </span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
            <span>ROUND: {currentAssignment.negotiation_round || "0"}</span>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div className="bg-red-950/80 border-b border-red-800/80 px-6 py-2.5 text-xs text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Main Content: Split View */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 bg-[#070b12]">
          {/* LEFT: Conversation Feed (7 cols) */}
          <div className="md:col-span-7 flex flex-col border-r border-slate-800/80 h-full min-h-0">
            {/* Channel header */}
            <div className="px-5 py-2.5 border-b border-slate-800/60 bg-slate-900/40 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-mono text-[11px] text-slate-300">
                  Active Channel: {channel === "WHATSAPP" ? "WhatsApp Enterprise API" : "Simulated Voice AI Dispatch"}
                </span>
              </div>
              <button
                onClick={() => setIsPlayingAudio(!isPlayingAudio)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono transition ${
                  isPlayingAudio ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{isPlayingAudio ? "Playing Call Audio" : "Simulate Call Voice"}</span>
              </button>
            </div>

            {/* Audio Waveform Banner when playing */}
            {isPlayingAudio && (
              <div className="bg-cyan-950/40 border-b border-cyan-800/40 p-2.5 flex items-center justify-between text-xs text-cyan-300">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 h-4">
                    <span className="w-1 bg-cyan-400 h-2 animate-pulse" />
                    <span className="w-1 bg-cyan-400 h-4 animate-pulse delay-75" />
                    <span className="w-1 bg-cyan-400 h-3 animate-pulse delay-150" />
                    <span className="w-1 bg-cyan-400 h-5 animate-pulse" />
                    <span className="w-1 bg-cyan-400 h-2 animate-pulse delay-100" />
                  </div>
                  <span className="text-[11px] font-mono">Agent voice call active: Synthetic briefing in progress...</span>
                </div>
                <button
                  onClick={() => setIsPlayingAudio(false)}
                  className="text-[10px] font-mono text-cyan-400 hover:underline"
                >
                  Mute
                </button>
              </div>
            )}

            {/* Messages Scroll Area */}
            <div className="flex-1 p-4 md:p-5 overflow-y-auto space-y-3.5 min-h-0 bg-[#070b12]">
              {conversation?.messages && conversation.messages.length > 0 ? (
                conversation.messages.map((m: any, idx: number) => {
                  const isOutbound = m.direction === "OUTBOUND";
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} space-y-1`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 px-1">
                        <span>{isOutbound ? "EVENTRA AI AGENT" : currentVendor?.name || "PROVIDER"}</span>
                        <span>•</span>
                        <span>{m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}</span>
                        <span className="px-1 py-0.2 rounded bg-slate-800/80 text-[9px] uppercase">{m.channel || "MSG"}</span>
                      </div>
                      <div
                        className={`p-3.5 rounded-2xl max-w-[88%] text-xs leading-relaxed shadow-sm ${
                          isOutbound
                            ? "bg-gradient-to-br from-blue-700/80 to-indigo-800/80 text-white rounded-tr-sm border border-blue-600/40"
                            : "bg-slate-900/90 text-slate-200 rounded-tl-sm border border-slate-700/80"
                        }`}
                      >
                        <p className="whitespace-pre-line">{m.message}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3">
                  <div className="p-3 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
                    <MessageSquare className="w-8 h-8" />
                  </div>
                  <div className="max-w-xs space-y-1">
                    <p className="text-sm font-semibold text-slate-300">No communication recorded yet</p>
                    <p className="text-xs text-slate-500">
                      Configure negotiation boundaries on the right and click <strong>Initiate Contact</strong> to start provider engagement.
                    </p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Agent Status Bar */}
            <div className="p-3 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
              <span className="text-[11px] font-mono">
                Assignment ID: <span className="text-slate-300">{assignment.id.slice(0, 8)}...</span>
              </span>
              {currentAssignment.quoted_amount && (
                <span className="text-[11px] font-mono text-emerald-400">
                  Last Provider Quote: {currency} {Number(currentAssignment.quoted_amount).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {/* RIGHT: Agent Controls & Decision Cockpit (5 cols) */}
          <div className="md:col-span-5 flex flex-col p-5 space-y-5 overflow-y-auto bg-slate-950/40 h-full">
            {/* 1. Commercial Authority Card */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Commercial Boundaries
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                  {currency}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-[#070b12] border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">Target Budget</span>
                  <div className="text-sm font-bold text-emerald-400 mt-0.5">
                    {currency} {Number(targetAmount).toLocaleString()}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#070b12] border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">Max Approved Ceiling</span>
                  <div className="text-sm font-bold text-cyan-400 mt-0.5">
                    {currency} {Number(maxApprovedAmount).toLocaleString()}
                  </div>
                </div>
              </div>

              {conversation?.budget_validation && (
                <div className="p-2.5 rounded-lg bg-blue-950/30 border border-blue-900/40 text-[11px] text-slate-300 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Event Budget:</span>
                    <span className="font-mono">{currency} {Number((conversation.budget_validation as any).total_budget || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current Remaining:</span>
                    <span className="font-mono text-emerald-400">{currency} {Number((conversation.budget_validation as any).remaining_budget || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Interactive Decision & Workflow Actions */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Agent Lifecycle Actions
              </span>

              {/* State A: NOT CONTACTED */}
              {negStatus === "NOT_CONTACTED" && (
                <div className="p-4 rounded-xl border border-blue-900/60 bg-blue-950/20 space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Set parameters and dispatch the agent to pitch requirements, request availability, and probe rates.
                  </p>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 font-mono">Target (₹)</label>
                        <input
                          type="number"
                          value={targetAmount}
                          onChange={(e) => setTargetAmount(Number(e.target.value))}
                          className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-mono">Max Ceiling (₹)</label>
                        <input
                          type="number"
                          value={maxApprovedAmount}
                          onChange={(e) => setMaxApprovedAmount(Number(e.target.value))}
                          className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 font-mono">Coverage Start</label>
                        <input
                          type="text"
                          value={coverageStart}
                          onChange={(e) => setCoverageStart(e.target.value)}
                          className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-mono">Coverage End</label>
                        <input
                          type="text"
                          value={coverageEnd}
                          onChange={(e) => setCoverageEnd(e.target.value)}
                          className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleInitiateContact}
                    disabled={actionLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span>Initiate Contact & Pitch Event</span>
                  </button>
                </div>
              )}

              {/* State B: NEGOTIATING */}
              {negStatus === "NEGOTIATING" && (
                <div className="p-4 rounded-xl border border-amber-900/60 bg-amber-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Quote Exceeds Ceiling — AI Counter Required</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Provider quoted <span className="font-mono text-amber-300 font-bold">{currency} {Number(currentAssignment.quoted_amount).toLocaleString()}</span>. The agent can generate an authorized deterministic counter-offer towards your target budget.
                  </p>
                  <button
                    onClick={handleNegotiateCounter}
                    disabled={actionLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Generate & Send AI Counter-Offer</span>
                  </button>
                </div>
              )}

              {/* State C: AWAITING_APPROVAL */}
              {negStatus === "AWAITING_APPROVAL" && (
                <div className="p-4 rounded-xl border border-purple-800/80 bg-purple-950/30 space-y-3 shadow-xl shadow-purple-950/40">
                  <div className="flex items-center gap-2 text-purple-300 text-xs font-bold">
                    <ShieldCheck className="w-4 h-4 text-purple-400" />
                    <span>Human Approval Required for Final Commitment</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Provider accepted or offered <span className="font-mono text-emerald-400 font-bold">{currency} {Number(currentAssignment.quoted_amount).toLocaleString()}</span> (within ceiling of {currency} {Number(maxApprovedAmount).toLocaleString()}). Deterministic rules require human signoff before locking contract.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleApproveCommitment}
                      disabled={actionLoading}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      <UserCheck className="w-4 h-4" />
                      <span>Approve Commercial Commitment & Confirm</span>
                    </button>
                    {!currentAssignment.approval_id && (
                      <button
                        onClick={handleRequestApproval}
                        disabled={actionLoading}
                        className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Submit to Formal Approvals Queue</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* State D: APPROVED */}
              {negStatus === "APPROVED" && (
                <div className="p-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Human Approval Granted</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Commercial commitment has been approved. Finalize contract binding with the provider.
                  </p>
                  <button
                    onClick={handleConfirmDirect}
                    disabled={actionLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm & Lock Provider Assignment</span>
                  </button>
                </div>
              )}

              {/* State E: CONFIRMED */}
              {negStatus === "CONFIRMED" && (
                <div className="p-4 rounded-xl border border-emerald-500/50 bg-emerald-950/40 space-y-2 text-emerald-300">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Provider Assignment Formally Confirmed!</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Agreed fee of <span className="font-mono text-emerald-400 font-bold">{currency} {Number(currentAssignment.agreed_cost || currentAssignment.quoted_amount).toLocaleString()}</span> has been recorded to the live event budget.
                  </p>
                </div>
              )}

              {/* State F: DECLINED */}
              {negStatus === "DECLINED" && (
                <div className="p-4 rounded-xl border border-red-900/60 bg-red-950/20 space-y-2 text-red-300">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span>Provider Declined Engagement</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Requirement is uncovered. Use the recovery engine or discovery tab to assign an alternate vendor.
                  </p>
                </div>
              )}
            </div>

            {/* 3. Interactive Provider Simulation Controls (Judges / Demo) */}
            <div className="mt-auto p-4 rounded-xl border border-slate-800 bg-[#070b12] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Interactive Demo Simulation
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                  JUDGE CONTROLS
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Test how the autonomous agent handles provider responses:
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => handleSimulate("ACCEPT", 42000, "Hi EVENTRA, I can take this event at ₹42,000. Full team available.")}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-900/60 text-xs font-medium flex items-center justify-between transition disabled:opacity-50"
                >
                  <span>1. Provider Accepts (₹42,000)</span>
                  <ArrowRight className="w-3 h-3 text-emerald-400" />
                </button>
                <button
                  onClick={() => handleSimulate("COUNTER", 48000, "I am available, but my peak date rate is ₹48,000.")}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-900/60 text-xs font-medium flex items-center justify-between transition disabled:opacity-50"
                >
                  <span>2. Provider Counters ₹48,000 (Over Ceiling)</span>
                  <ArrowRight className="w-3 h-3 text-amber-400" />
                </button>
                <button
                  onClick={() => handleSimulate("COUNTER", 44000, "I can meet you at ₹44,000 for the full slot.")}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-900/60 text-xs font-medium flex items-center justify-between transition disabled:opacity-50"
                >
                  <span>3. Provider Counters ₹44,000 (Within Ceiling)</span>
                  <ArrowRight className="w-3 h-3 text-cyan-400" />
                </button>
                <button
                  onClick={() => handleSimulate("DECLINE", undefined, "Sorry, we are already fully booked on that date.")}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-red-300 border border-red-900/60 text-xs font-medium flex items-center justify-between transition disabled:opacity-50"
                >
                  <span>4. Provider Declines (Unavailable)</span>
                  <ArrowRight className="w-3 h-3 text-red-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
