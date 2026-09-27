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
    <div className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
            <Layers className="w-4 h-4 text-[#D6003C]" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
              Operational Decision Trace
            </h3>
            <p className="text-[11px] text-slate-500">
              Authoritative backend step-by-step verification history
            </p>
          </div>
        </div>

        {traces.length > 1 && (
          <select
            value={selectedTraceId || ""}
            onChange={(e) => setSelectedTraceId(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 font-mono text-slate-700"
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
        <div className="py-8 text-center text-xs text-slate-400">
          Loading operational traces from backend...
        </div>
      ) : traces.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400 space-y-1">
          <p className="font-semibold text-slate-600">No Decision Traces Recorded</p>
          <p className="text-[11px]">
            No verified operational decision traces have been recorded by the backend for this event yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono">
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
                <div
                  key={step.key}
                  onClick={() => isRecorded && setExpandedStep(isExpanded ? null : step.key)}
                  className={`flex flex-col justify-between p-3 rounded-xl border transition-all ${
                    isRecorded
                      ? "border-emerald-200 bg-emerald-50/30 hover:border-emerald-300 cursor-pointer"
                      : "border-slate-200 bg-slate-50/50 opacity-70"
                  }`}
                >
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
                    <div className="text-[11px] font-semibold text-slate-800 uppercase tracking-tight leading-tight">
                      {step.name}
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        isRecorded ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {isRecorded ? "CONFIRMED" : "NOT RECORDED"}
                    </span>
                    {isRecorded && (
                      <span className="text-[10px] text-slate-400">
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expanded Step Evidence View */}
          {expandedStep && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Step Evidence: {expandedStep.toUpperCase()}
                </span>
                <button
                  onClick={() => setExpandedStep(null)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Close Details
                </button>
              </div>
              <pre className="text-[11px] font-mono text-slate-700 bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto max-h-48">
                {JSON.stringify(activeTrace?.[expandedStep as keyof DecisionTraceResponse], null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
