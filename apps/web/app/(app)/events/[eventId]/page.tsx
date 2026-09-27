"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Users,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Radio,
  Sparkles,
  Zap,
  Building2,
  Utensils,
  Camera,
  Music,
  Shield,
  Truck,
  Loader2,
} from "lucide-react";

import { getEvent, getEventOperationsStatus } from "@/lib/api/events";
import { EventHeader } from "@/components/v2/EventHeader";
import { AgentPanel } from "@/components/v2/AgentPanel";
import { AgentActivityStream } from "@/components/v2/AgentActivityStream";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  venue: Building2,
  catering: Utensils,
  photography: Camera,
  av_tech: Music,
  security: Shield,
  transport: Truck,
};

export default function EventOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.eventId as string;

  const [eventData, setEventData] = useState<any>(null);
  const [opsStatus, setOpsStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [ev, ops] = await Promise.allSettled([
        getEvent(eventId),
        getEventOperationsStatus(eventId),
      ]);

      if (ev.status === "fulfilled") {
        setEventData(ev.value);
      } else {
        throw ev.reason;
      }

      if (ops.status === "fulfilled") {
        setOpsStatus(ops.value);
      }
    } catch (err: any) {
      console.error("Failed to load event data:", err);
      setError(err?.message || "Failed to load event details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      fetchData();
    }
  }, [eventId]);

  if (loading && !eventData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <p className="text-xs text-zinc-400 uppercase tracking-widest font-mono">
            Loading Eventra Command Center...
          </p>
        </div>
      </div>
    );
  }

  const name = eventData?.name || "Corporate Event";
  const location = eventData?.location || "Delhi, India";
  const guestCount = eventData?.guest_count || 100;
  const totalBudget = Number(eventData?.total_budget) || 1000000;
  const committedBudget = Number(opsStatus?.committed_budget) || 0;
  const currency = eventData?.currency || "INR";
  const currencySym = currency === "INR" ? "₹" : "$";
  const lifecycleState = eventData?.lifecycle_state || "PLANNED";
  const state = eventData?.state || opsStatus?.state || "NORMAL";

  const budgetPct = totalBudget > 0 ? Math.min(100, Math.round((committedBudget / totalBudget) * 100)) : 0;

  const assignments = opsStatus?.assignments || [];
  const pendingApprovals = opsStatus?.pending_approvals || [];
  const tasks = opsStatus?.tasks || [];

  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETED").length;
  const blockedTasks = tasks.filter((t: any) => t.status === "BLOCKED").length;

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      {/* Top Header & Lifecycle Stepper */}
      <EventHeader
        eventId={eventId}
        name={name}
        startDate={eventData?.start_datetime}
        location={location}
        guestCount={guestCount}
        totalBudget={totalBudget}
        currency={currency}
        lifecycleState={lifecycleState}
        state={state}
        currentStage={lifecycleState === "LIVE" ? "LIVE" : state === "DEGRADED" ? "RECOVER" : "DISCOVER"}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Incident Alert Banner if in DEGRADED or DISRUPTED state */}
        {state !== "NORMAL" && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-300">
                  Adaptive Recovery Active ({state})
                </h3>
                <p className="text-xs text-rose-400/90 mt-0.5">
                  An operational disruption has occurred. Critical tasks are blocked pending emergency mitigation.
                </p>
              </div>
            </div>
            <Link
              href={`/events/${eventId}/recovery`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold shadow-lg shadow-rose-500/20 transition"
            >
              Resolve Incident <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Agent Command Center Panel */}
        <AgentPanel
          eventId={eventId}
          eventName={name}
          lifecycleState={lifecycleState}
          onOperationsStarted={() => fetchData()}
        />

        {/* 4 Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Budget Card */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/60 backdrop-blur-md">
            <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">Allocated Budget</span>
              <CreditCard className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl font-bold text-white tracking-tight">
              {currencySym}{committedBudget.toLocaleString()}
              <span className="text-xs text-zinc-500 font-normal ml-1.5">
                / {currencySym}{totalBudget.toLocaleString()}
              </span>
            </div>
            <div className="mt-3 w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-[10px] text-zinc-500 text-right">{budgetPct}% committed</div>
          </div>

          {/* 2. Operational Tasks */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/60 backdrop-blur-md">
            <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">Operational Plan</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-white tracking-tight">
              {completedTasks} / {tasks.length}
              <span className="text-xs text-zinc-500 font-normal ml-1.5">tasks done</span>
            </div>
            <div className="mt-2 text-xs flex items-center gap-2">
              {blockedTasks > 0 ? (
                <span className="text-rose-400 font-medium">⚠️ {blockedTasks} blocked</span>
              ) : (
                <span className="text-emerald-400 font-medium">✓ Critical path clear</span>
              )}
            </div>
          </div>

          {/* 3. Shortlisted Providers */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/60 backdrop-blur-md">
            <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">Providers Sourced</span>
              <Users className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl font-bold text-white tracking-tight">
              {assignments.length}
              <span className="text-xs text-zinc-500 font-normal ml-1.5">categories assigned</span>
            </div>
            <div className="mt-2 text-xs text-zinc-400 flex items-center gap-1">
              <Link
                href={`/events/${eventId}/vendors`}
                className="text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1"
              >
                Inspect live funnel <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* 4. Pending Approvals Gate */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/60 backdrop-blur-md">
            <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">Human Approval Gate</span>
              <ShieldCheck className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-white tracking-tight">
              {pendingApprovals.length}
              <span className="text-xs text-zinc-500 font-normal ml-1.5">pending sign-offs</span>
            </div>
            <div className="mt-2 text-xs text-zinc-400">
              {pendingApprovals.length > 0 ? (
                <Link
                  href={`/events/${eventId}/approvals`}
                  className="text-amber-400 hover:text-amber-300 font-medium inline-flex items-center gap-1"
                >
                  Review actions now <ArrowRight className="w-3 h-3" />
                </Link>
              ) : (
                <span className="text-zinc-500">All agent actions authorized</span>
              )}
            </div>
          </div>
        </div>

        {/* 2-Column Main Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2 Cols): Sourced Providers & Critical Tasks */}
          <div className="lg:col-span-2 space-y-6">
            {/* Category Sourcing Cards */}
            <div className="bg-zinc-950/80 border border-zinc-800/60 rounded-2xl p-5 backdrop-blur-md">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                    Operational Categories & Shortlists
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Live candidate status and contracted providers
                  </p>
                </div>
                <Link
                  href={`/events/${eventId}/vendors`}
                  className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  View All Candidates <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {assignments.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs">
                  No providers contracted yet. Click 'Start Autonomous Operations' above to dispatch live discovery.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {assignments.map((assign: any) => {
                    const cat = (assign.category || "other").toLowerCase();
                    const Icon = CATEGORY_ICONS[cat] || Building2;

                    return (
                      <div
                        key={assign.id}
                        className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/60 flex flex-col justify-between hover:border-zinc-700/60 transition group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-zinc-200">
                                {assign.vendor_name || "Assigned Provider"}
                              </div>
                              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">
                                {assign.category}
                              </div>
                            </div>
                          </div>

                          <ProvenanceBadge source={assign.source || "LIVE_SCRAPE"} size="sm" />
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800/40">
                          <span className="text-zinc-400">
                            {assign.agreed_cost ? `${currencySym}${Number(assign.agreed_cost).toLocaleString()}` : "Quoting"}
                          </span>
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            {assign.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Critical Path Tasks */}
            <div className="bg-zinc-950/80 border border-zinc-800/60 rounded-2xl p-5 backdrop-blur-md">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                    Critical Path Execution Schedule
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    High-impact dependencies actively monitored
                  </p>
                </div>
                <Link
                  href={`/events/${eventId}/plan`}
                  className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  Open DAG Plan <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="space-y-2">
                {tasks.slice(0, 5).map((task: any) => {
                  const isBlocked = task.status === "BLOCKED";
                  const isDone = task.status === "COMPLETED";

                  return (
                    <div
                      key={task.id}
                      className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/50 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isBlocked ? "bg-rose-400 animate-ping" : isDone ? "bg-emerald-400" : "bg-cyan-400"
                          }`}
                        />
                        <span className="font-medium text-zinc-200">{task.name}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {task.category && (
                          <span className="text-[10px] text-zinc-500 uppercase font-mono">
                            {task.category}
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            isBlocked
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : isDone
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column (1 Col): Live Unified Activity Stream */}
          <div className="space-y-6">
            <AgentActivityStream eventId={eventId} />
          </div>
        </div>
      </main>
    </div>
  );
}
