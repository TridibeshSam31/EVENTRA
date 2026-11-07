"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  Layers,
  Activity,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getDecisionTraces } from "@/lib/api/observability";
import type { DecisionTraceResponse } from "@/types/api";

interface OperationalTraceProps {
  eventId: string;
  className?: string;
}

interface TraceStep {
  name: string;
  key: string;
  data: Record<string, unknown> | null | undefined;
  required: boolean;
}

export function OperationalTrace({
  eventId,
  className = "",
}: OperationalTraceProps) {
  const [traces, setTraces] = useState<DecisionTraceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  useEffect(() => {
    async function loadTraces() {
      try {
        setLoading(true);
        const data = await getDecisionTraces(eventId);
        if (Array.isArray(data) && data.length > 0) {
          setTraces(data);
          setSelectedTraceId(data[0].trace_id);
        } else {
          setTraces([]);
        }
      } catch (err) {
        console.error("Failed to load decision traces:", err);
        setTraces([]);
      } finally {
        setLoading(false);
      }
    }
    loadTraces();
  }, [eventId]);

  const activeTrace = traces.find((t) => t.trace_id === selectedTraceId);

  const getTraceSteps = (trace?: DecisionTraceResponse): TraceStep[] => {
    if (!trace) return [];
    return [
      {
        name: "INCIDENT DETECTED",
        key: "incident",
        data: trace.incident,
        required: true,
      },
      {
        name: "IMPACT ANALYSIS",
        key: "impact_and_risk",
        data: trace.impact_and_risk && Object.keys(trace.impact_and_risk).length > 0 ? trace.impact_and_risk : null,
        required: true,
      },
      {
        name: "RECOVERY OPTION",
        key: "recovery_option",
        data: trace.recovery_option,
        required: true,
      },
      {
        name: "AUTHORIZATION / APPROVAL",
        key: "approval",
        data: trace.approval,
        required: true,
      },
      {
        name: "EXECUTION",
        key: "execution",
        data: trace.execution,
        required: true,
      },
      {
        name: "VERIFICATION",
        key: "verification",
        data: trace.verification && Object.keys(trace.verification).length > 0 ? trace.verification : null,
        required: true,
      },
    ];
  };

  const steps = getTraceSteps(activeTrace);

  return (
    <div className={`surface space-y-4 p-5 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 text-ink-50">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="eyebrow">Decision trace</div>
            <h3 className="mt-0.5 text-[14px] font-semibold text-ink-900">From problem to verified fix, step by step</h3>
            <p className="text-[12px] text-ink-500">Every step below is recorded by the backend. Steps that never happened stay empty.</p>
          </div>
        </div>

        {traces.length > 1 && (
          <select
            value={selectedTraceId || ""}
            onChange={(e) => setSelectedTraceId(e.target.value)}
            className="rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5 font-mono text-[11.5px] text-ink-700 focus:border-ink-400 focus:outline-none"
          >
            {traces.map((t) => (
              <option key={t.trace_id} value={t.trace_id}>
                Trace: {t.trace_id} ({t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : "No time"})
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center font-mono text-[11.5px] uppercase tracking-label text-ink-400">
          Loading traces…
        </div>
      ) : traces.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400 space-y-1">
          <p className="text-[13.5px] font-semibold text-ink-700">No decisions recorded yet</p>
          <p className="text-[12px] text-ink-500">
            When a problem is handled, each step from detection to verification will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-500">
            <span>Trace ID: {activeTrace?.trace_id}</span>
            <span>Verification: {activeTrace?.verification_id || "NOT RECORDED"}</span>
            <span>{activeTrace?.timestamp ? new Date(activeTrace.timestamp).toLocaleString() : ""}</span>
          </div>

          {/* Stepper Pipeline */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 pt-2">
            {steps.map((step, idx) => {
              const isRecorded = Boolean(step.data && Object.keys(step.data).length > 0);
              const isExpanded = expandedStep === step.key;

              return (
                <button
                  type="button"
                  key={step.key}
                  disabled={!isRecorded}
                  aria-expanded={isRecorded ? isExpanded : undefined}
                  onClick={() => isRecorded && setExpandedStep(isExpanded ? null : step.key)}
                  className={`relative flex flex-col justify-between overflow-hidden rounded-lg border p-3 text-left transition-all ${
                    isRecorded
                      ? isExpanded
                        ? "border-ink-900 bg-[#FDFCFA] shadow-md"
                        : "border-ink-200 bg-[#FDFCFA] hover:border-ink-300"
                      : "cursor-default border-dashed border-ink-300 bg-transparent"
                  }`}
                >
                  <span className={`absolute inset-x-0 bottom-0 h-[3px] ${isRecorded ? "bg-go-500" : "bg-transparent"}`} aria-hidden />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-slate-400">
                        0{idx + 1}
                      </span>
                      {isRecorded ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                    <div className={`font-display text-[13px] font-bold uppercase leading-tight tracking-[0.01em] ${isRecorded ? "text-ink-900" : "text-ink-400"}`} style={{ fontStretch: "88%" }}>
                      {step.name}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-dashed border-ink-200 pt-2">
                    <span
                      className={`font-mono text-[9.5px] font-semibold uppercase tracking-label ${
                        isRecorded ? "text-go-700" : "text-ink-400"
                      }`}
                    >
                      {isRecorded ? "Recorded" : "Not recorded"}
                    </span>
                    {isRecorded && (
                      <span className="text-[10px] text-slate-400">
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Expanded Step Evidence View */}
          {expandedStep && (
            <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow text-ink-700">
                  Step Evidence: {expandedStep.toUpperCase()}
                </span>
                <button
                  onClick={() => setExpandedStep(null)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Close Details
                </button>
              </div>
              <pre className="max-h-48 overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-ink-200">
                {JSON.stringify(activeTrace?.[expandedStep as keyof DecisionTraceResponse], null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
