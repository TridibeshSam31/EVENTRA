"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare,
  Bot,
  User,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  Clock,
  Sparkles,
  RefreshCw,
  PhoneCall,
  CheckCircle2,
} from "lucide-react";

import { listNegotiations, NegotiationSummary } from "@/lib/api/negotiations";
import { getEvent } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";
import { EventShell } from "@/components/v2/EventShell";
import { PageHeader, EmptyState, CueChip } from "@/components/ds";

export default function NegotiationsListPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [eventData, setEventData] = useState<EventResponse | null>(null);
  const [negotiations, setNegotiations] = useState<NegotiationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError(null);
      const [ev, negs] = await Promise.all([
        getEvent(eventId).catch(() => null),
        listNegotiations(eventId).catch(() => []),
      ]);
      if (ev) setEventData(ev);
      setNegotiations(negs || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load negotiations");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <EventShell event={eventData} eventId={eventId} currentStage="READY">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              Engage <span className="text-ink-300">/</span> Negotiations
            </span>
          }
          title="Live negotiations"
          description="The agent bargains with vendors on WhatsApp and by phone, never above your cap. Open one to watch it live or take over."
          actions={
            <button onClick={() => loadData()} className="btn-secondary">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          }
        />

        {error && (
          <div className="rounded-xl border border-cue-200 bg-cue-50 px-4 py-3 text-[13px] text-cue-800">{error}</div>
        )}

        {loading && negotiations.length === 0 ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((n) => (
              <div key={n} className="workspace-shimmer h-24 rounded-xl" />
            ))}
          </div>
        ) : negotiations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title="No negotiations running"
            description="When the agent engages a shortlisted vendor, the negotiation appears here in real time."
            action={
              <Link href={`/events/${eventId}/procurement`} className="btn-primary">
                Go to procurement
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {negotiations.map((neg) => {
              const isHuman = neg.control === "HUMAN";
              const isAwaitingApproval = neg.status === "AWAITING_APPROVAL" || Boolean(neg.approval_id);
              const capUse =
                neg.quoted_amount != null && neg.max_approved_amount
                  ? Math.min(130, (neg.quoted_amount / neg.max_approved_amount) * 100)
                  : null;
              const over = capUse != null && capUse > 100;

              return (
                <li key={neg.assignment_id}>
                  <Link
                    href={`/events/${eventId}/negotiations/${neg.assignment_id}`}
                    className="group surface relative flex flex-col gap-4 px-5 py-4 transition hover:border-ink-300 hover:shadow-md sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-ink-900">{neg.vendor_name}</h3>
                        <span className="font-mono text-[10.5px] uppercase text-ink-500">{neg.category}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {isHuman ? (
                          <CueChip tone="standby">
                            <User className="h-3 w-3" /> You&apos;re in control
                          </CueChip>
                        ) : (
                          <CueChip tone="agent" pulse>
                            <Bot className="h-3 w-3" /> Agent negotiating
                          </CueChip>
                        )}
                        <CueChip tone="idle">{String(neg.status).replace(/_/g, " ").toLowerCase()}</CueChip>
                        {neg.round_number > 0 && (
                          <span className="font-mono text-[11px] text-ink-500">round {neg.round_number}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex w-full items-center gap-5 sm:w-auto">
                      <div className="min-w-[180px] flex-1 sm:flex-none">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-400">Quote vs cap</span>
                          <span className={`font-display text-[17px] font-bold tabular-nums ${over ? "text-cue-700" : "text-ink-900"}`} style={{ fontStretch: "90%" }}>
                            {neg.quoted_amount != null ? `${neg.currency} ${neg.quoted_amount.toLocaleString()}` : "—"}
                          </span>
                        </div>
                        <div className="relative mt-1.5 h-1.5 rounded-full bg-ink-200/70">
                          {capUse != null && (
                            <div
                              className={`h-full rounded-full ${over ? "bg-cue-600" : "bg-go-500"}`}
                              style={{ width: `${Math.min(100, (capUse / 130) * 100)}%` }}
                            />
                          )}
                          {neg.max_approved_amount != null && (
                            <span className="absolute -top-1 h-3.5 w-[2px] bg-ink-900" style={{ left: `${(100 / 130) * 100}%` }} />
                          )}
                        </div>
                        <div className="mt-1 text-right font-mono text-[10.5px] text-ink-400">
                          {neg.max_approved_amount != null
                            ? `cap ${neg.currency} ${neg.max_approved_amount.toLocaleString()}`
                            : "no cap set"}
                        </div>
                      </div>
                      {isAwaitingApproval && (
                        <CueChip tone="go" className="hidden md:inline-flex">
                          <CheckCircle2 className="h-3 w-3" /> Ready to approve
                        </CueChip>
                      )}
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink-200 text-ink-400 transition group-hover:border-ink-900 group-hover:bg-ink-900 group-hover:text-ink-50">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </EventShell>
  );
}
