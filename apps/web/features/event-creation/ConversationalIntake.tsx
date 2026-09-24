"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Send,
  ArrowRight,
  CheckCircle2,
  Clock,
  DollarSign,
  MapPin,
  Users,
  Layers,
  AlertCircle,
  Play,
  Plus,
  Shield,
  Radio,
  Edit3,
} from "lucide-react";
import {
  processEventIntake,
  modifyEventPlan,
  startAutonomousOperations,
  getEventOperationsStatus,
  simulateCancellationIncident,
  approveRecoveryAction,
} from "../../lib/api/events";

interface Message {
  id: string;
  sender: "organizer" | "eventra";
  text: string;
  timestamp: Date;
  status?: string;
  missingFields?: string[];
}

export function ConversationalIntake() {
  const router = useRouter();
  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "eventra",
      text: "Tell me what you want to organize. Real Gemini LLM will understand your event requirements, extract facts and preferences, build the canonical specification, and guide operational planning.",
      timestamp: new Date(),
    },
  ]);

  const [loading, setLoading] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [intentData, setIntentData] = useState<any>(null);
  const [eventData, setEventData] = useState<any>(null);
  const [planData, setPlanData] = useState<any>(null);
  const [operationsData, setOperationsData] = useState<any>(null);
  const [lifecycleState, setLifecycleState] = useState<string>("DRAFT");
  const [modInput, setModInput] = useState("");
  const [incidentData, setIncidentData] = useState<any>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Polling operations status when LIVE
  useEffect(() => {
    if (lifecycleState !== "LIVE" || !eventId) return;

    const interval = setInterval(async () => {
      try {
        const status = await getEventOperationsStatus(eventId);
        setOperationsData(status);
      } catch (err) {
        console.error("Operations telemetry poll failed:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [lifecycleState, eventId]);

  const handleSendMessage = async (textToSend?: string, forcePlanOverride = false) => {
    const text = textToSend || inputMessage;
    if (!text.trim() && !forcePlanOverride) return;

    const msgText = text.trim() || "Confirm and generate plan";
    const userMsgId = String(Date.now());
    const newMessages: Message[] = [
      ...messages,
      {
        id: userMsgId,
        sender: "organizer",
        text: msgText,
        timestamp: new Date(),
      },
    ];
    setMessages(newMessages);
    setInputMessage("");
    setLoading(true);

    // If LIVE and user mentions caterer cancelled, trigger adaptive recovery
    const textLower = msgText.toLowerCase();
    if (
      lifecycleState === "LIVE" &&
      eventId &&
      textLower.includes("cater") &&
      (textLower.includes("cancel") || textLower.includes("cancelled"))
    ) {
      await handleTriggerCancellation();
      setLoading(false);
      return;
    }

    try {
      const res = await processEventIntake({
        message: msgText,
        event_id: eventId || undefined,
        force_plan: forcePlanOverride,
      });

      if (res.intent) {
        setIntentData(res.intent);
      }

      if (res.status === "MISSING_INFO") {
        if (res.event_id) setEventId(res.event_id);
        if (res.event) setEventData(res.event);
        setMessages([
          ...newMessages,
          {
            id: String(Date.now() + 1),
            sender: "eventra",
            text: res.message,
            timestamp: new Date(),
            status: "MISSING_INFO",
            missingFields: res.missing_fields,
          },
        ]);
      } else if (res.status === "PLAN_READY") {
        setEventId(res.event_id);
        setEventData(res.event);
        setPlanData(res.plan);
        setLifecycleState("PLANNED");
        setMessages([
          ...newMessages,
          {
            id: String(Date.now() + 1),
            sender: "eventra",
            text: res.message,
            timestamp: new Date(),
            status: "PLAN_READY",
          },
        ]);
      }
    } catch (err: any) {
      setMessages([
        ...newMessages,
        {
          id: String(Date.now() + 1),
          sender: "eventra",
          text: `Operational intake error: ${err.message || "Failed to process request."}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleModifyPlan = async (customMod?: string) => {
    const modText = customMod || modInput;
    if (!modText.trim() || !eventId || loading) return;

    setLoading(true);
    setModInput("");
    const newMessages: Message[] = [
      ...messages,
      {
        id: String(Date.now()),
        sender: "organizer",
        text: modText.trim(),
        timestamp: new Date(),
      },
    ];
    setMessages(newMessages);

    try {
      const res = await modifyEventPlan(eventId, { modification: modText.trim() });
      if (res.plan) setPlanData(res.plan);
      if (res.event) setEventData(res.event);
      if (res.specification) {
        setIntentData((prev: any) => ({
          ...prev,
          requirements: res.event?.requirements || prev?.requirements,
          location: res.event?.location || prev?.location,
          guest_count: res.event?.guest_count || prev?.guest_count,
          total_budget: res.event?.total_budget || prev?.total_budget,
        }));
      }
      setMessages([
        ...newMessages,
        {
          id: String(Date.now() + 1),
          sender: "eventra",
          text: res.message,
          timestamp: new Date(),
          status: "PLAN_UPDATED",
        },
      ]);
    } catch (err: any) {
      setMessages([
        ...newMessages,
        {
          id: String(Date.now() + 1),
          sender: "eventra",
          text: `Plan modification error: ${err.message || "Failed to update plan."}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartOperations = async () => {
    if (!eventId || loading) return;
    setLoading(true);

    try {
      const res = await startAutonomousOperations(eventId);
      setOperationsData(res);
      setLifecycleState("LIVE");
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: "eventra",
          text: res.message,
          timestamp: new Date(),
          status: "OPERATING",
        },
      ]);
    } catch (err: any) {
      alert(`Failed to start operations: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerCancellation = async () => {
    if (!eventId || recoveryLoading) return;
    setRecoveryLoading(true);

    try {
      const res = await simulateCancellationIncident(eventId);
      setIncidentData(res);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: "eventra",
          text: `⚠️ **Incident Alert:** Catering provider submitted unexpected cancellation.\n\n• **Impact Analysis:** Task '${res.affected_task?.name}' is BLOCKED.\n• **Downstream Dependencies:** Dinner Banquet Schedule at Risk.\n• **Adaptive Recovery:** Synthesized ${res.recovery_options?.length} replacement options.\n• **Recommended Replacement:** ${res.pending_approval?.proposed_vendor} (₹${Number(res.pending_approval?.proposed_cost).toLocaleString()})\n\n**Action Required:** Human approval gate created for vendor substitution. Click 'Authorize & Execute' to proceed.`,
          timestamp: new Date(),
          status: "INCIDENT",
        },
      ]);
      const status = await getEventOperationsStatus(eventId);
      setOperationsData(status);
    } catch (err: any) {
      alert(`Failed to simulate incident: ${err.message}`);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleApproveRecovery = async () => {
    if (!eventId || !incidentData?.pending_approval?.id || recoveryLoading) return;
    setRecoveryLoading(true);

    try {
      const res = await approveRecoveryAction(eventId, incidentData.pending_approval.id);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: "eventra",
          text: `✅ **Adaptive Recovery Verified & Complete!**\n\n• **Action:** Provider Reassignment executed\n• **Verification Status:** ${res.verification_status}\n• **Task State:** '${res.unblocked_task}' unblocked and set to IN_PROGRESS\n• **Event Health:** Restored to NORMAL/LIVE\n• **Decision Trace:** Persisted to immutable audit log.`,
          timestamp: new Date(),
          status: "RECOVERED",
        },
      ]);
      setIncidentData(null);
      const status = await getEventOperationsStatus(eventId);
      setOperationsData(status);
    } catch (err: any) {
      alert(`Failed to execute recovery approval: ${err.message}`);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const samplePrompts = [
    "Bro mujhe Dholakpur mein shaadi karni hai, around 500 log bulane hain. December mein karne ka soch raha hoon, budget around 12 lakh hai. Ek achha venue chahiye, catering vegetarian honi chahiye, photography aur decoration bhi chahiye.",
    "300-guest wedding in Jaipur on 20 December 2026 with 15 lakh budget for venue, catering, decor, photography and DJ.",
    "I want to organize a 500-person corporate conference in Delhi on 15 November 2026. Budget around 8 lakh. I need venue, catering, AV, photography and transportation.",
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/20 border border-blue-900/40 rounded-2xl p-6 backdrop-blur-md">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-blue-500/20 border border-blue-400/30 rounded-xl text-blue-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">
              Real Gemini Event Intake & Specification Engine
            </h1>
            <p className="text-sm text-zinc-400">
              Natural-language organizer intake powered by Google Gemini structured output,
              deterministic validation, and canonical event specification compiling.
            </p>
          </div>
        </div>
      </div>

      {/* Main Conversational Dialogue & Plan Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Conversational Dialogue */}
        <div className="lg:col-span-7 flex flex-col h-[680px] bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-3 ${
                  m.sender === "organizer" ? "justify-end" : "justify-start"
                }`}
              >
                {m.sender === "eventra" && (
                  <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 text-xs font-bold shrink-0">
                    EV
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                    m.sender === "organizer"
                      ? "bg-blue-600 text-white rounded-br-none shadow-md"
                      : m.status === "INCIDENT"
                      ? "bg-amber-950/50 border border-amber-800/80 text-amber-100 rounded-bl-none"
                      : m.status === "RECOVERED"
                      ? "bg-green-950/50 border border-green-800/80 text-green-100 rounded-bl-none"
                      : "bg-zinc-800/90 border border-zinc-700/60 text-zinc-100 rounded-bl-none"
                  }`}
                >
                  <div className="whitespace-pre-line">{m.text}</div>

                  {m.missingFields && m.missingFields.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-700/60 space-y-1.5">
                      <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" /> Missing Information:
                      </div>
                      {m.missingFields.map((field, idx) => (
                        <div key={idx} className="text-xs text-zinc-300 bg-amber-950/30 border border-amber-900/40 px-2.5 py-1 rounded-lg">
                          • {field}
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    className={`text-[10px] mt-2 font-mono ${
                      m.sender === "organizer" ? "text-blue-200" : "text-zinc-400"
                    }`}
                  >
                    {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-blue-400 italic bg-blue-950/20 border border-blue-900/30 px-3 py-2 rounded-xl w-fit">
                <Radio className="w-3.5 h-3.5 animate-pulse" /> Real Gemini analyzing natural language & extracting event intent...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts (if initial stage) */}
          {lifecycleState === "DRAFT" && messages.length <= 2 && (
            <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/40 space-y-2">
              <div className="text-xs font-medium text-zinc-400">Quick Examples:</div>
              <div className="flex flex-col gap-1.5">
                {samplePrompts.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(p)}
                    className="text-left text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white px-3 py-2 rounded-xl transition-all cursor-pointer"
                  >
                    "{p.slice(0, 90)}..."
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Box */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-950/70">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={
                  lifecycleState === "LIVE"
                    ? "Type command or 'Catering provider cancelled'..."
                    : "Describe event details naturally (e.g. Dholakpur shaadi, 500 log, 12L budget)..."
                }
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-all"
                disabled={loading}
              />

              <button
                type="submit"
                disabled={!inputMessage.trim() || loading}
                className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl transition-all shadow-md cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: EVENTRA Structured Understanding & Plan Inspector */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Card 1: EVENTRA UNDERSTANDS (Real Structured Output) */}
          {(intentData || eventData) ? (
            <div className="bg-zinc-900/90 border border-blue-900/50 rounded-2xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 font-bold">
                      Real Gemini Structured Understanding
                    </span>
                    <h2 className="text-base font-bold text-white">EVENTRA UNDERSTANDS</h2>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* Event Type & Title */}
                <div className="flex justify-between items-center bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-zinc-400 font-medium">Event:</span>
                  <span className="font-bold text-white">
                    {(intentData?.event_type || eventData?.event_type || "Wedding").toString().replace("_", " ").toUpperCase()}
                  </span>
                </div>

                {/* Location */}
                <div className="flex justify-between items-center bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-zinc-400 font-medium flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-blue-400" /> Location:
                  </span>
                  <span className="font-semibold text-white">
                    {intentData?.location || eventData?.location || "Not specified"}
                  </span>
                </div>

                {/* Guests */}
                <div className="flex justify-between items-center bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-zinc-400 font-medium flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-blue-400" /> Guests:
                  </span>
                  <span className="font-semibold text-white">
                    {intentData?.guest_count || eventData?.guest_count ? `${intentData?.guest_count || eventData?.guest_count} attendees` : "Not specified"}
                  </span>
                </div>

                {/* Budget */}
                <div className="flex justify-between items-center bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-zinc-400 font-medium flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-green-400" /> Budget:
                  </span>
                  <span className="font-semibold text-white">
                    {intentData?.total_budget || eventData?.total_budget
                      ? `₹${Number(intentData?.total_budget || eventData?.total_budget).toLocaleString()}`
                      : "Not specified"}
                  </span>
                </div>

                {/* Date */}
                <div className="flex justify-between items-center bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-zinc-400 font-medium flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-purple-400" /> Date:
                  </span>
                  <span className="font-semibold text-white">
                    {intentData?.date_expression || (eventData?.start_time ? new Date(eventData.start_time).toLocaleDateString() : "Exact date missing")}
                  </span>
                </div>

                {/* Services Needed */}
                <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80 space-y-1.5">
                  <span className="text-zinc-400 font-medium block">Services Needed:</span>
                  <div className="flex flex-wrap gap-1">
                    {(intentData?.requirements || eventData?.requirements || ["VENUE", "CATERING", "PHOTOGRAPHY", "DECOR"]).map((req: string, idx: number) => (
                      <span key={idx} className="px-2 py-0.5 bg-blue-950/60 border border-blue-800/50 text-blue-300 text-[11px] rounded-md font-medium">
                        ✓ {req.toString().replace("_", " ").toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Preferences */}
                {intentData?.preferences && intentData.preferences.length > 0 && (
                  <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80 space-y-1">
                    <span className="text-zinc-400 font-medium block">Preferences:</span>
                    <div className="text-zinc-300 text-[11px]">
                      {intentData.preferences.join(", ")}
                    </div>
                  </div>
                )}

                {/* Still Needed / Missing Info */}
                {intentData?.missing_information && intentData.missing_information.length > 0 && (
                  <div className="bg-amber-950/30 border border-amber-900/40 p-2.5 rounded-xl space-y-1">
                    <span className="text-amber-400 font-semibold flex items-center gap-1 text-[11px]">
                      <AlertCircle className="w-3.5 h-3.5" /> Still Needed:
                    </span>
                    {intentData.missing_information.map((m: string, idx: number) => (
                      <div key={idx} className="text-amber-200/90 text-[11px]">• {m}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm / Edit Action Controls */}
              <div className="flex gap-2 pt-2 border-t border-zinc-800">
                <button
                  onClick={() => handleSendMessage("Confirm requirements and build plan", true)}
                  disabled={loading}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Specification
                </button>
              </div>
            </div>
          ) : (
            <div className="h-[200px] bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-3">
              <div className="p-3 bg-zinc-800/50 rounded-2xl text-zinc-500">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-300">Structured Intent Awaiting Input</h3>
              <p className="text-xs text-zinc-400 max-w-xs">
                Describe your event requirements. Real Gemini will extract structured intent and detect missing information.
              </p>
            </div>
          )}

          {/* Operational Plan Overview Card */}
          {lifecycleState === "PLANNED" && planData && eventData && (
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full font-semibold">
                    Plan Generated
                  </span>
                  <h2 className="text-base font-bold text-white mt-1">{eventData.name}</h2>
                </div>
              </div>

              {/* Execution Tasks summary */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 p-3 rounded-xl space-y-1 text-xs">
                <div className="text-zinc-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-purple-400" /> Executable Tasks & Milestones
                </div>
                <div className="font-semibold text-white">
                  {planData.summary?.total_tasks || 0} tasks ({planData.summary?.critical_path_tasks || 0} critical path)
                </div>
              </div>

              {/* Modification Form */}
              <div className="p-3.5 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2.5">
                <div className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                  <Edit3 className="w-3.5 h-3.5 text-blue-400" /> Context-Aware Plan Editor:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => handleModifyPlan("Remove photography and add security")}
                    className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded-md border border-zinc-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-blue-400" /> -Photo +Security
                  </button>
                  <button
                    onClick={() => handleModifyPlan("Increase budget to 15 lakh")}
                    className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded-md border border-zinc-700 flex items-center gap-1 cursor-pointer"
                  >
                    <DollarSign className="w-3 h-3 text-green-400" /> Budget 15L
                  </button>
                  <button
                    onClick={() => handleModifyPlan("Move the event to Gurgaon")}
                    className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded-md border border-zinc-700 flex items-center gap-1 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3 text-purple-400" /> Gurgaon
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleModifyPlan();
                  }}
                  className="flex gap-2 mt-2"
                >
                  <input
                    type="text"
                    value={modInput}
                    onChange={(e) => setModInput(e.target.value)}
                    placeholder="e.g. Actually make it 600 guests..."
                    className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={!modInput.trim() || loading}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-white rounded-lg border border-zinc-700 cursor-pointer"
                  >
                    Update
                  </button>
                </form>
              </div>

              {/* START OPERATIONS BUTTON */}
              <button
                onClick={handleStartOperations}
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-green-600 hover:from-green-500 to-emerald-600 hover:to-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-green-950/40 flex items-center justify-center gap-2 transition-all transform active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" /> START OPERATIONS
              </button>
            </div>
          )}

          {/* Live Telemetry monitor when LIVE */}
          {lifecycleState === "LIVE" && operationsData && (
            <div className="bg-zinc-900/90 border border-green-900/50 rounded-2xl p-5 space-y-4 shadow-2xl max-h-[480px] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full font-semibold flex items-center gap-1 w-fit">
                    <Radio className="w-3 h-3 animate-pulse" /> Operations Active
                  </span>
                  <h2 className="text-base font-bold text-white mt-1">Live Operations Telemetry</h2>
                </div>
              </div>

              {/* Adaptive Recovery Scenario Card */}
              <div className="p-3.5 bg-zinc-950/80 border border-amber-900/40 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Adaptive Recovery Test
                  </div>
                  {!incidentData && (
                    <button
                      onClick={handleTriggerCancellation}
                      disabled={recoveryLoading}
                      className="text-[11px] bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/40 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                    >
                      Simulate Caterer Cancellation
                    </button>
                  )}
                </div>

                {incidentData && (
                  <div className="space-y-2.5 pt-2 border-t border-zinc-800">
                    <div className="text-xs text-red-400 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Task '{incidentData.affected_task?.name}' is BLOCKED
                    </div>
                    <button
                      onClick={handleApproveRecovery}
                      disabled={recoveryLoading}
                      className="w-full py-2 bg-green-600 hover:bg-green-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
                    >
                      Authorize & Execute Replacement
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
