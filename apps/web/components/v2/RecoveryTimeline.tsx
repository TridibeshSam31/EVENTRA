"use client";

import React from "react";
import {
  AlertTriangle,
  Activity,
  Lightbulb,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Clock,
  HelpCircle,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface RecoveryTimelineStage {
  key: "INCIDENT" | "IMPACT" | "RECOVERY" | "APPROVAL" | "EXECUTION" | "VERIFICATION" | "RESTORED";
  title: string;
  status: "COMPLETED" | "IN_PROGRESS" | "FAILED" | "NOT_STARTED" | "SKIPPED";
  timestamp?: string | null;
  actor?: string | null;
  provenance?: string | null;
  detail?: string | null;
}

interface RecoveryTimelineProps {
  stages: RecoveryTimelineStage[];
  className?: string;
}

export function RecoveryTimeline({
  stages,
  className = "",
}: RecoveryTimelineProps) {
  const getStageIcon = (key: string, status: string) => {
    if (status === "COMPLETED") return CheckCircle2;
    if (status === "FAILED") return AlertTriangle;
    if (status === "IN_PROGRESS") return Clock;

    switch (key) {
      case "INCIDENT": return AlertTriangle;
      case "IMPACT": return Activity;
      case "RECOVERY": return Lightbulb;
      case "APPROVAL": return ShieldCheck;
      case "EXECUTION": return Zap;
      case "VERIFICATION": return CheckCircle2;
      case "RESTORED": return CheckCircle2;
      default: return HelpCircle;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "IN_PROGRESS":
        return "bg-blue-50 text-blue-700 border-blue-200 animate-pulse";
      case "FAILED":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "SKIPPED":
        return "bg-slate-50 text-slate-400 border-slate-200";
      default:
        return "bg-slate-50 text-slate-400 border-slate-200";
    }
  };

  return (
    <div className={`p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-[#D6003C]" />
            Closed-Loop Resolution Stepper
          </span>
          <h4 className="text-sm font-bold text-slate-900 mt-0.5">
            Operational Recovery Lifecycle
          </h4>
        </div>

        <span className="text-[10px] font-mono text-slate-400">
          7 Governance Gates
        </span>
      </div>

      {/* Horizontal / Wrapped Step Flow */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
        {stages.map((stage, idx) => {
          const Icon = getStageIcon(stage.key, stage.status);
          const badgeClass = getStatusBadge(stage.status);

          return (
            <div
              key={stage.key}
              className={`p-3 rounded-xl border transition flex flex-col justify-between space-y-2 ${
                stage.status === "COMPLETED"
                  ? "bg-white border-emerald-200/90 shadow-xs"
                  : stage.status === "IN_PROGRESS"
                  ? "bg-blue-50/20 border-blue-300 ring-1 ring-blue-300/40"
                  : stage.status === "FAILED"
                  ? "bg-rose-50/20 border-rose-300"
                  : "bg-slate-50/40 border-slate-200/60 opacity-70"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[9px] font-mono font-bold text-slate-400">
                    0{idx + 1}
                  </span>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.2 rounded border ${badgeClass}`}>
                    {stage.status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 mt-1">
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      stage.status === "COMPLETED"
                        ? "text-emerald-600"
                        : stage.status === "FAILED"
                        ? "text-rose-600"
                        : stage.status === "IN_PROGRESS"
                        ? "text-blue-600"
                        : "text-slate-400"
                    }`}
                  />
                  <h5 className="text-xs font-bold text-slate-900 truncate">
                    {stage.title}
                  </h5>
                </div>

                {stage.detail && (
                  <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                    {stage.detail}
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                <span>
                  {stage.timestamp
                    ? new Date(stage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Pending"}
                </span>
                {stage.provenance && (
                  <ProvenanceBadge source={stage.provenance} size="sm" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
