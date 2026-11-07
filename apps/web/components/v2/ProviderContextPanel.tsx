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
  Clock,
  Star,
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

function humanize(s?: string | null) {
  if (!s) return null;
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2 text-[12.5px] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

const Unknown = () => <span className="text-[12px] italic text-ink-400">Not provided</span>;

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
      <div
        className={`flex flex-col items-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-5 py-10 text-center ${className}`}
      >
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-400 shadow-sm">
          <Building2 className="h-5 w-5" />
        </div>
        <p className="text-[14px] font-semibold text-ink-900">No provider selected</p>
        <p className="mt-1 max-w-[30ch] text-[12.5px] text-ink-500">
          Pick a conversation to see the provider&apos;s details and contact channels.
        </p>
      </div>
    );
  }

  const hasPhone = Boolean(provider.phone && provider.phone.trim() !== "");
  const hasWebsite = Boolean(provider.website && provider.website.trim() !== "");
  const outreach = humanize(provider.communication_state);
  const response = humanize(provider.response_state) || "Not contacted";

  const channelBtn =
    "flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12.5px] font-semibold transition disabled:cursor-not-allowed";

  return (
    <div className={`surface overflow-hidden ${className}`}>
      {/* Identity */}
      <div className="px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip border-ink-200 bg-ink-100/70 text-ink-600">{humanize(provider.category) || "Provider"}</span>
          <ProvenanceBadge source={provider.provenance || "UNKNOWN"} size="sm" />
        </div>
        <h3
          className="mt-2 font-display text-[19px] font-bold leading-tight tracking-[-0.015em] text-ink-900"
          style={{ fontStretch: "90%" }}
        >
          {provider.name}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-500">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span className="truncate">{provider.address || provider.city || "Location unknown"}</span>
        </p>

        {(provider.discovery_score != null || provider.rating != null) && (
          <div className="mt-3 flex items-center gap-4">
            {provider.discovery_score != null && (
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Match</div>
                <div className="font-display text-[20px] font-bold leading-none tabular-nums text-ink-900" style={{ fontStretch: "88%" }}>
                  {Math.round(provider.discovery_score)}
                  <span className="text-[12px] text-ink-400">/100</span>
                </div>
              </div>
            )}
            {provider.rating != null && (
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Rating</div>
                <div className="flex items-center gap-1 text-[15px] font-bold text-ink-900">
                  <Star className="h-3.5 w-3.5 fill-standby-400 text-standby-400" />
                  {provider.rating.toFixed(1)}
                  {provider.review_count != null && (
                    <span className="text-[11px] font-normal text-ink-400">({provider.review_count})</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Approval */}
      {provider.approval_required && (
        <div className="mx-4 mb-4 rounded-xl border border-standby-200 bg-standby-50 p-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-standby-900">
            <span className="cue-light bg-standby-500 animate-cue-blink" />
            Approval required
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-standby-800">
            A person must approve before this provider is booked or any money is committed.
          </p>
          {provider.approval_id && (
            <Link
              href={`/events/${eventId}/approvals`}
              className="mt-2 inline-flex text-[12px] font-semibold text-ink-900 underline decoration-standby-400 underline-offset-2 hover:decoration-ink-900"
            >
              Open the approval request →
            </Link>
          )}
        </div>
      )}

      {/* Channels */}
      <div className="border-t border-ink-200 px-4 py-3">
        <div className="eyebrow mb-1">Contact</div>
        <div className="ruled">
          <Row icon={<Phone className="h-3.5 w-3.5" />} label="Phone">
            {provider.phone ? <span className="font-mono text-[12px] font-semibold text-ink-900">{provider.phone}</span> : <Unknown />}
          </Row>
          <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email">
            {provider.email ? <span className="font-mono text-[12px] text-ink-800">{provider.email}</span> : <Unknown />}
          </Row>
          <Row icon={<Globe className="h-3.5 w-3.5" />} label="Website">
            {hasWebsite ? (
              <a
                href={provider.website as string}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-800 hover:text-cue-700 hover:underline"
              >
                Visit <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <Unknown />
            )}
          </Row>
        </div>
      </div>

      {/* Engagement status */}
      <div className="border-t border-ink-200 px-4 py-3">
        <div className="eyebrow mb-2">Engagement</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-ink-200">
          <div className="bg-ink-50 px-3 py-2">
            <div className="text-[11px] text-ink-500">Outreach</div>
            <div className={`text-[13px] font-semibold ${outreach ? "text-ink-900" : "italic font-normal text-ink-400"}`}>
              {outreach || "Unknown"}
            </div>
          </div>
          <div className="bg-ink-50 px-3 py-2">
            <div className="text-[11px] text-ink-500">Provider</div>
            <div className="text-[13px] font-semibold text-ink-900">{response}</div>
          </div>
        </div>
        {provider.last_contact_at && (
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
            <Clock className="h-3 w-3" />
            Last contact {new Date(provider.last_contact_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2 border-t border-ink-200 bg-ink-50/60 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSendWhatsApp && onSendWhatsApp(provider)}
            disabled={!onSendWhatsApp || !hasPhone || isActionInProgress}
            className={`${channelBtn} border-ink-200 bg-[#FDFCFA] text-ink-800 hover:border-ink-300 disabled:text-ink-400 disabled:hover:border-ink-200`}
          >
            <MessageSquare className="h-3.5 w-3.5 text-go-600" />
            WhatsApp
          </button>
          <button
            type="button"
            onClick={() => onInitiateCall && onInitiateCall(provider)}
            disabled={!onInitiateCall || !hasPhone || isActionInProgress}
            className={`${channelBtn} border-ink-200 bg-[#FDFCFA] text-ink-800 hover:border-ink-300 disabled:text-ink-400 disabled:hover:border-ink-200`}
          >
            <PhoneCall className="h-3.5 w-3.5 text-agent-600" />
            Call
          </button>
        </div>

        {provider.approval_required && (
          <button
            onClick={() => onRequestApproval && onRequestApproval(provider)}
            disabled={isActionInProgress}
            className="btn w-full border border-standby-300 bg-standby-50 text-standby-900 hover:bg-standby-100"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-standby-700" />
            Submit for approval
          </button>
        )}

        {!hasPhone && (
          <p className="text-center text-[11.5px] italic text-ink-400">
            No phone number on record, so automated outreach isn&apos;t available.
          </p>
        )}
      </div>
    </div>
  );
}
