"use client";

import React from "react";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  ExternalLink,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface ProviderContextData {
  id: string;
  name: string;
  category: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  maps_url?: string | null;
  provenance?: string | null;
  rating?: number | null;
  review_count?: number | null;
  discovery_score?: number | null;
  communication_state?: string | null;
  last_contact_at?: string | null;
  response_state?: string | null;
  approval_required?: boolean;
  approval_id?: string | null;
}

interface ProviderContextPanelProps {
  provider?: ProviderContextData | null;
  eventId: string;
  onInitiateCall?: (provider: ProviderContextData) => void;
  onSendWhatsApp?: (provider: ProviderContextData) => void;
  onRequestApproval?: (provider: ProviderContextData) => void;
  isActionInProgress?: boolean;
  className?: string;
}

export function ProviderContextPanel({
  provider,
  eventId,
  onInitiateCall,
  onSendWhatsApp,
  onRequestApproval,
  isActionInProgress = false,
  className = "",
}: ProviderContextPanelProps) {
  if (!provider) {
    return (
      <div className={`p-5 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-400 ${className}`}>
        <Building2 className="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p className="font-semibold text-slate-600">No Provider Selected</p>
        <p className="text-[11px] text-slate-400 mt-1">
          Select a provider thread from the list to inspect context and contact channels.
        </p>
      </div>
    );
  }

  const hasPhone = Boolean(provider.phone && provider.phone.trim() !== "");
  const hasWebsite = Boolean(provider.website && provider.website.trim() !== "");

  return (
    <div
      className={`p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 ${className}`}
    >
      {/* 1. Header / Identity */}
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            {provider.category || "PROVIDER"}
          </span>
          <ProvenanceBadge source={provider.provenance || "LIVE_SCRAPE"} size="sm" />
          {provider.discovery_score != null && (
            <span className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              {Math.round(provider.discovery_score)} pts
            </span>
          )}
        </div>

        <h3 className="text-sm font-bold text-slate-900 tracking-tight">
          {provider.name}
        </h3>

        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{provider.address || provider.city || "UNKNOWN"}</span>
        </div>
      </div>

      {/* Approval Required Banner */}
      {provider.approval_required && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>APPROVAL REQUIRED</span>
          </div>
          <p className="text-[11px] text-amber-700">
            Formal human approval is required before binding or committing financial engagement for this provider.
          </p>
          {provider.approval_id && (
            <Link
              href={`/events/${eventId}/approvals`}
              className="inline-block text-[11px] font-semibold text-[#D6003C] hover:underline mt-1"
            >
              View Pending Approval Request &rarr;
            </Link>
          )}
        </div>
      )}

      {/* 2. Direct Contact Channels */}
      <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
          Contact Channels
        </span>

        <div className="space-y-1.5 text-slate-600">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-500">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              <span>Direct Phone</span>
            </span>
            <span className="font-mono text-[11px] font-semibold text-slate-800">
              {provider.phone || "UNKNOWN"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-500">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              <span>Email</span>
            </span>
            <span className="font-mono text-[11px] text-slate-800">
              {provider.email || "UNKNOWN"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-500">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>Website</span>
            </span>
            {hasWebsite ? (
              <a
                href={provider.website as string}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[#D6003C] hover:underline flex items-center gap-0.5 truncate max-w-[140px]"
              >
                <span>Visit URL</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : (
              <span className="text-[11px] text-slate-400">UNKNOWN</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Engagement & Response Telemetry */}
      <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
          Engagement Telemetry
        </span>

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-400 block font-medium">Outreach State</span>
            <span className="font-semibold text-slate-800 text-[11px] uppercase">
              {provider.communication_state || "UNKNOWN"}
            </span>
          </div>

          <div className="p-2 rounded bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-400 block font-medium">Provider Status</span>
            <span className="font-semibold text-slate-800 text-[11px] uppercase">
              {provider.response_state || "NOT CONTACTED"}
            </span>
          </div>
        </div>

        {provider.last_contact_at && (
          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Last contact: {new Date(provider.last_contact_at).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* 4. Outreach Actions */}
      <div className="pt-3 border-t border-slate-100 space-y-2">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
          Outreach Actions
        </span>

        <div className="grid grid-cols-2 gap-2">
          {/* Send WhatsApp */}
          <button
            onClick={() => onSendWhatsApp && onSendWhatsApp(provider)}
            disabled={!hasPhone || isActionInProgress}
            className="w-full py-2 px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={!hasPhone ? "No supported phone channel available" : undefined}
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            <span>WhatsApp</span>
          </button>

          {/* Initiate Telephony Call */}
          <button
            onClick={() => onInitiateCall && onInitiateCall(provider)}
            disabled={!hasPhone || isActionInProgress}
            className="w-full py-2 px-2.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={!hasPhone ? "No supported phone channel available" : undefined}
          >
            <PhoneCall className="w-3.5 h-3.5 text-purple-600" />
            <span>Voice Call</span>
          </button>
        </div>

        {/* Request Approval if needed */}
        {provider.approval_required && (
          <button
            onClick={() => onRequestApproval && onRequestApproval(provider)}
            disabled={isActionInProgress}
            className="w-full py-2 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
            <span>Submit for Formal Approval</span>
          </button>
        )}

        {!hasPhone && (
          <p className="text-[10px] text-slate-400 italic text-center">
            No supported contact channel available for automated dispatch.
          </p>
        )}
      </div>
    </div>
  );
}
