"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Sparkles,
  Send,
  X,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Flame,
  Wrench,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Radio,
} from "lucide-react";
import { runOperationsAgent } from "../../lib/api/agent";
import { getOpenWAStatus, OpenWAStatus } from "../../lib/api/negotiation";
import { ProviderCommunicationPanel } from "../../features/provider-communication";
import type { AgentRunResponse } from "../../types/api";

interface OperationsAgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
}

export function OperationsAgentDrawer({
  isOpen,
  onClose,
  eventId,
}: OperationsAgentDrawerProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [openwaStatus, setOpenwaStatus] = useState<OpenWAStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      getOpenWAStatus()
        .then((s) => setOpenwaStatus(s))
        .catch(() => setOpenwaStatus(null));
    }
  }, [isOpen]);

  const quickPrompts = [
    "Assess active vendor risk and generate contingency alternatives",
    "Engage and negotiate with providers for pending service requirements",
    "Review provider WhatsApp quotations and counter-offer within budget ceiling",
    "Audit budget ceiling compliance and flag cost overruns",
  ];

  async function handleExecute(promptText?: string) {
    const textToSend = promptText || message;
    if (!textToSend.trim()) return;

    try {
      setRunning(true);
      setError(null);
      setResult(null);
      const res = await runOperationsAgent(eventId, { message: textToSend });
      setResult(res);
      if (!promptText) setMessage("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Agent loop failed";
      setError(msg);
    } finally {
      setRunning(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-xl bg-card border-l border-border/60 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-card/70">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                Event Operations Agent
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Autonomous Loop
                </span>
                {openwaStatus?.enabled && openwaStatus?.session?.connected ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    OpenWA Live
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                    Simulation Mode
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Synthesizes impact analysis, risk scoring, recovery plans & provider negotiation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Quick Prompts */}
          <div className="space-y-2">
            <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
              Autonomous Directives:
            </span>
            <div className="grid gap-1.5">
              {quickPrompts.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleExecute(q)}
                  disabled={running}
                  className="text-left p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/60 border border-border/40 text-foreground transition text-xs flex items-center justify-between group"
                >
                  <span className="line-clamp-1">{q}</span>
                  <Sparkles className="w-3.5 h-3.5 text-primary opacity-60 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Running Indicator */}
          {running && (
            <div className="p-8 rounded-xl border border-primary/30 bg-primary/5 text-center space-y-3">
              <Bot className="w-8 h-8 text-primary animate-bounce mx-auto" />
              <div className="space-y-1">
                <div className="font-bold text-foreground">
                  Running Autonomous Operations Loop
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Evaluating state machine &bull; Traversing DAG &bull; Scoring risk &bull; Synthesizing recovery options
                </p>
              </div>
            </div>
          )}

          {/* Agent Output Card */}
          {result && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-border/50 bg-secondary/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        result.status === "COMPLETED" || result.status === "VERIFIED"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : result.status === "PENDING_APPROVAL"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {result.termination_status || result.status}
                    </span>
                    {result.run_id && (
                      <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-background/50 border border-border/40">
                        {result.run_id}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {result.step_count || 1} step(s)
                    </span>
                  </div>
                </div>

                {result.objective && (
                  <div className="text-[11px] text-foreground/90 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg flex items-center gap-2">
                    <span className="font-bold text-primary text-[10px] uppercase shrink-0">Objective:</span>
                    <span className="truncate">{result.objective}</span>
                  </div>
                )}

                {result.response && (
                  <div className="p-3 rounded-lg bg-background/60 border border-border/40 text-foreground text-xs leading-relaxed whitespace-pre-wrap">
                    {result.response}
                  </div>
                )}
              </div>

              {/* Factual Operational Tool Trace Timeline */}
              {result.tool_history && result.tool_history.length > 0 && (
                <div className="space-y-2">
                  <div className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider flex items-center justify-between">
                    <span>Operational Execution Trace ({result.tool_history.length} tools):</span>
                    <span className="text-[10px] text-muted-foreground font-mono">Factual telemetry</span>
                  </div>
                  <div className="space-y-1.5">
                    {result.tool_history.map((step) => (
                      <div
                        key={step.step}
                        className="p-2.5 rounded-lg bg-card/80 border border-border/50 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-4 h-4 rounded-full bg-secondary text-secondary-foreground text-[9px] font-bold flex items-center justify-center shrink-0">
                              {step.step}
                            </span>
                            <span className="font-mono font-semibold text-foreground text-[11px]">
                              {step.tool}
                            </span>
                            {step.reason_code && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-secondary/80 text-muted-foreground">
                                {step.reason_code}
                              </span>
                            )}
                          </div>
                          {step.result_summary && (
                            <p className="text-[11px] text-muted-foreground pl-6 line-clamp-2">
                              {step.result_summary}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 ${
                            step.status === "SUCCESS"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : step.status === "REQUIRES_APPROVAL"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-rose-500/20 text-rose-400"
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step Pipeline Badges */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {result.incident && (
                  <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-rose-300 text-[11px]">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Active Incident
                    </div>
                    <div className="truncate text-foreground font-medium">
                      {(result.incident as any).title || "Incident identified"}
                    </div>
                  </div>
                )}

                {result.risk && (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
                      <Flame className="w-3.5 h-3.5" />
                      Risk Assessment
                    </div>
                    <div className="text-foreground font-medium">
                      Level: {(result.risk as any).level || "EVALUATED"} (
                      {(result.risk as any).score?.toFixed(0) || "N/A"})
                    </div>
                  </div>
                )}

                {result.recovery_options && (
                  <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-primary text-[11px]">
                      <Wrench className="w-3.5 h-3.5" />
                      Recovery Strategy
                    </div>
                    <div className="text-foreground font-medium truncate">
                      {result.recovery_options.length} candidate(s) synthesized
                    </div>
                  </div>
                )}

                {result.approval_id && (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Governance Gate
                    </div>
                    <div className="text-foreground font-medium truncate">
                      Approval #{result.approval_id.slice(0, 8)}
                    </div>
                  </div>
                )}

                {result.verification && (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-[11px]">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Verification Status
                    </div>
                    <div className="text-foreground font-medium truncate">
                      {(result.verification as any).status || "VERIFIED"}
                    </div>
                  </div>
                )}

                {result.provider_operation && (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1 col-span-2">
                    <div className="flex items-center justify-between font-bold text-emerald-300 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        Provider Operations Dispatch
                      </div>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        {(result.provider_operation as any).negotiation_status || "DISPATCHED"}
                      </span>
                    </div>
                    <div className="text-foreground font-medium">
                      {(result.provider_operation as any).vendor_name || (result.provider_operation as any).message || "Provider operation active"}
                    </div>
                  </div>
                )}
              </div>

              {/* Inline Provider Communication Panel */}
              {(result.provider_operation as any)?.assignment_id && (
                <div className="pt-2">
                  <div className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider mb-2 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    Live Provider WhatsApp Thread:
                  </div>
                  <ProviderCommunicationPanel
                    assignmentId={(result.provider_operation as any).assignment_id}
                    eventId={eventId}
                    compact={true}
                    onRefresh={() => handleExecute("Check latest provider status")}
                  />
                </div>
              )}

              {/* Quick Jump Buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                {result.active_incident_id && (
                  <button
                    onClick={() => {
                      onClose();
                      router.push(
                        `/events/${eventId}/incidents?incidentId=${result.active_incident_id}`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border/50 text-xs font-semibold"
                  >
                    Inspect Blast Radius
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {result.recovery_options && (
                  <button
                    onClick={() => {
                      onClose();
                      router.push(`/events/${eventId}/recovery`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
                  >
                    View Recovery Options
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {result.approval_id && (
                  <button
                    onClick={() => {
                      onClose();
                      router.push(
                        `/events/${eventId}/approvals?approvalId=${result.approval_id}`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold"
                  >
                    Open Governance Queue
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Full Decision Trace Toggle */}
              {result.decision_trace && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowTrace(!showTrace)}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showTrace ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Full Decision Trace Log</span>
                  </button>
                  {showTrace && (
                    <div className="mt-2 p-3 rounded-xl bg-background/80 border border-border/50 font-mono text-[10px] text-foreground/80 max-h-56 overflow-y-auto whitespace-pre-wrap">
                      {JSON.stringify(result.decision_trace, null, 2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Input */}
        <div className="p-4 border-t border-border/50 bg-card/70">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExecute();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Direct the operations agent..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={running}
              className="flex-1 p-2.5 rounded-lg bg-secondary/50 border border-border text-foreground text-xs placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={running || !message.trim()}
              className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-sm transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
