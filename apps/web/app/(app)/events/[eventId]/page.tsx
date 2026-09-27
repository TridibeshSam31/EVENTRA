"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  CheckCircle2,
  Users,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Building2,
  Utensils,
  Camera,
  Music,
  Shield,
  Truck,
  Loader2,
} from "lucide-react";

import { getEvent, getEventOperationsStatus } from "@/lib/api/events";
import { EventShell } from "@/components/v2/EventShell";
import { AgentPanel } from "@/components/v2/AgentPanel";
import { AgentActivityStream } from "@/components/v2/AgentActivityStream";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import type { LifecycleStage } from "@/components/v2/LifecycleStepper";

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
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 text-[#D6003C] animate-spin" />
          <p className="text-xs text-slate-500 font-medium">
            Loading Event Workspace...
          </p>
        </div>
      </div>
    );
  }

  const name = eventData?.name || "Event Overview";
  const totalBudget = Number(eventData?.total_budget) || 0;
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

  const currentStage: LifecycleStage =
    lifecycleState === "LIVE" ? "LIVE" : state === "DEGRADED" ? "RECOVER" : "DISCOVER";

  return (
    <EventShell eventId={eventId} currentStage={currentStage} event={eventData}>
      {/* Incident Alert Banner if in DEGRADED or DISRUPTED state */}
      {state !== "NORMAL" && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-100 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-900">
                Operational Disruption Active ({state})
              </h3>
              <p className="text-xs text-rose-700 mt-0.5">
                Critical tasks are currently affected. Adaptive mitigation options are available.
              </p>
            </div>
          </div>
          <Link
            href={`/events/${eventId}/recovery`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition"
          >
            Review Recovery <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Agent Command Center Panel */}
      <AgentPanel
        eventId={eventId}
        eventName={name}
        lifecycleState={lifecycleState}
        pendingApprovalsCount={pendingApprovals.length}
        latestOperation={opsStatus?.activity_feed?.[0]?.action || null}
        latestResult={opsStatus?.activity_feed?.[0]?.detail || null}
        onOperationsStarted={() => fetchData()}
      />

      {/* 4 Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Budget Card */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-semibold uppercase tracking-wider">Allocated Budget</span>
            <CreditCard className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 tracking-tight">
            {currencySym}{committedBudget.toLocaleString()}
            <span className="text-xs text-slate-500 font-normal ml-1.5">
              / {totalBudget > 0 ? `${currencySym}${totalBudget.toLocaleString()}` : "Not set"}
            </span>
          </div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#D6003C] h-full rounded-full transition-all duration-300"
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-slate-500 text-right">{budgetPct}% committed</div>
        </div>

        {/* 2. Operational Tasks */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-semibold uppercase tracking-wider">Operational Plan</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 tracking-tight">
            {completedTasks} / {tasks.length}
            <span className="text-xs text-slate-500 font-normal ml-1.5">tasks done</span>
          </div>
          <div className="mt-2 text-xs flex items-center gap-2">
            {blockedTasks > 0 ? (
              <span className="text-rose-600 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {blockedTasks} blocked
              </span>
            ) : (
              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Critical path clear
              </span>
            )}
          </div>
        </div>

        {/* 3. Shortlisted Providers */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-semibold uppercase tracking-wider">Providers Sourced</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 tracking-tight">
            {assignments.length}
            <span className="text-xs text-slate-500 font-normal ml-1.5">assigned</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
            <Link
              href={`/events/${eventId}/vendors`}
              className="text-[#D6003C] hover:underline font-semibold inline-flex items-center gap-1"
            >
              Inspect live funnel <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* 4. Pending Approvals Gate */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-semibold uppercase tracking-wider">Human Approvals</span>
            <ShieldCheck className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 tracking-tight">
            {pendingApprovals.length}
            <span className="text-xs text-slate-500 font-normal ml-1.5">pending sign-offs</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {pendingApprovals.length > 0 ? (
              <Link
                href={`/events/${eventId}/approvals`}
                className="text-amber-600 hover:underline font-semibold inline-flex items-center gap-1"
              >
                Review actions now <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <span className="text-slate-400">All actions authorized</span>
            )}
          </div>
        </div>
      </div>

      {/* 2-Column Main Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Sourced Providers & Critical Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Category Sourcing Cards */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Operational Categories & Shortlists
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live candidate status and contracted providers
                </p>
              </div>
              <Link
                href={`/events/${eventId}/vendors`}
                className="text-xs font-semibold text-[#D6003C] hover:underline flex items-center gap-1"
              >
                View Sourcing <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {assignments.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No providers assigned yet. Use Discovery to qualify and shortlist event partners.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {assignments.map((assign: any) => {
                  const cat = (assign.category || "other").toLowerCase();
                  const Icon = CATEGORY_ICONS[cat] || Building2;

                  return (
                    <div
                      key={assign.id}
                      className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between hover:border-slate-300 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-md bg-white border border-slate-200 text-slate-700 shadow-2xs">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-900">
                              {assign.vendor_name || "Assigned Provider"}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                              {assign.category}
                            </div>
                          </div>
                        </div>

                        <ProvenanceBadge source={assign.source || "LIVE_SCRAPE"} size="sm" />
                      </div>

                      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/60">
                        <span className="text-slate-600 font-medium">
                          {assign.agreed_cost ? `${currencySym}${Number(assign.agreed_cost).toLocaleString()}` : "Quoting"}
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
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
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Critical Path Execution Schedule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  High-impact dependencies actively monitored
                </p>
              </div>
              <Link
                href={`/events/${eventId}/plan`}
                className="text-xs font-semibold text-[#D6003C] hover:underline flex items-center gap-1"
              >
                Open Plan <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="space-y-2">
              {tasks.length === 0 ? (
                <div className="py-6 text-center text-slate-400 text-xs">
                  No execution tasks scheduled.
                </div>
              ) : (
                tasks.slice(0, 5).map((task: any) => {
                  const isBlocked = task.status === "BLOCKED";
                  const isDone = task.status === "COMPLETED";

                  return (
                    <div
                      key={task.id}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isBlocked ? "bg-rose-500" : isDone ? "bg-emerald-500" : "bg-blue-500"
                          }`}
                        />
                        <span className="font-medium text-slate-800">{task.name}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {task.category && (
                          <span className="text-[10px] text-slate-500 uppercase font-mono">
                            {task.category}
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            isBlocked
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : isDone
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Live Unified Activity Stream */}
        <div className="space-y-6">
          <AgentActivityStream eventId={eventId} />
        </div>
      </div>
    </EventShell>
  );
}
