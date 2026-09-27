"use client";

import React from "react";
import {
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  PhoneMissed,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  FileText,
  RotateCcw,
} from "lucide-react";

export type CallState =
  | "QUEUED"
  | "RINGING"
  | "CONNECTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "NO_ANSWER"
  | "BUSY"
  | "CANCELED"
  | "UNKNOWN";

export interface CallExecutionData {
  id?: string;
  provider_name?: string | null;
  recipient_phone?: string | null;
  status: CallState | string;
  start_time?: string | null;
  duration_seconds?: number | null;
  transcript?: string | null;
  transcript_available?: boolean;
  outcome?: string | null;
  error?: string | null;
  source?: string | null;
}

interface CallExecutionCardProps {
  call: CallExecutionData;
  onRetryCall?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export function normalizeCallState(rawState?: string | null): CallState {
  if (!rawState) return "UNKNOWN";
  const s = rawState.toUpperCase().trim();
  if (s === "QUEUED" || s === "INITIATED") return "QUEUED";
  if (s === "RINGING") return "RINGING";
  if (s === "CONNECTED") return "CONNECTED";
  if (s === "IN_PROGRESS" || s === "IN-PROGRESS" || s === "ACTIVE") return "IN_PROGRESS";
  if (s === "COMPLETED" || s === "SUCCESS") return "COMPLETED";
  if (s === "FAILED" || s === "ERROR") return "FAILED";
  if (s === "NO_ANSWER" || s === "NO-ANSWER") return "NO_ANSWER";
  if (s === "BUSY") return "BUSY";
  if (s === "CANCELED" || s === "CANCELLED") return "CANCELED";
  return "UNKNOWN";
}

export function CallExecutionCard({
  call,
  onRetryCall,
  isRetrying = false,
  className = "",
}: CallExecutionCardProps) {
  const normState = normalizeCallState(call.status);

  const config = {
    QUEUED: {
      label: "Call Queued",
      icon: Clock,
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
      iconColor: "text-amber-600",
    },
    RINGING: {
      label: "Ringing",
      icon: PhoneForwarded,
      badgeClass: "bg-blue-50 text-blue-700 border-blue-200 animate-pulse",
      iconColor: "text-blue-600",
    },
    CONNECTED: {
      label: "Connected",
      icon: PhoneCall,
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconColor: "text-emerald-600",
    },
    IN_PROGRESS: {
      label: "Call In Progress",
      icon: PhoneCall,
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconColor: "text-emerald-600",
    },
    COMPLETED: {
      label: "Completed",
      icon: CheckCircle2,
      badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
      iconColor: "text-emerald-600",
    },
    FAILED: {
      label: "Call Failed",
      icon: AlertCircle,
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
      iconColor: "text-rose-600",
    },
    NO_ANSWER: {
      label: "No Answer",
      icon: PhoneMissed,
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      iconColor: "text-amber-600",
    },
    BUSY: {
      label: "Line Busy",
      icon: PhoneOff,
      badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
      iconColor: "text-slate-500",
    },
    CANCELED: {
      label: "Canceled",
      icon: PhoneOff,
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
      iconColor: "text-slate-500",
    },
    UNKNOWN: {
      label: "Call State Unavailable",
      icon: HelpCircle,
      badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
      iconColor: "text-slate-400",
    },
  }[normState];

  const Icon = config.icon;

  const formatDuration = (sec?: number | null) => {
    if (sec == null) return "Unavailable";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  };

  return (
    <div
      className={`p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2.5 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-100 border border-slate-200">
            <Icon className={`w-4 h-4 ${config.iconColor}`} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 leading-tight">
              {call.provider_name || "Voice Telephony Session"}
            </h4>
            <span className="text-[10px] text-slate-500 font-mono">
              Target: {call.recipient_phone || "UNKNOWN"}
            </span>
          </div>
        </div>

        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${config.badgeClass}`}
        >
          {config.label}
        </span>
      </div>

      {/* Operational Telemetry Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
        <div>
          <span className="text-[10px] text-slate-400 font-medium block">Initiated</span>
          <span className="text-[11px] font-mono font-semibold text-slate-700">
            {call.start_time
              ? new Date(call.start_time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "UNKNOWN"}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 font-medium block">Duration</span>
          <span className="text-[11px] font-mono font-semibold text-slate-700">
            {formatDuration(call.duration_seconds)}
          </span>
        </div>
      </div>

      {/* Transcript or Outcome */}
      {call.transcript ? (
        <div className="p-2 rounded bg-slate-50 border border-slate-200 text-xs space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 uppercase">
            <FileText className="w-3 h-3 text-slate-400" />
            <span>Call Transcript</span>
          </div>
          <p className="text-[11px] text-slate-700 italic line-clamp-3">
            "{call.transcript}"
          </p>
        </div>
      ) : (
        <div className="text-[10px] text-slate-400 flex items-center gap-1 px-1">
          <FileText className="w-3 h-3" />
          <span>Transcript: {call.transcript_available ? "Available in logs" : "Unavailable"}</span>
        </div>
      )}

      {/* Error or Retry */}
      {call.error && (
        <p className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded border border-rose-200">
          {call.error}
        </p>
      )}

      {onRetryCall && (normState === "FAILED" || normState === "NO_ANSWER" || normState === "BUSY") && (
        <button
          onClick={onRetryCall}
          disabled={isRetrying}
          className="w-full mt-1 py-1.5 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 transition disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
          <span>{isRetrying ? "Re-initiating Call..." : "Retry Telephony Call"}</span>
        </button>
      )}
    </div>
  );
}
