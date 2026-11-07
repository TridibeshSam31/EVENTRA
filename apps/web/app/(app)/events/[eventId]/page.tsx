"use client";

import React, { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
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
  Star,
  Check,
  Compass,
} from "lucide-react";


import { useEventWorkspace } from "@/hooks/useEventWorkspace";
import { EventShell } from "@/components/v2/EventShell";
import { AgentPanel } from "@/components/v2/AgentPanel";
import { AgentActivityStream } from "@/components/v2/AgentActivityStream";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import { ContactResultPanel } from "@/components/v2/ContactResultPanel";
import { WorkspaceLoading, WorkspaceLoadError } from "@/components/v2/WorkspaceLoading";
import { NextStepGuide, type NeedsYouItem } from "@/components/v2/NextStepGuide";
import { PopCard, AnimatedNumber, Celebrate } from "@/components/ds/motion";
import { humanizeAction, humanizeActor, humanizeCategory, humanizeCode } from "@/lib/humanize";
import { JOURNEY_LABEL, JOURNEY_DONE } from "@/lib/journey";
import type { LifecycleStage } from "@/components/v2/LifecycleStepper";
import { Panel, Stat, CueChip, EmptyState, Meter } from "@/components/ds";
import { ReadinessChecklist } from "@/components/guide/Readiness";
import { useGuideStore } from "@/stores/guideStore";

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
    incidents,
    isReady,
    isAgentRunning,
    isWaitingForSelection,
    agentMessage,
    refreshWorkspace,
    selectCandidate,
    approveCommunication,
    dismissCommunication,
    retryCommunication,
  } = useEventWorkspace(eventId);

  // Authoritative "one next step" (shown big in the guide card; here it heads the full list).
  const guideNextStep = useGuideStore((s) => (s.eventId === eventId ? s.nextStep : null));

  const [selectingCandidateId, setSelectingCandidateId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [approvingCandidateId, setApprovingCandidateId] = useState<string | null>(null);
  const [dismissingCandidateId, setDismissingCandidateId] = useState<string | null>(null);
  // Errors are kept per candidate so one card's failure never shows on another.
  const [commActionErrors, setCommActionErrors] = useState<Record<string, string | null>>({});
  const setCommActionError = (candidateId: string, message: string | null) =>
    setCommActionErrors((prev) => ({ ...prev, [candidateId]: message }));
  const commActionInFlight = approvingCandidateId !== null || dismissingCandidateId !== null;
  // Short-lived "it worked" bursts after a successful pick / approve.
  const [justPickedId, setJustPickedId] = useState<string | null>(null);
  const [justContactedId, setJustContactedId] = useState<string | null>(null);
  const flash = (setter: (v: string | null) => void, id: string) => {
    setter(id);
    setTimeout(() => setter(null), 1800);
  };

  const handleApproveCommunication = async (candidateId: string) => {
    if (commActionInFlight) return;
    try {
      setApprovingCandidateId(candidateId);
      setCommActionError(candidateId, null);
      await approveCommunication(candidateId);
      flash(setJustContactedId, candidateId);
    } catch (err: any) {
      console.error("Communication approval failed:", err);
      setCommActionError(candidateId, err?.message || "Failed to approve communication.");
    } finally {
      setApprovingCandidateId(null);
    }
  };

  const handleDismissCommunication = async (candidateId: string) => {
    if (commActionInFlight) return;
    try {
      setDismissingCandidateId(candidateId);
      setCommActionError(candidateId, null);
      await dismissCommunication(candidateId);
    } catch (err: any) {
      console.error("Communication dismiss failed:", err);
      setCommActionError(candidateId, err?.message || "Failed to dismiss communication.");
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

  // Vendors EVENTRA has already messaged or called.
  const contactedCount = rawRecommendations.filter((r: any) => {
    const comm = r.candidate_data?.communication;
    return (
      (comm?.whatsapp_status && comm.whatsapp_status !== "NOT_ATTEMPTED") ||
      (comm?.call_status && comm.call_status !== "NOT_ATTEMPTED")
    );
  }).length;

  const handleSelectCandidate = async (candidateId: string) => {
    try {
      setSelectingCandidateId(candidateId);
      setSelectionError(null);
      await selectCandidate(candidateId);
      flash(setJustPickedId, candidateId);
    } catch (err: any) {
      console.error("Failed to select candidate:", err);
      setSelectionError(err?.message || "Failed to confirm candidate selection.");
    } finally {
      setSelectingCandidateId(null);
    }
  };

  if (!event) {
    return (
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isReady ? <WorkspaceLoadError onRetry={() => refreshWorkspace(eventId)} /> : <WorkspaceLoading />}
      </div>
    );
  }

  const taskTone = blockedTasks > 0 ? "cue" : "go";

  // ── The single "Needs you" list, built only from real backend state ──
  const isPendingContact = (sel: any) => {
    const comm = sel.communication_approval || sel.candidate_data?.communication || {};
    const commStatus = comm.overall_status || "PENDING_APPROVAL";
    const approvalStatus = comm.approval_status || "PENDING";
    return approvalStatus === "PENDING" && (commStatus === "PENDING_APPROVAL" || commStatus === "NOT_REQUESTED");
  };
  const needsYou: NeedsYouItem[] = [];
  (incidents || [])
    .filter((inc: any) => inc && inc.status !== "RESOLVED")
    .forEach((inc: any) => {
      needsYou.push({
        id: `inc-${inc.id}`,
        kind: "incident",
        title: inc.title || humanizeCode(inc.incident_type, "A problem was reported"),
        detail: [humanizeCode(inc.severity), humanizeCode(inc.status)].filter(Boolean).join(" · "),
        action: { label: "Respond", href: `/events/${eventId}/incidents` },
      });
    });
  const contactCandidateIds = new Set<string>();
  selectedCandidates.filter(isPendingContact).forEach((sel: any) => {
    const candidateId = sel.candidate_id || sel.id;
    contactCandidateIds.add(candidateId);
    needsYou.push({
      id: `contact-${candidateId}`,
      kind: "contact",
      title: `Contact ${sel.candidate_name || sel.name || "this vendor"}`,
      detail: `${humanizeCategory(sel.category) || "Vendor"} · EVENTRA will call and WhatsApp them for availability and a quote.`,
      error: commActionErrors[candidateId] || null,
      action: {
        label: JOURNEY_LABEL.contact,
        onClick: () => handleApproveCommunication(candidateId),
        busy: approvingCandidateId === candidateId,
        busyLabel: "Contacting…",
        disabled: commActionInFlight,
      },
    });
  });
  const openApprovals = (pendingApprovals as any[]).filter((a) => {
    const cid = (a?.requested_action as any)?.candidate_id;
    return !(cid && contactCandidateIds.has(cid));
  });
  openApprovals.forEach((a: any) => {
    const req = (a.requested_action || {}) as Record<string, any>;
    const who = req.candidate_name || req.vendor_name;
    const cat = humanizeCategory(req.category || a.target_type);
    needsYou.push({
      id: `appr-${a.id}`,
      kind: "approval",
      title: who ? `${humanizeAction(a.action_type)}: ${who}` : humanizeAction(a.action_type) || "Approval request",
      detail: [cat, a.impact_level ? `${humanizeCode(a.impact_level)} impact` : null].filter(Boolean).join(" · "),
      action: { label: "Review", href: `/events/${eventId}/approvals` },
    });
  });
  const pickedCategories = new Set(selectedCandidates.map((sel: any) => (sel.category || "").toUpperCase()));
  categoriesList.forEach((catKey) => {
    const items = groupedRecommendations[catKey] || [];
    if (items.length === 0 || pickedCategories.has(catKey)) return;
    const top = items[0];
    const cat = humanizeCategory(catKey);
    needsYou.push({
      id: `pick-${catKey}`,
      kind: "pick",
      title: `${JOURNEY_LABEL.pick} your ${cat.toLowerCase()}`,
      detail: `${items.length} ${items.length === 1 ? "option" : "options"}${top ? ` · top match: ${top.candidate_name || top.name}` : ""}`,
      action: {
        label: "Compare options",
        onClick: () => document.getElementById(`cat-${catKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      },
    });
  });

  return (
    <EventShell eventId={eventId} currentStage={currentStage} event={event}>
      {/* 1. Disruption banner — the loudest thing on the page when it applies */}
      {state !== "NORMAL" && (
        <div className="surface-ink relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-cue-600" aria-hidden />
          <div className="flex items-start gap-3.5">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cue-600/15 text-cue-400 ring-1 ring-cue-500/30">
              <AlertTriangle className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-label text-cue-300">
                <span className="cue-light bg-cue-500 animate-cue-blink" />
                Hold · {state}
              </div>
              <h3 className="mt-1 text-[15px] font-semibold text-ink-50">Something on the plan has gone wrong</h3>
              <p className="mt-0.5 text-[13px] text-ink-400">
                Critical tasks are affected. EVENTRA has recovery options ready for you to review.
              </p>
            </div>
          </div>
          <Link href={`/events/${eventId}/recovery`} className="btn-cue shrink-0">
            Review recovery <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* 2. Will this event happen? — readiness gates from the backend */}
      <ReadinessChecklist eventId={eventId} />

      <NextStepGuide
        nextStep={guideNextStep}
        eventId={eventId}
        foundCount={rawRecommendations.length}
        pickedCount={selectedCandidates.length}
        pendingApprovalsCount={pendingApprovals.length}
        contactedCount={contactedCount}
        isSearching={isAgentRunning}
        items={needsYou}
      />

      {selectionError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-cue-200 bg-cue-50 px-3.5 py-2.5 text-[12.5px] text-cue-800">
          <span>{selectionError}</span>
          <button onClick={() => setSelectionError(null)} className="font-semibold text-cue-600 hover:text-cue-800">
            Dismiss
          </button>
        </div>
      )}

      {/* 3. What EVENTRA is doing right now */}
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

      {/* 4. Readouts */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Budget committed"
          tone={budgetPct > 95 ? "cue" : budgetPct > 80 ? "standby" : "go"}
          value={
            <>
              {currencySym}
              <AnimatedNumber value={committedBudget} />
            </>
          }
          sub={
            <div className="space-y-1.5">
              <Meter value={budgetPct} tone={budgetPct > 95 ? "cue" : budgetPct > 80 ? "standby" : "go"} label="Budget committed" />
              <div className="flex justify-between">
                <span>of {totalBudget > 0 ? `${currencySym}${totalBudget.toLocaleString()}` : "no budget set"}</span>
                <span className="font-mono">{budgetPct}%</span>
              </div>
            </div>
          }
        />
        <Stat
          label="Event plan"
          tone={tasks.length ? taskTone : "default"}
          value={
            <>
              <AnimatedNumber value={completedTasks} />
              <span className="text-[18px] text-ink-400">/{tasks.length}</span>
            </>
          }
          sub={
            tasks.length === 0 ? (
              "No tasks yet"
            ) : blockedTasks > 0 ? (
              <span className="flex items-center gap-1 font-semibold text-cue-700">
                <AlertTriangle className="h-3.5 w-3.5" /> {blockedTasks} blocked
              </span>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-go-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Critical path clear
              </span>
            )
          }
        />
        <Stat
          label="Vendors picked / found"
          tone="agent"
          value={
            <>
              <AnimatedNumber value={selectedCandidates.length} />
              <span className="text-[18px] text-ink-400">/{rawRecommendations.length}</span>
            </>
          }
          sub={
            <Link href={`/events/${eventId}/vendors`} className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:text-ink-900">
              Open discovery <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <Stat
          label="Vendors contacted"
          tone={contactedCount > 0 ? "engine" : "default"}
          value={
            <>
              <AnimatedNumber value={contactedCount} />
              <span className="text-[18px] text-ink-400">/{selectedCandidates.length}</span>
            </>
          }
          sub={
            contactedCount > 0 ? (
              <Link href={`/events/${eventId}/conversations`} className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:text-ink-900">
                Read replies <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              "No one contacted yet"
            )
          }
        />
      </div>

      {/* 5. Main columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Vendors we found */}
          <Panel
            eyebrow={
              <span className="flex items-center gap-1.5">
                <span className="text-agent-600">✦</span> Agent recommendations
              </span>
            }
            title="Vendors we found"
            actions={<span className="font-mono text-[11px] text-ink-500">{rawRecommendations.length} candidates</span>}
          >
            {categoriesList.length === 0 && rawRecommendations.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={<Sparkles className="h-5 w-5" />}
                title="No recommendations yet"
                description="Start EVENTRA above and it will discover, qualify and rank vendors for each thing your event needs."
              />
            ) : (
              <div className="space-y-6">
                {categoriesList.map((catKey) => {
                  const items = groupedRecommendations[catKey] || [];
                  const Icon = CATEGORY_ICONS[catKey.toLowerCase()] || Building2;
                  const catTitle = catKey.replace(/_/g, " ");

                  return (
                    <div key={catKey} id={`cat-${catKey}`} className="scroll-mt-24 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-ink-900 text-ink-50">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[12.5px] font-semibold text-ink-900">{humanizeCategory(catKey)}</span>
                        <span className="h-px flex-1 bg-ink-200" />
                        <span className="font-mono text-[10.5px] text-ink-400">
                          {items.length} {items.length === 1 ? "option" : "options"}
                        </span>
                      </div>

                      {items.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-ink-300 px-4 py-3 text-[12.5px] text-ink-500">
                          No suitable {catTitle.toLowerCase()} options found yet.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {items.map((rec: any, idx: number) => {
                            const isSelected = rec.status === "SELECTED" || rec.selection_source === "ORGANIZER_SELECTION";
                            const isSelectingThis = selectingCandidateId === rec.candidate_id;
                            const candidateData = rec.candidate_data || {};
                            // Only show a match score the backend actually returned.
                            const scorePct =
                              rec.score != null && rec.score !== ""
                                ? Math.round(Number(rec.score) * (Number(rec.score) <= 1 ? 100 : 1))
                                : null;
                            // The agent's note often just repeats the score ("Autonomous score: 0.934"); hide it then.
                            const noteScore = typeof rec.notes === "string" ? rec.notes.match(/^\s*autonomous score:\s*([\d.]+)\s*$/i) : null;
                            const noteIsDuplicate =
                              !!noteScore &&
                              scorePct != null &&
                              Math.round(Number(noteScore[1]) * (Number(noteScore[1]) <= 1 ? 100 : 1)) === scorePct;
                            const showNote = rec.notes && !noteIsDuplicate;
                            const celebrating = justPickedId === rec.candidate_id;

                            return (
                              <PopCard
                                key={rec.id || rec.candidate_id}
                                index={idx}
                                className={`flex flex-col justify-between rounded-xl border p-3.5 transition-colors duration-300 ${
                                  isSelected
                                    ? "border-go-300 bg-go-50/60 ring-1 ring-go-300"
                                    : "border-ink-200 bg-[#FDFCFA]"
                                }`}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <h4 className="truncate text-[13.5px] font-semibold leading-tight text-ink-900">
                                        {rec.candidate_name || rec.name}
                                      </h4>
                                      {candidateData.address && (
                                        <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-500">
                                          <MapPin className="h-3 w-3 shrink-0 text-ink-400" />
                                          <span className="truncate">{candidateData.address}</span>
                                        </div>
                                      )}
                                    </div>
                                    {isSelected ? (
                                      <span className="chip shrink-0 animate-rise-in border-go-300 bg-go-100 text-go-800">
                                        <Check className="h-3 w-3" /> {JOURNEY_DONE.pick}
                                      </span>
                                    ) : (
                                      <span className="shrink-0 font-mono text-[11px] font-semibold text-ink-500">
                                        #{rec.ranking || "—"}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-600">
                                    {candidateData.rating && (
                                      <span className="flex items-center gap-1 font-semibold text-ink-800">
                                        <Star className="h-3 w-3 fill-standby-400 text-standby-400" />
                                        {Number(candidateData.rating).toFixed(1)}
                                      </span>
                                    )}
                                    {scorePct != null && (
                                      <span className="flex items-center gap-1.5">
                                        Match
                                        <span className="relative inline-block h-1.5 w-12 overflow-hidden rounded-full bg-ink-200">
                                          <span
                                            className="absolute inset-y-0 left-0 rounded-full bg-agent-500 transition-[width] duration-700"
                                            style={{ width: `${Math.max(0, Math.min(100, scorePct))}%` }}
                                          />
                                        </span>
                                        <span className="font-mono font-semibold text-ink-900">{scorePct}%</span>
                                      </span>
                                    )}
                                    {candidateData.phone && (
                                      <span className="flex items-center gap-1 text-ink-500">
                                        <Phone className="h-3 w-3" /> Phone listed
                                      </span>
                                    )}
                                  </div>

                                  {showNote && (
                                    <p className="line-clamp-2 border-l-2 border-agent-300 pl-2 text-[11.5px] text-ink-600">
                                      <span className="text-agent-600">✦ </span>
                                      {rec.notes}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-3 flex min-h-[32px] items-center justify-between gap-2 border-t border-dashed border-ink-200 pt-2.5">
                                  {isSelected ? (
                                    <div className="text-[11px] font-medium text-go-800">
                                      {JOURNEY_DONE.pick} by {humanizeActor(rec.selected_by || "Organizer")}
                                      {rec.selected_at &&
                                        ` · ${new Date(rec.selected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-ink-400">Not picked yet</div>
                                  )}

                                  {celebrating ? (
                                    <Celebrate show label={JOURNEY_DONE.pick} />
                                  ) : (
                                    !isSelected && (
                                      <button
                                        onClick={() => handleSelectCandidate(rec.candidate_id)}
                                        disabled={isSelectingThis}
                                        className="btn-primary h-7 px-3 text-[12px]"
                                        title="Choose this vendor for its category"
                                      >
                                        {isSelectingThis ? (
                                          <>
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Picking…
                                          </>
                                        ) : (
                                          JOURNEY_LABEL.pick
                                        )}
                                      </button>
                                    )
                                  )}
                                </div>
                              </PopCard>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Your selections */}
          <Panel
            eyebrow={
              <span className="flex items-center gap-1.5">
                <span className="text-ink-700">●</span> Your decisions
              </span>
            }
            title="Picked vendors"
            actions={
              <CueChip tone={selectedCandidates.length ? "go" : "idle"}>{selectedCandidates.length} picked</CueChip>
            }
          >
            {selectedCandidates.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-500">
                Nothing picked yet. Choose your preferred vendors from the recommendations above.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {selectedCandidates.map((sel: any) => {
                  const Icon = CATEGORY_ICONS[(sel.category || "").toLowerCase()] || Building2;
                  const candidateId = sel.candidate_id || sel.id;
                  const comm = sel.communication_approval || sel.candidate_data?.communication || {};
                  const commStatus = comm.overall_status || "PENDING_APPROVAL";
                  const approvalStatus = comm.approval_status || "PENDING";
                  const isPendingApproval =
                    approvalStatus === "PENDING" && (commStatus === "PENDING_APPROVAL" || commStatus === "NOT_REQUESTED");
                  const isDismissed = approvalStatus === "REJECTED" || commStatus === "DISMISSED";
                  const isApproving = approvingCandidateId === candidateId;
                  const isDismissing = dismissingCandidateId === candidateId;
                  const catLabel = (sel.category || "venue").toLowerCase();
                  const commActionError = commActionErrors[candidateId];

                  return (
                    <PopCard key={candidateId} interactive={false} className="flex flex-col justify-between space-y-3 rounded-xl border border-ink-200 bg-[#FDFCFA] p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go-50 text-go-700 ring-1 ring-go-200">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-ink-900">{sel.candidate_name || sel.name}</div>
                            <div className="text-[11.5px] text-ink-500">{humanizeCategory(sel.category)}</div>
                          </div>
                        </div>
                        {justContactedId === candidateId ? (
                          <Celebrate show label="Contacting" />
                        ) : (
                          <span className="chip shrink-0 border-go-200 bg-go-50 text-go-700">
                            <Check className="h-3 w-3" /> {JOURNEY_DONE.pick}
                          </span>
                        )}
                      </div>

                      <div className="border-t border-dashed border-ink-200 pt-3">
                        {isPendingApproval ? (
                          <div className="space-y-2.5 rounded-lg border border-standby-200 bg-standby-50/70 p-3">
                            <div className="flex items-start gap-2">
                              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-standby-600" />
                              <div>
                                <div className="text-[12.5px] font-semibold text-ink-900">Should I contact this {catLabel}?</div>
                                <div className="mt-0.5 text-[11.5px] text-ink-600">
                                  I can call the {catLabel} and send a WhatsApp message to verify availability and pricing.
                                </div>
                              </div>
                            </div>

                            {commActionError && (
                              <div role="alert" className="rounded border border-cue-200 bg-cue-50 p-1.5 text-[11px] text-cue-700">
                                {commActionError}
                              </div>
                            )}

                            <div className="flex items-center gap-2 pt-0.5">
                              <button
                                onClick={() => handleApproveCommunication(candidateId)}
                                disabled={isApproving || isDismissing}
                                className="btn-primary h-8 px-3 text-[12px]"
                              >
                                {isApproving ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Connecting…
                                  </>
                                ) : (
                                  "Approve & contact"
                                )}
                              </button>
                              <button
                                onClick={() => handleDismissCommunication(candidateId)}
                                disabled={isApproving || isDismissing}
                                className="btn-ghost h-8 px-2.5 text-[12px]"
                              >
                                {isDismissing ? "Skipping…" : "Not now"}
                              </button>
                            </div>
                          </div>
                        ) : isDismissed ? (
                          <div className="flex items-center justify-between rounded-lg border border-ink-200 bg-ink-100/60 p-2.5 text-[12px] text-ink-600">
                            <span>Outreach paused (&ldquo;Not now&rdquo;)</span>
                            <button
                              onClick={() => handleApproveCommunication(candidateId)}
                              disabled={isApproving || isDismissing}
                              className="text-[11.5px] font-semibold text-ink-900 underline-offset-2 hover:underline disabled:opacity-50"
                            >
                              {isApproving ? "Contacting…" : "Approve & contact"}
                            </button>
                          </div>
                        ) : (
                          <ContactResultPanel
                            eventId={eventId}
                            candidateId={candidateId}
                            communication={comm}
                            onRetry={(channel) => retryCommunication(candidateId, channel)}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between border-t border-dashed border-ink-200 pt-2 text-[11px] text-ink-500">
                        <span>{JOURNEY_DONE.pick} by {humanizeActor(sel.selected_by || "Organizer")}</span>
                        {sel.selected_at && <span className="font-mono text-[10.5px] text-ink-400">{new Date(sel.selected_at).toLocaleDateString()}</span>}
                      </div>
                    </PopCard>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Assignments */}
          <Panel
            eyebrow={
              <span className="flex items-center gap-1.5">
                <span className="text-go-600">▲</span> Booked
              </span>
            }
            title="Assigned vendors"
            actions={
              <Link href={`/events/${eventId}/vendors`} className="btn-ghost h-7 px-2 text-[12px]">
                View funnel <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {assignments.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-500">
                No bookings yet. A vendor appears here once a booking is approved.
              </p>
            ) : (
              <ul className="ruled">
                {assignments.map((assign: any) => {
                  const cat = (assign.category || "other").toLowerCase();
                  const Icon = CATEGORY_ICONS[cat] || Building2;
                  return (
                    <li key={assign.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-700">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink-900">{assign.vendor_name || "Assigned provider"}</div>
                        <div className="text-[11.5px] text-ink-500">{humanizeCategory(assign.category)}</div>
                      </div>
                      <ProvenanceBadge source={assign.source || "UNKNOWN"} size="sm" />
                      <span className="w-24 text-right font-mono text-[12.5px] font-semibold text-ink-800">
                        {assign.agreed_cost ? `${currencySym}${Number(assign.agreed_cost).toLocaleString()}` : <span className="text-ink-400">Quoting</span>}
                      </span>
                      <CueChip tone="go">{humanizeCode(assign.status)}</CueChip>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* Critical path */}
          <Panel
            eyebrow={
              <span className="flex items-center gap-1.5">
                <span className="text-engine-600">✓</span> Engine schedule
              </span>
            }
            title="Critical path"
            actions={
              <Link href={`/events/${eventId}/plan`} className="btn-ghost h-7 px-2 text-[12px]">
                Open plan <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-500">No tasks scheduled yet.</p>
            ) : (
              <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-ink-200">
                {tasks.slice(0, 5).map((task: any, i: number) => {
                  const isBlocked = task.status === "BLOCKED";
                  const isDone = task.status === "COMPLETED";
                  return (
                    <li key={task.id} className="relative flex items-center gap-3 rounded-lg py-2 pr-2">
                      <span
                        className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[#FDFCFA] font-mono text-[9.5px] font-bold ${
                          isBlocked ? "bg-cue-600 text-white" : isDone ? "bg-go-500 text-white" : "bg-ink-200 text-ink-700"
                        }`}
                      >
                        {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[13px] ${isDone ? "text-ink-500" : "font-medium text-ink-900"}`}>
                        {task.name}
                      </span>
                      {task.category && (
                        <span className="hidden text-[11px] text-ink-400 sm:inline">{humanizeCategory(task.category)}</span>
                      )}
                      <CueChip tone={isBlocked ? "cue" : isDone ? "go" : "info"} pulse={isBlocked}>
                        {humanizeCode(task.status)}
                      </CueChip>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>

        {/* Right column: live activity */}
        <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <AgentActivityStream eventId={eventId} />
        </div>
      </div>
    </EventShell>
  );
}
