"use client";

import React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  Bot,
} from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface AgentActionResultProps {
  actionName: string;
  status: "SUCCEEDED" | "PENDING_APPROVAL" | "FAILED" | "BLOCKED" | "UNKNOWN" | string;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  error?: string | null;
  approvalId?: string | null;
  eventId: string;
  relatedEntityLink?: string | null;
  relatedEntityLabel?: string | null;
  className?: string;
}

export function AgentActionResult({
  actionName,
  status,
  summary,
  details,
  error,
  approvalId,
  eventId,
  relatedEntityLink,
  relatedEntityLabel,
  className = "",
}: AgentActionResultProps) {
  const normStatus = (status || "UNKNOWN").toUpperCase();

  const getStatusConfig = () => {
    switch (normStatus) {
      case "SUCCEEDED":
      case "SUCCESS":
      case "COMPLETED":
        return {
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
          icon: CheckCircle2,
          label: "Operation Succeeded",
        };
      case "PENDING_APPROVAL":
      case "WAITING_FOR_APPROVAL":
      case "REQUIRES_APPROVAL":
        return {
          bg: "bg-amber-50 text-amber-800 border-amber-200",
          icon: ShieldAlert,
          label: "Waiting For Human Approval",
        };
      case "FAILED":
      case "FAILURE":
      case "BLOCKED":
        return {
          bg: "bg-rose-50 text-rose-800 border-rose-200",
          icon: AlertTriangle,
          label: "Operation Failed / Blocked",
        };
      default:
        return {
          bg: "bg-slate-50 text-slate-800 border-slate-200",
          icon: Clock,
          label: normStatus,
        };
    }
  };

  const config = getStatusConfig();
  const StatusIcon = config.icon;

  return (
    <div className={`p-4 rounded-xl border ${config.bg} space-y-3 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {config.label}
          </span>
          <ProvenanceBadge provenance="AGENT" size="sm" />
        </div>

        <span className="font-mono text-[11px] font-semibold">
          Action: {actionName}
        </span>
      </div>

      {summary && (
        <p className="text-xs font-medium leading-relaxed">
          {summary}
        </p>
      )}

      {error && (
        <div className="p-2.5 rounded-lg bg-rose-100/60 border border-rose-200 text-xs font-mono text-rose-900">
          <span className="font-bold">Error: </span>
          {error}
        </div>
      )}

      {details && Object.keys(details).length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Factual Output Metadata
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {Object.entries(details).slice(0, 4).map(([k, v]) => (
              <div key={k} className="p-2 bg-white/80 rounded border border-slate-200/60">
                <span className="text-[10px] text-slate-500 font-mono block uppercase">
                  {k}
                </span>
                <span className="font-semibold text-slate-900 truncate block">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation / Approval Gating Action */}
      <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        {approvalId && (
          <Link
            href={`/events/${eventId}/approvals`}
            className="inline-flex items-center gap-1 font-semibold text-[#D6003C] hover:underline"
          >
            <span>Review Gate #{approvalId}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}

        {relatedEntityLink && (
          <Link
            href={relatedEntityLink}
            className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-slate-950 hover:underline"
          >
            <span>Inspect {relatedEntityLabel || "Entity"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
