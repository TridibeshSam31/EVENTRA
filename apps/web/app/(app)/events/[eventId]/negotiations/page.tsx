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
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                Autonomous Engine
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight mt-1">
              Live Negotiations
            </h1>
            <p className="text-sm text-zinc-400">
              Real-time autonomous vendor price negotiations with budget cap guards & manual takeover.
            </p>
          </div>
          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Negotiations List */}
        {loading && negotiations.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-28 rounded-2xl bg-white/5 animate-pulse border border-white/5"
              />
            ))}
          </div>
        ) : negotiations.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl bg-white/[0.02] border border-white/5">
            <MessageSquare className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No Active Negotiations</h3>
            <p className="text-sm text-zinc-400 mt-1 max-w-sm mx-auto">
              When vendors are shortlisted or engaged from the procurement pipeline, active negotiations will appear here in real time.
            </p>
            <Link
              href={`/events/${eventId}/procurement`}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
            >
              Go to Procurement Pipeline
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-1">
            {negotiations.map((neg) => {
              const isHuman = neg.control === "HUMAN";
              const isAwaitingApproval =
                neg.status === "AWAITING_APPROVAL" || Boolean(neg.approval_id);

              return (
                <Link
                  key={neg.assignment_id}
                  href={`/events/${eventId}/negotiations/${neg.assignment_id}`}
                  className="group relative block p-5 rounded-2xl bg-gradient-to-b from-white/[0.06] to-white/[0.02] border border-white/10 hover:border-indigo-500/40 transition-all shadow-lg hover:shadow-indigo-500/5"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
                          {neg.vendor_name}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-medium">
                          {neg.category}
                        </span>
                        {/* Control Badge */}
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1.5 ${
                            isHuman
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {isHuman ? (
                            <>
                              <User className="w-3 h-3" />
                              MANUAL (YOU)
                            </>
                          ) : (
                            <>
                              <Bot className="w-3 h-3" />
                              AUTONOMOUS AGENT
                            </>
                          )}
                        </span>
                        {/* Status Badge */}
                        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-white/5">
                          {neg.status}
                        </span>
                      </div>

                      {/* Financials & Round */}
                      <div className="flex items-center gap-4 text-xs text-zinc-400 pt-1">
                        {neg.round_number > 0 && (
                          <span className="flex items-center gap-1 text-zinc-300 font-medium">
                            <Clock className="w-3.5 h-3.5 text-zinc-500" />
                            Round {neg.round_number}
                          </span>
                        )}
                        {neg.quoted_amount != null && (
                          <span>
                            Latest Quote:{" "}
                            <span className="font-semibold text-white">
                              {neg.currency} {neg.quoted_amount.toLocaleString()}
                            </span>
                          </span>
                        )}
                        {neg.max_approved_amount != null && (
                          <span>
                            Budget Cap:{" "}
                            <span className="font-semibold text-emerald-400">
                              {neg.currency} {neg.max_approved_amount.toLocaleString()}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      {isAwaitingApproval && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ready for Approval
                        </span>
                      )}
                      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-zinc-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </EventShell>
  );
}
