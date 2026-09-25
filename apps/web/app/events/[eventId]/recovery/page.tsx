"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Wrench,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Sparkles,
  ArrowRight,
  TrendingDown,
  DollarSign,
  Clock,
  Shield,
  Layers,
  Send,
  Zap,
} from "lucide-react";
import {
  listRecoveryOptions,
  generateRecoveryOptions,
  recalculateRecoveryOptions,
  getRecoveryDecisionTrace,
} from "../../../../lib/api/recovery";
import { executeRecoveryOption } from "../../../../lib/api/actions";
import { listIncidents } from "../../../../lib/api/incidents";
import type {
  RecoveryOptionResponse,
  IncidentResponse,
  ActionSubmissionResponse,
} from "../../../../types/api";

export default function RecoveryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = params.eventId as string;
  const initialIncidentId = searchParams.get("incidentId");

  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(
    initialIncidentId || ""
  );
  const [options, setOptions] = useState<RecoveryOptionResponse[]>([]);
  const [stateSnapshot, setStateSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ActionSubmissionResponse | null>(null);
  const [decisionTrace, setDecisionTrace] = useState<any | null>(null);
  const [verificationOutcome, setVerificationOutcome] = useState<any | null>(null);

  // Load incidents to populate incident selector
  useEffect(() => {
    async function fetchIncidents() {
      try {
        const res = await listIncidents(eventId);
        setIncidents(res.items);
        if (!selectedIncidentId && res.items.length > 0) {
          setSelectedIncidentId(res.items[0].id);
        }
      } catch (err: unknown) {
        console.error("Failed to load incidents:", err);
      }
    }
    if (eventId) {
      fetchIncidents();
    }
  }, [eventId, selectedIncidentId]);

  // Load recovery options and decision trace when selectedIncidentId changes
  useEffect(() => {
    async function fetchOptionsAndTrace() {
      if (!selectedIncidentId) return;
      try {
        setLoading(true);
        setError(null);
        setExecutionResult(null);
        const res = await listRecoveryOptions(eventId, selectedIncidentId);
        setOptions(res.items || []);
        setStateSnapshot(res.state_snapshot || "");
        
        try {
          const trace = await getRecoveryDecisionTrace(eventId, selectedIncidentId);
          setDecisionTrace(trace && Object.keys(trace).length > 0 ? trace : null);
          if (trace?.verification) {
            setVerificationOutcome(trace.verification);
          }
        } catch {
          setDecisionTrace(null);
        }
      } catch (err: unknown) {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchOptionsAndTrace();
  }, [eventId, selectedIncidentId]);

  async function handleGenerate() {
    if (!selectedIncidentId) return;
    try {
      setGenerating(true);
      setError(null);
      setExecutionResult(null);
      const res = await generateRecoveryOptions(eventId, selectedIncidentId);
      setOptions(res.items || []);
      setStateSnapshot(res.state_snapshot || "");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate recovery options";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRecalculate() {
    if (!selectedIncidentId) return;
    try {
      setGenerating(true);
      setError(null);
      const res = await recalculateRecoveryOptions(eventId, selectedIncidentId);
      setOptions(res.items || []);
      setStateSnapshot(res.state_snapshot || "");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to recalculate options";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleExecute(optionId: string) {
    try {
      setExecutingId(optionId);
      setError(null);
      const res = await executeRecoveryOption(eventId, optionId);
      setExecutionResult(res);

      if (res.decision?.requires_approval) {
        // Governance gate triggered
      } else if (res.execution?.status === "SUCCESS") {
        try {
          const trace = await getRecoveryDecisionTrace(eventId, selectedIncidentId);
          setDecisionTrace(trace && Object.keys(trace).length > 0 ? trace : null);
          if (trace?.verification) {
            setVerificationOutcome(trace.verification);
          }
        } catch {}
        await handleRecalculate();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      setError(msg);
    } finally {
      setExecutingId(null);
    }
  }

  const hasStaleOptions = options.some((o) => o.is_stale);
  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Wrench className="w-6 h-6 text-primary" />
              Adaptive Recovery & Rescheduling Engine
            </h1>
            {stateSnapshot && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50">
                Snapshot: {stateSnapshot.slice(0, 8)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Combinatorial search over candidate mitigation strategies: vendor substitution, CPM resequencing, and scope shedding.
          </p>
        </div>

        {/* Incident Switcher */}
        <div className="flex items-center gap-3">
          <select
            value={selectedIncidentId}
            onChange={(e) => setSelectedIncidentId(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-card border border-border/60 text-xs font-medium text-foreground"
          >
            {incidents.length === 0 ? (
              <option value="">No incidents recorded</option>
            ) : (
              incidents.map((inc) => (
                <option key={inc.id} value={inc.id}>
                  [{inc.severity}] {inc.title}
                </option>
              ))
            )}
          </select>

          <button
            onClick={handleGenerate}
            disabled={generating || !selectedIncidentId}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-colors"
          >
            <Sparkles className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Evaluating Candidates..." : "Generate Candidates"}
          </button>
        </div>
      </div>

      {/* Stale State Snapshot Warning */}
      {hasStaleOptions && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>State Drift Detected:</strong> Event operational state has mutated since these recovery options were generated. Options are marked STALE.
            </span>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={generating}
            className="px-3 py-1 rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-colors shrink-0"
          >
            Recalculate Stale Options
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={handleRecalculate}
            className="underline font-semibold hover:text-rose-200"
          >
            Recalculate
          </button>
        </div>
      )}

      {/* Execution / Governance Result Banner */}
      {executionResult && (
        <div
          className={`p-5 rounded-xl border ${
            executionResult.decision?.requires_approval
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          } space-y-3`}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-bold text-sm">
                {executionResult.decision?.requires_approval ? (
                  <>
                    <Shield className="w-4 h-4 text-amber-400" />
                    Separation of Duties Gate Triggered: Approval Required
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Recovery Plan Executed Successfully
                  </>
                )}
              </div>
              <p className="text-xs opacity-90">
                {executionResult.decision?.reason ||
                  "The state machine has executed changes and updated schedule & vendor assignments."}
              </p>
            </div>

            {executionResult.decision?.requires_approval ? (
              <button
                onClick={() =>
                  router.push(
                    `/events/${eventId}/approvals?approvalId=${executionResult.decision?.approval_request_id}`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 shadow-sm"
              >
                Review Approval Queue
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => router.push(`/events/${eventId}/live`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow-sm"
              >
                Inspect Live State
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Verification Status Banner */}
      {verificationOutcome && (
        <div
          className={`p-4 rounded-xl border ${
            verificationOutcome.status === "VERIFIED"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/40 bg-rose-500/10 text-rose-200"
          } space-y-2`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs">
              {verificationOutcome.status === "VERIFIED" ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  Deterministic Multi-Domain Verification: RECOVERY VERIFIED
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  Deterministic Multi-Domain Verification: RECOVERY FAILED
                </>
              )}
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40 border border-white/10 uppercase">
              {verificationOutcome.status}
            </span>
          </div>

          {verificationOutcome.failure_reasons?.length > 0 && (
            <div className="text-[11px] opacity-90 pl-6 space-y-1">
              <span className="font-semibold text-rose-300">Failure Diagnostics:</span>
              <ul className="list-disc pl-4 space-y-0.5">
                {verificationOutcome.failure_reasons.map((reason: string, rIdx: number) => (
                  <li key={rIdx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {verificationOutcome.status !== "VERIFIED" && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleRecalculate}
                className="px-3 py-1 rounded-lg bg-rose-500 text-white font-bold text-xs hover:bg-rose-400 transition-colors shadow-sm"
              >
                Attempt Alternative Strategy
              </button>
            </div>
          )}
        </div>
      )}

      {/* Decision Trace Stream (when available) */}
      {decisionTrace && (
        <div className="p-4 rounded-xl border border-primary/30 bg-card/60 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-foreground">
                Authoritative Decision Trace
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                ({decisionTrace.trace_id})
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              Verified: {decisionTrace.verification?.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2.5 rounded-lg bg-background/50 border border-border/40">
              <div className="text-muted-foreground uppercase text-[9px] font-semibold">1. Incident</div>
              <div className="font-bold text-foreground truncate">{decisionTrace.incident?.title || "Active Incident"}</div>
              <div className="text-[10px] text-muted-foreground">{decisionTrace.incident?.type}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-background/50 border border-border/40">
              <div className="text-muted-foreground uppercase text-[9px] font-semibold">2. Strategy</div>
              <div className="font-bold text-foreground">{decisionTrace.recovery_option?.strategy_type || "N/A"}</div>
              <div className="text-[10px] text-muted-foreground">Score: {decisionTrace.recovery_option?.score ?? "N/A"}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-background/50 border border-border/40">
              <div className="text-muted-foreground uppercase text-[9px] font-semibold">3. Governance</div>
              <div className="font-bold text-foreground">{decisionTrace.approval?.status || "DIRECT"}</div>
              <div className="text-[10px] text-muted-foreground">Level: {decisionTrace.approval?.impact_level || "STANDARD"}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-background/50 border border-border/40">
              <div className="text-muted-foreground uppercase text-[9px] font-semibold">4. Verification</div>
              <div className="font-bold text-emerald-400">{decisionTrace.verification?.status}</div>
              <div className="text-[10px] text-muted-foreground">State: {decisionTrace.event_state?.state_after}</div>
            </div>
          </div>
        </div>
      )}

      {/* Target Incident Context Badge */}
      {selectedIncident && (
        <div className="p-3.5 rounded-xl border border-border/50 bg-card/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground uppercase text-[10px]">
              Target Incident:
            </span>
            <span className="font-bold text-foreground">{selectedIncident.title}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
              {selectedIncident.incident_type}
            </span>
          </div>
          <span className="text-muted-foreground text-[11px]">
            Severity: {selectedIncident.severity}
          </span>
        </div>
      )}

      {/* Recovery Option Candidates List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Ranked Candidate Mitigations ({options.length})
          </h2>
          {options.length > 0 && (
            <button
              onClick={handleRecalculate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`w-3 h-3 ${generating ? "animate-spin" : ""}`} />
              Recalculate Feasibility
            </button>
          )}
        </div>

        {options.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-border/50 bg-card/30 space-y-4">
            <Sparkles className="w-10 h-10 text-primary/40 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                No Recovery Options Generated
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Trigger candidate evaluation to synthesize feasible solutions for the selected operational incident.
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedIncidentId}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {generating ? "Evaluating..." : "Generate Candidates Now"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {options.map((option, idx) => {
              const isExecuting = executingId === option.id;
              const scheduleDelta = option.schedule_delta as Record<string, any> | undefined;
              const budgetDelta = option.budget_delta as Record<string, any> | undefined;
              const riskBefore = option.risk_before as Record<string, any> | undefined;
              const riskAfter = option.risk_after as Record<string, any> | undefined;

              return (
                <div
                  key={option.id}
                  className={`p-5 rounded-2xl border transition-all space-y-4 ${
                    option.is_stale
                      ? "border-amber-500/30 bg-amber-500/5 opacity-80"
                      : idx === 0
                      ? "border-primary/50 bg-card shadow-lg ring-1 ring-primary/20"
                      : "border-border/50 bg-card/50 hover:border-border/80"
                  }`}
                >
                  {/* Top Bar of Candidate Card */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/30 pb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          idx === 0
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {idx === 0 ? "★ Optimal Strategy" : `Option #${idx + 1}`}
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {option.strategy_type.replace(/_/g, " ")}
                      </span>
                      {option.is_stale && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          STALE
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          option.is_feasible
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {option.is_feasible ? (
                          <CheckCircle className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        {option.is_feasible ? "FEASIBLE" : "INFEASIBLE"}
                      </span>
                      {option.score != null && (
                        <span className="text-xs font-mono font-semibold text-muted-foreground">
                          Score: {option.score.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Trade-off Delta Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-background/50 border border-border/40 space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3 text-blue-400" />
                        Schedule Delta
                      </div>
                      <div className="text-base font-bold text-foreground">
                        {scheduleDelta?.delay_minutes !== undefined
                          ? `+${scheduleDelta.delay_minutes}m`
                          : "0m delay"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        CPM forward-pass impact
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-background/50 border border-border/40 space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-emerald-400" />
                        Cost Delta
                      </div>
                      <div className="text-base font-bold text-foreground">
                        {budgetDelta?.cost_delta !== undefined
                          ? `+$${budgetDelta.cost_delta.toLocaleString()}`
                          : "$0 delta"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Additional commitment
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-background/50 border border-border/40 space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <TrendingDown className="w-3 h-3 text-rose-400" />
                        Risk Reduction
                      </div>
                      <div className="text-base font-bold text-emerald-400">
                        {riskBefore?.score !== undefined && riskAfter?.score !== undefined
                          ? `${riskBefore.score.toFixed(0)} → ${riskAfter.score.toFixed(0)}`
                          : "Calculated"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Downstream de-escalation
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-background/50 border border-border/40 space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Layers className="w-3 h-3 text-purple-400" />
                        Affected Tasks
                      </div>
                      <div className="text-base font-bold text-foreground">
                        {option.affected_tasks?.length || 0}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Reassigned / resynced
                      </div>
                    </div>
                  </div>

                  {/* Proposed Changes Preview */}
                  {option.proposed_changes &&
                    Object.keys(option.proposed_changes).length > 0 && (
                      <div className="p-3 rounded-xl bg-secondary/30 border border-border/40 space-y-1.5 text-xs">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Proposed Action Plan:
                        </span>
                        <div className="font-mono text-[11px] text-foreground/90 whitespace-pre-wrap">
                          {JSON.stringify(option.proposed_changes, null, 2)}
                        </div>
                      </div>
                    )}

                  {/* Action Execution Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/30">
                    <span className="text-[11px] text-muted-foreground">
                      Target incident: {selectedIncident?.title}
                    </span>

                    <button
                      onClick={() => handleExecute(option.id)}
                      disabled={isExecuting || option.is_stale}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl shadow-md transition-colors ${
                        option.is_stale
                          ? "bg-secondary text-muted-foreground cursor-not-allowed"
                          : idx === 0
                          ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/80 text-foreground border border-border/60"
                      }`}
                    >
                      <Zap className={`w-3.5 h-3.5 ${isExecuting ? "animate-spin" : ""}`} />
                      {isExecuting
                        ? "Submitting Action..."
                        : "Execute This Recovery Plan"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
