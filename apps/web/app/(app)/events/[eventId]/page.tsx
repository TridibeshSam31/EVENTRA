"use client";

import React, { useState, useMemo } from "react";
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
  Sparkles,
  MapPin,
  Phone,
  MessageSquare,
  Star,
  Check,
  Compass,
} from "lucide-react";


import { useEventWorkspace } from "@/hooks/useEventWorkspace";
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
  decor: Sparkles,
  security: Shield,
  transport: Truck,
  other: Compass,
};

export default function EventOverviewPage() {
  const params = useParams();
  const eventId = params.eventId as string;

  // Canonical workspace source of truth (single consolidated fetch)
  const {
    event,
    opsStatus,
    shortlist,
    approvals,
    isLoading,
    isAgentRunning,
    isWaitingForSelection,
    agentMessage,
    refreshWorkspace,
    selectCandidate,
    approveCommunication,
    dismissCommunication,
  } = useEventWorkspace(eventId);

  const [selectingCandidateId, setSelectingCandidateId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [approvingCandidateId, setApprovingCandidateId] = useState<string | null>(null);
  const [dismissingCandidateId, setDismissingCandidateId] = useState<string | null>(null);
  const [commActionError, setCommActionError] = useState<string | null>(null);

  const handleApproveCommunication = async (candidateId: string) => {
    try {
      setApprovingCandidateId(candidateId);
      setCommActionError(null);
      await approveCommunication(candidateId);
    } catch (err: any) {
      console.error("Communication approval failed:", err);
      setCommActionError(err?.message || "Failed to approve communication.");
    } finally {
      setApprovingCandidateId(null);
    }
  };

  const handleDismissCommunication = async (candidateId: string) => {
    try {
      setDismissingCandidateId(candidateId);
      setCommActionError(null);
      await dismissCommunication(candidateId);
    } catch (err: any) {
      console.error("Communication dismiss failed:", err);
      setCommActionError(err?.message || "Failed to dismiss communication.");
    } finally {
      setDismissingCandidateId(null);
    }
  };


  const name = event?.name || "Event Overview";
  const totalBudget = Number(event?.total_budget) || 0;
  const committedBudget = Number(opsStatus?.committed_budget) || 0;
  const currency = event?.currency || "INR";
  const currencySym = currency === "INR" ? "₹" : "$";
  const lifecycleState = event?.lifecycle_state || "PLANNED";
  const state = event?.state || opsStatus?.state || "NORMAL";

  const budgetPct = totalBudget > 0 ? Math.min(100, Math.round((committedBudget / totalBudget) * 100)) : 0;
  const assignments = opsStatus?.assignments || [];
  const pendingApprovals = approvals || opsStatus?.pending_approvals || [];
  const tasks = opsStatus?.tasks || [];

  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETED").length;
  const blockedTasks = tasks.filter((t: any) => t.status === "BLOCKED").length;

  const currentStage: LifecycleStage =
    lifecycleState === "LIVE" ? "LIVE" : state === "DEGRADED" ? "RECOVER" : "DISCOVER";

  // Consolidated recommendations from opsStatus or shortlist
  const rawRecommendations = useMemo(() => {
    if (opsStatus?.recommendations && opsStatus.recommendations.length > 0) {
      return opsStatus.recommendations;
    }
    return shortlist || [];
  }, [opsStatus?.recommendations, shortlist]);

  // Group recommendations by category
  const groupedRecommendations = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const item of rawRecommendations) {
      const cat = (item.category || "OTHER").toUpperCase();
      if (!map[cat]) map[cat] = [];
      map[cat].push(item);
    }
    for (const cat in map) {
      map[cat].sort((a, b) => (a.ranking || 99) - (b.ranking || 99));
    }
    return map;
  }, [rawRecommendations]);

  // Determine required categories from discovery runs, requirements, or recommendations
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    if (opsStatus?.discovery && Array.isArray(opsStatus.discovery)) {
      opsStatus.discovery.forEach((d: any) => {
        if (d.category) set.add(d.category.toUpperCase());
      });
    }
    Object.keys(groupedRecommendations).forEach((c) => set.add(c.toUpperCase()));
    if (event?.requirements && Array.isArray(event.requirements)) {
      event.requirements.forEach((r: any) => {
        const cat = typeof r === "string" ? r : r.type || "";
        if (cat) set.add(cat.toUpperCase());
      });
    }
    return Array.from(set);
  }, [opsStatus?.discovery, groupedRecommendations, event?.requirements]);

  // Explicitly selected candidates
  const selectedCandidates = useMemo(() => {
    return rawRecommendations.filter(
      (r: any) => r.status === "SELECTED" || r.selection_source === "ORGANIZER_SELECTION"
    );
  }, [rawRecommendations]);

  const handleSelectCandidate = async (candidateId: string) => {
    try {
      setSelectingCandidateId(candidateId);
      setSelectionError(null);
      await selectCandidate(candidateId);
    } catch (err: any) {
      console.error("Failed to select candidate:", err);
      setSelectionError(err?.message || "Failed to confirm candidate selection.");
    } finally {
      setSelectingCandidateId(null);
    }
  };

  if (isLoading && !event) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 text-[#D6003C] animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Loading Canonical Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <EventShell eventId={eventId} currentStage={currentStage} event={event}>
      {/* 1. Incident Alert Banner if in DEGRADED or DISRUPTED state */}
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

      {/* 2. Prominent Waiting for Selection Banner */}
      {isWaitingForSelection && (
        <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-100 text-amber-800">
              <Sparkles className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                <span>EVENTRA is Waiting for Your Selection</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
                  Action Required
                </span>
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Autonomous discovery is complete across required categories. Review the qualified recommendations below and select your preferred partners.
              </p>
            </div>
          </div>
          <div className="text-xs font-medium text-amber-900 bg-amber-100/80 px-3 py-1.5 rounded-lg self-start sm:self-auto border border-amber-200">
            {selectedCandidates.length} of {categoriesList.length} categories chosen
          </div>
        </div>
      )}

      {/* Selection Error Banner */}
      {selectionError && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
          <span>{selectionError}</span>
          <button
            onClick={() => setSelectionError(null)}
            className="text-rose-500 hover:text-rose-800 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. Agent Command Center Panel */}
      <AgentPanel
        eventId={eventId}
        eventName={name}
        lifecycleState={lifecycleState}
        isRunning={isAgentRunning}
        isWaitingForSelection={isWaitingForSelection}
        agentMessage={agentMessage}
        agentStatus={opsStatus?.agent?.status}
        pendingApprovalsCount={pendingApprovals.length}
        latestOperation={agentMessage || opsStatus?.agent?.current_step || opsStatus?.activity_feed?.[0]?.action || null}
        latestResult={opsStatus?.activity_feed?.[0]?.detail || null}
        onOperationsStarted={() => {
          refreshWorkspace(eventId);
        }}
      />

      {/* 4 Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Budget */}
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

        {/* Metric 2: Operational Tasks */}
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

        {/* Metric 3: Recommendations & Selections */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-semibold uppercase tracking-wider">Selections / Sourced</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 tracking-tight">
            {selectedCandidates.length}
            <span className="text-xs text-slate-500 font-normal ml-1.5">
              selected ({rawRecommendations.length} recommended)
            </span>
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

        {/* Metric 4: Human Approvals */}
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
        {/* Left Column (2 Cols): Recommendations, Selections, Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* SECTION: EVENTRA RECOMMENDATIONS */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#D6003C]" />
                  <span>EVENTRA Recommendations</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  AI-scouted, qualified options preserved across required event categories
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                {rawRecommendations.length} candidates
              </span>
            </div>

            {categoriesList.length === 0 && rawRecommendations.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No recommendations yet. Start autonomous operations to discover and rank partners.
              </div>
            ) : (
              <div className="space-y-6">
                {categoriesList.map((catKey) => {
                  const items = groupedRecommendations[catKey] || [];
                  const Icon = CATEGORY_ICONS[catKey.toLowerCase()] || Building2;
                  const catTitle = catKey.replace(/_/g, " ");

                  return (
                    <div key={catKey} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span>{catTitle}</span>
                        </div>
                        <span className="text-[11px] font-medium text-slate-400">
                          {items.length} {items.length === 1 ? "option" : "options"}
                        </span>
                      </div>

                      {items.length === 0 ? (
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                          No suitable {catTitle.toLowerCase()} options found yet.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {items.map((rec: any) => {
                            const isSelected =
                              rec.status === "SELECTED" ||
                              rec.selection_source === "ORGANIZER_SELECTION";
                            const isSelectingThis = selectingCandidateId === rec.candidate_id;
                            const candidateData = rec.candidate_data || {};
                            const scorePct = rec.score ? Math.round(Number(rec.score) * (Number(rec.score) <= 1 ? 100 : 1)) : 85;

                            return (
                              <div
                                key={rec.id || rec.candidate_id}
                                className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                                  isSelected
                                    ? "bg-emerald-50/40 border-emerald-400 shadow-2xs"
                                    : "bg-white border-slate-200 hover:border-slate-300 shadow-2xs"
                                }`}
                              >
                                <div className="space-y-2">
                                  {/* Header: Name + Status Badge */}
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <h4 className="text-xs font-bold text-slate-900 leading-tight">
                                        {rec.candidate_name || rec.name}
                                      </h4>
                                      {candidateData.address && (
                                        <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                          <span className="truncate">{candidateData.address}</span>
                                        </div>
                                      )}
                                    </div>

                                    {isSelected ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300 shrink-0">
                                        <Check className="w-3 h-3 text-emerald-700" /> Selected
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 shrink-0">
                                        Rank #{rec.ranking || 1}
                                      </span>
                                    )}
                                  </div>

                                  {/* Meta: Rating + Match Score */}
                                  <div className="flex items-center gap-3 text-[11px] text-slate-600 pt-1">
                                    {candidateData.rating && (
                                      <div className="flex items-center gap-1 font-semibold text-amber-600">
                                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                        <span>{Number(candidateData.rating).toFixed(1)}</span>
                                      </div>
                                    )}
                                    <div className="text-[11px] text-slate-500">
                                      Match Score: <span className="font-bold text-slate-800">{scorePct}%</span>
                                    </div>
                                    {candidateData.phone && (
                                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                        <Phone className="w-2.5 h-2.5 text-slate-400" />
                                        <span>Verified</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Notes/Qualification */}
                                  {rec.notes && (
                                    <p className="text-[11px] text-slate-500 line-clamp-2 italic pt-1 border-t border-slate-100">
                                      &ldquo;{rec.notes}&rdquo;
                                    </p>
                                  )}
                                </div>

                                {/* Selection Action Footer */}
                                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                                  {isSelected ? (
                                    <div className="text-[10px] text-emerald-800 font-medium">
                                      Chosen by {rec.selected_by || "Organizer"}
                                      {rec.selected_at && ` • ${new Date(rec.selected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-slate-400">
                                      Awaiting your decision
                                    </div>
                                  )}

                                  {!isSelected && (
                                    <button
                                      onClick={() => handleSelectCandidate(rec.candidate_id)}
                                      disabled={isSelectingThis}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition disabled:opacity-50 shadow-2xs"
                                    >
                                      {isSelectingThis ? (
                                        <>
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                          <span>Selecting...</span>
                                        </>
                                      ) : (
                                        <span>Select Option</span>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION: YOUR SELECTIONS */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Your Confirmed Selections</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Options chosen by the organizer; staged for subsequent communication & booking
                </p>
              </div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                {selectedCandidates.length} Selected
              </span>
            </div>

            {selectedCandidates.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs">
                No candidates selected yet. Choose your preferred partners from the recommendations above.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {selectedCandidates.map((sel: any) => {
                  const Icon = CATEGORY_ICONS[(sel.category || "").toLowerCase()] || Building2;
                  const candidateId = sel.candidate_id || sel.id;
                  const comm = sel.communication_approval || sel.candidate_data?.communication || {};
                  const commStatus = comm.overall_status || "PENDING_APPROVAL";
                  const approvalStatus = comm.approval_status || "PENDING";
                  const isPendingApproval = approvalStatus === "PENDING" && (commStatus === "PENDING_APPROVAL" || commStatus === "NOT_REQUESTED");
                  const isDismissed = approvalStatus === "REJECTED" || commStatus === "DISMISSED";
                  const isApproving = approvingCandidateId === candidateId;
                  const isDismissing = dismissingCandidateId === candidateId;
                  const catLabel = (sel.category || "venue").toLowerCase();

                  return (
                    <div
                      key={candidateId}
                      className="p-4 rounded-xl bg-white border border-emerald-200 shadow-sm flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 shadow-2xs">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900">{sel.candidate_name || sel.name}</div>
                            <div className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">{sel.category}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                          Selected by you
                        </span>
                      </div>

                      {/* Communication Approval Gated Card */}
                      <div className="pt-2 border-t border-slate-100">
                        {isPendingApproval ? (
                          <div className="rounded-lg p-3 bg-amber-50/60 border border-amber-200 space-y-2.5">
                            <div className="flex items-start gap-2">
                              <Phone className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                              <div>
                                <div className="text-xs font-bold text-slate-900">
                                  Should I contact this {catLabel}?
                                </div>
                                <div className="text-[11px] text-slate-600 mt-0.5">
                                  I can call the {catLabel} and send a WhatsApp message to verify availability and pricing.
                                </div>
                              </div>
                            </div>

                            {commActionError && (
                              <div className="text-[11px] text-rose-600 bg-rose-50 p-1.5 rounded border border-rose-200">
                                {commActionError}
                              </div>
                            )}

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => handleApproveCommunication(candidateId)}
                                disabled={isApproving || isDismissing}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs disabled:opacity-50 transition"
                              >
                                {isApproving ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Connecting...</span>
                                  </>
                                ) : (
                                  <span>Approve & Contact</span>
                                )}
                              </button>
                              <button
                                onClick={() => handleDismissCommunication(candidateId)}
                                disabled={isApproving || isDismissing}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium disabled:opacity-50 transition"
                              >
                                {isDismissing ? "Skipping..." : "Not now"}
                              </button>
                            </div>
                          </div>
                        ) : isDismissed ? (
                          <div className="rounded-lg p-2.5 bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                            <span>Outreach paused ("Not now")</span>
                            <button
                              onClick={() => handleApproveCommunication(candidateId)}
                              disabled={isApproving}
                              className="text-[11px] font-semibold text-emerald-700 hover:underline"
                            >
                              {isApproving ? "Contacting..." : "Approve & Contact"}
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-lg p-3 bg-slate-50 border border-slate-200 space-y-2">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                              <span>Contact Result</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                                commStatus === "COMPLETED"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : commStatus === "PARTIAL"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : commStatus === "UNAVAILABLE"
                                  ? "bg-slate-100 text-slate-600 border-slate-200"
                                  : "bg-rose-50 text-rose-700 border-rose-200"
                              }`}>
                                {commStatus === "COMPLETED" ? "Completed" : commStatus === "PARTIAL" ? "Partial" : commStatus}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              {/* Independent Call Status */}
                              <div className="p-2 rounded bg-white border border-slate-200">
                                <div className="flex items-center gap-1 text-slate-500 text-[10px] uppercase font-bold">
                                  <Phone className="w-3 h-3 text-purple-600" />
                                  <span>Call</span>
                                </div>
                                <div className="mt-1 font-semibold text-[11px]">
                                  {comm.call_status === "COMPLETED" ? (
                                    <span className="text-emerald-700 flex items-center gap-1">✓ Completed</span>
                                  ) : comm.call_status === "IN_PROGRESS" || comm.call_status === "STARTED" ? (
                                    <span className="text-blue-600 flex items-center gap-1">
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> In progress
                                    </span>
                                  ) : comm.call_status === "UNAVAILABLE" ? (
                                    <span className="text-slate-500 text-[10px]">⚠ Unavailable</span>
                                  ) : comm.call_status === "NOT_ATTEMPTED" ? (
                                    <span className="text-slate-400">● Not attempted</span>
                                  ) : (
                                    <span className="text-rose-600">✗ Failed</span>
                                  )}
                                </div>
                              </div>

                              {/* Independent WhatsApp Status */}
                              <div className="p-2 rounded bg-white border border-slate-200">
                                <div className="flex items-center gap-1 text-slate-500 text-[10px] uppercase font-bold">
                                  <MessageSquare className="w-3 h-3 text-emerald-600" />
                                  <span>WhatsApp</span>
                                </div>
                                <div className="mt-1 font-semibold text-[11px]">
                                  {comm.whatsapp_status === "SENT" || comm.whatsapp_status === "DELIVERED" ? (
                                    <span className="text-emerald-700 flex items-center gap-1">✓ Sent</span>
                                  ) : comm.whatsapp_status === "IN_PROGRESS" || comm.whatsapp_status === "STARTED" ? (
                                    <span className="text-blue-600 flex items-center gap-1">
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Sending...
                                    </span>
                                  ) : comm.whatsapp_status === "UNAVAILABLE" ? (
                                    <span className="text-slate-500 text-[10px]">⚠ Unavailable</span>
                                  ) : comm.whatsapp_status === "NOT_ATTEMPTED" ? (
                                    <span className="text-slate-400">● Not attempted</span>
                                  ) : (
                                    <span className="text-rose-600">✗ Failed</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Selected by: {sel.selected_by || "Organizer"}</span>
                        {sel.selected_at && (
                          <span className="text-[10px] text-slate-400">
                            {new Date(sel.selected_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

              </div>
            )}
          </div>

          {/* SECTION: CONTRACTED ASSIGNMENTS */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Contracted / Assigned Providers
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Formal VendorAssignment records created upon selection
                </p>
              </div>
              <Link
                href={`/events/${eventId}/vendors`}
                className="text-xs font-semibold text-[#D6003C] hover:underline flex items-center gap-1"
              >
                View Funnel <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {assignments.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs">
                No formal vendor assignments contracted yet. Selecting a candidate registers an assignment.
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

          {/* SECTION: CRITICAL PATH TASKS */}
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
