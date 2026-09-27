"use client";

import React from "react";
import {
  X,
  ShieldCheck,
  User,
  Bot,
  Activity,
  ArrowRight,
  ExternalLink,
  Clock,
  Layers,
  FileCheck,
  AlertTriangle,
  Database,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { AuditRecordResponse } from "@/types/api";

interface AuditEvidenceDrawerProps {
  record: AuditRecordResponse | null;
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AuditEvidenceDrawer({
  record,
  eventId,
  isOpen,
  onClose,
}: AuditEvidenceDrawerProps) {
  if (!isOpen || !record) return null;

  const actorType = (record.actor_type || "UNKNOWN").toUpperCase();
  const actorId = record.actor_id || "UNKNOWN ACTOR";

  const getActorIcon = (type: string) => {
    switch (type) {
      case "AGENT":
        return <Bot className="w-3.5 h-3.5 text-blue-600" />;
      case "HUMAN":
      case "ORGANIZER":
      case "USER":
        return <User className="w-3.5 h-3.5 text-emerald-600" />;
      case "ENGINE":
        return <Database className="w-3.5 h-3.5 text-indigo-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  // Determine target navigation if available
  const getTargetLink = (targetType?: string | null, targetId?: string | null) => {
    if (!targetType || !targetId) return null;
    const norm = targetType.toUpperCase();
    if (norm === "TASK") return `/events/${eventId}/tasks`;
    if (norm === "INCIDENT") return `/events/${eventId}/incidents`;
    if (norm === "APPROVAL") return `/events/${eventId}/approvals`;
    if (norm === "VENDOR" || norm === "PROVIDER") return `/events/${eventId}/procurement`;
    if (norm === "CONVERSATION" || norm === "MESSAGE") return `/events/${eventId}/conversations`;
    if (norm === "PLAN" || norm === "BLUEPRINT") return `/events/${eventId}/plan`;
    return null;
  };

  const targetLink = getTargetLink(record.target_type, record.target_id);

  // Derive provenance from backend actor_type or execution state
  const derivedProvenance =
    actorType === "AGENT"
      ? "AGENT"
      : actorType === "HUMAN"
      ? "HUMAN"
      : actorType === "ENGINE"
      ? "ENGINE"
      : record.execution_id
      ? "EXECUTED"
      : "UNKNOWN";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white border-l border-slate-200 shadow-2xl flex flex-col transform transition-transform duration-200 ease-in-out">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
            <Lock className="w-4 h-4 text-slate-700" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Audit Record Detail
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Read-Only
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-500">
              ID: {record.id || "UNKNOWN"}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Governance Notice Banner */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Audit records are read-only in this interface.</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Historical ledger entry recorded authoritatively by the EVENTRA backend engine.
          </p>
        </div>

        {/* Action & Category */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Action & Classification
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-sm font-semibold text-slate-900">
              {record.action || "UNKNOWN ACTION"}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {record.action_type || "UNKNOWN_TYPE"}
              </span>
              <ProvenanceBadge provenance={derivedProvenance} size="sm" />
              {record.impact_level && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  Impact: {record.impact_level}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actor Attribution */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Actor Attribution
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-400 text-[11px] block">Actor Identity:</span>
              <div className="flex items-center gap-1.5 font-medium text-slate-900 mt-1">
                {getActorIcon(actorType)}
                <span className="truncate">{actorId}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] block">Actor Type:</span>
              <span className="font-semibold text-slate-700 mt-1 inline-block">
                {actorType}
              </span>
            </div>
          </div>
        </div>

        {/* Timestamp */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Authoritative Timestamp
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1 text-xs">
            <div className="flex items-center gap-2 text-slate-800">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono text-slate-900">
                {record.created_at ? new Date(record.created_at).toLocaleString() : "UNKNOWN"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              ISO: {record.created_at || "UNKNOWN"}
            </div>
          </div>
        </div>

        {/* Target Entity Navigation */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Target Entity
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
                {record.target_type || "UNKNOWN TARGET"}
              </span>
              <span className="font-mono text-xs font-semibold text-slate-900">
                {record.target_id || "UNKNOWN"}
              </span>
            </div>
            {targetLink ? (
              <Link
                href={targetLink}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#D6003C] hover:underline"
              >
                <span>Navigate</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            ) : record.target_id ? (
              <span className="text-[11px] text-slate-400">Target Unlinked</span>
            ) : (
              <span className="text-[11px] text-slate-400">None</span>
            )}
          </div>
        </div>

        {/* Correlation IDs */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Correlation Identifiers
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Approval ID:</span>
              <span className="font-mono text-slate-800 font-medium">
                {record.approval_id || "UNKNOWN"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
              <span className="text-slate-500">Execution ID:</span>
              <span className="font-mono text-slate-800 font-medium">
                {record.execution_id || "UNKNOWN"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
              <span className="text-slate-500">Verification ID:</span>
              <span className="font-mono text-slate-800 font-medium">
                {record.verification_id || "UNKNOWN"}
              </span>
            </div>
          </div>
        </div>

        {/* State Transition (Before / After) */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            State Transition Diff
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                Before State
              </span>
              {record.before_state && Object.keys(record.before_state).length > 0 ? (
                <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto max-h-36">
                  {JSON.stringify(record.before_state, null, 2)}
                </pre>
              ) : (
                <span className="text-[11px] text-slate-400 italic">NOT RECORDED</span>
              )}
            </div>

            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                After State
              </span>
              {record.after_state && Object.keys(record.after_state).length > 0 ? (
                <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto max-h-36">
                  {JSON.stringify(record.after_state, null, 2)}
                </pre>
              ) : (
                <span className="text-[11px] text-slate-400 italic">NOT RECORDED</span>
              )}
            </div>
          </div>
        </div>

        {/* Failure Reason */}
        {record.failure_reason && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-rose-500">
              Failure Details
            </label>
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 font-mono">
              {record.failure_reason}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
