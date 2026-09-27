"use client";

import React from "react";
import {
  X,
  Activity,
  Bot,
  User,
  PhoneCall,
  ExternalLink,
  Clock,
  Layers,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { ActivityLogItem } from "@/types/activityLog";

interface ActivityEvidenceDrawerProps {
  item: ActivityLogItem | null;
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ActivityEvidenceDrawer({
  item,
  eventId,
  isOpen,
  onClose,
}: ActivityEvidenceDrawerProps) {
  if (!isOpen || !item) return null;

  const actor = (item.actor || "UNKNOWN").toUpperCase();

  const getActorIcon = (act: string) => {
    switch (act) {
      case "AGENT":
        return <Bot className="w-3.5 h-3.5 text-blue-600" />;
      case "ORGANIZER":
      case "USER":
      case "HUMAN":
        return <User className="w-3.5 h-3.5 text-emerald-600" />;
      case "VENDOR":
        return <PhoneCall className="w-3.5 h-3.5 text-purple-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  // Determine target navigation based on category & ref_id
  const getRefLink = (category: string, refId?: string | null) => {
    if (!refId) return null;
    const cat = category.toUpperCase();
    if (cat === "PLANNING" || refId.startsWith("TSK-") || refId.startsWith("TASK-")) {
      return `/events/${eventId}/tasks`;
    }
    if (cat === "INCIDENT" || refId.startsWith("INC-")) {
      return `/events/${eventId}/incidents`;
    }
    if (cat === "APPROVAL" || refId.startsWith("APP-")) {
      return `/events/${eventId}/approvals`;
    }
    if (cat === "COMMUNICATION" || refId.startsWith("CONV-") || refId.startsWith("MSG-")) {
      return `/events/${eventId}/conversations`;
    }
    if (cat === "DISCOVERY" || refId.startsWith("VEN-") || refId.startsWith("VND-")) {
      return `/events/${eventId}/procurement`;
    }
    return null;
  };

  const refLink = getRefLink(item.category, item.ref_id);

  const derivedProvenance =
    actor === "AGENT"
      ? "AGENT"
      : actor === "ORGANIZER" || actor === "USER"
      ? "HUMAN"
      : actor === "VENDOR"
      ? "SOURCE"
      : "UNKNOWN";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white border-l border-slate-200 shadow-2xl flex flex-col transform transition-transform duration-200 ease-in-out">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-100 text-[#D6003C] border border-slate-200">
            <Activity className="w-4 h-4 text-[#D6003C]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Operational Activity Event
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              ID: {item.id || "UNKNOWN"}
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
        {/* Category & Action */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Operation Summary
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-sm font-semibold text-slate-900 leading-snug">
              {item.summary || item.action || "UNKNOWN OPERATION"}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {item.category || "UNKNOWN"}
              </span>
              <span className="text-[11px] font-mono text-slate-600">
                {item.action}
              </span>
              <ProvenanceBadge provenance={derivedProvenance} size="sm" />
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
              <span className="text-slate-400 text-[11px] block">Actor Type:</span>
              <div className="flex items-center gap-1.5 font-semibold text-slate-900 mt-1">
                {getActorIcon(actor)}
                <span>{actor || "UNKNOWN ACTOR"}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] block">Event Stage:</span>
              <span className="font-mono text-slate-700 mt-1 inline-block">
                LIVE_OPERATIONS
              </span>
            </div>
          </div>
        </div>

        {/* Authoritative Timestamp */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Authoritative Timestamp
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1 text-xs">
            <div className="flex items-center gap-2 text-slate-800">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono text-slate-900">
                {item.timestamp ? new Date(item.timestamp).toLocaleString() : "UNKNOWN"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              ISO: {item.timestamp || "UNKNOWN"}
            </div>
          </div>
        </div>

        {/* Reference Object Navigation */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Related Entity Reference
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
                Ref ID
              </span>
              <span className="font-mono text-xs font-semibold text-slate-900">
                {item.ref_id || "None"}
              </span>
            </div>
            {refLink ? (
              <Link
                href={refLink}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#D6003C] hover:underline"
              >
                <span>Navigate</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            ) : item.ref_id ? (
              <span className="text-[11px] text-slate-400">Target Unlinked</span>
            ) : (
              <span className="text-[11px] text-slate-400">No entity reference</span>
            )}
          </div>
        </div>

        {/* Metadata Details Payload */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Metadata Details
          </label>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs">
            {item.details && Object.keys(item.details).length > 0 ? (
              <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto max-h-56">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            ) : (
              <span className="text-[11px] text-slate-400 italic">
                No extra metadata recorded.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
