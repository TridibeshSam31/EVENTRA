"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Fingerprint,
  Inbox,
  AlertCircle,
  ArrowUpRight,
  ChevronRight,
  Keyboard,
  MessageSquare,
  Phone,
  Send,
  CheckCheck,
} from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import { PageHeader, EmptyState, CueChip } from "@/components/ds";
import { PopCard, PresenceItem, AnimatePresence, Toast, Celebrate, SPRING } from "@/components/ds/motion";
import { listApprovals, approveRequest, rejectRequest } from "@/lib/api/approvals";
import { PushNotificationBanner } from "@/components/notifications";
import { humanizeCode, isUuid, timeAgo, formatMoney } from "@/lib/humanize";
import type { ApprovalRequestResponse } from "@/types/api";
import { IMPACT, toDisplayItem, type DisplayApproval } from "@/features/approvals/describe";
import { MoneyPanel, Consequences, DecideBy } from "@/features/approvals/DecisionParts";

/* ── Page ─────────────────────────────────────────────────── */

type Resolution = "approved" | "denied";

export default function ApprovalsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;
  const reduce = useReducedMotion();

  const [items, setItems] = useState<DisplayApproval[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Record<string, Resolution>>({});
  // Resolved rows linger briefly (so the user sees the result), then animate out.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: "go" | "ink" | "cue" } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  // Money decisions without an amount need a second, explicit confirmation.
  const [confirmNoAmount, setConfirmNoAmount] = useState<string | null>(null);

  // Batch approve
  const [batchConfirm, setBatchConfirm] = useState<string | null>(null); // group key awaiting confirmation
  const [batch, setBatch] = useState<{ key: string; done: number; total: number; current: string | null } | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError(null);
      setActionError(null);
      const res = await listApprovals(eventId, { status: "PENDING", limit: 50 });
      if (res.items && res.items.length > 0) {
        const mapped = res.items.map(toDisplayItem);
        setItems(mapped);
        setHiddenIds(new Set());
        setResolvedIds({});
        setActiveId((prev) => (prev && mapped.some((m) => m.id === prev) ? prev : mapped[0].id));
      } else {
        setItems([]);
        setActiveId(null);
      }
    } catch (err: any) {
      console.error("Failed to fetch approvals:", err);
      setError(err?.message || "Couldn't load your approvals. Please try again.");
      setItems([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const visible = useMemo(() => items.filter((i) => !hiddenIds.has(i.id)), [items, hiddenIds]);
  const pending = useMemo(() => items.filter((i) => !resolvedIds[i.id]), [items, resolvedIds]);
  const activeRequest = items.find((a) => a.id === activeId);
  const resolution = activeId ? resolvedIds[activeId] : undefined;

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: DisplayApproval[] }>();
    for (const it of visible) {
      const g = map.get(it.groupKey) ?? { key: it.groupKey, label: it.groupLabel, items: [] };
      g.items.push(it);
      map.set(it.groupKey, g);
    }
    return Array.from(map.values());
  }, [visible]);

  const nextPendingAfter = useCallback(
    (id: string, resolved: Record<string, Resolution>) => {
      const order = items.filter((i) => !resolved[i.id] && i.id !== id);
      const idx = items.findIndex((i) => i.id === id);
      return order.find((i) => items.indexOf(i) > idx) ?? order[0] ?? null;
    },
    [items]
  );

  /** Mark resolved now, animate the row out shortly after. */
  const markResolved = useCallback((id: string, how: Resolution) => {
    setResolvedIds((prev) => ({ ...prev, [id]: how }));
    setTimeout(() => setHiddenIds((prev) => new Set(prev).add(id)), 1100);
  }, []);

  const handleAction = async (action: Resolution) => {
    if (!eventId || !activeId || !activeRequest) return;
    if (action === "denied" && !showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    if (
      action === "approved" &&
      activeRequest.money.involvesMoney &&
      activeRequest.money.amount === null &&
      confirmNoAmount !== activeRequest.id
    ) {
      setConfirmNoAmount(activeRequest.id);
      return;
    }

    setProcessing(true);
    setActionError(null);
    setShowRejectInput(false);
    const id = activeId;
    const title = activeRequest.title;

    try {
      if (action === "approved") {
        await approveRequest(eventId, id, "Approved via Eventra Operations Console");
      } else {
        await rejectRequest(eventId, id, rejectReason || "Rejected by executive operator");
      }
      const resolved = { ...resolvedIds, [id]: action };
      markResolved(id, action);
      if (action === "approved") {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 1400);
      }
      setToast({ msg: action === "approved" ? `Approved: ${title}` : `Declined: ${title}`, tone: action === "approved" ? "go" : "ink" });
      const next = nextPendingAfter(id, resolved);
      if (next) setTimeout(() => setActiveId(next.id), 650);
    } catch (err: any) {
      console.error("Approval action failed:", err);
      setActionError(err?.message || `Couldn't save your ${action === "approved" ? "approval" : "decline"}. Please try again.`);
    } finally {
      setProcessing(false);
      setRejectReason("");
      setConfirmNoAmount(null);
    }
  };

  /** Approve every pending request in a group, one at a time; stop at the first failure. */
  const runBatch = async (groupKey: string) => {
    if (!eventId) return;
    // Money decisions are never batch-approved: each one needs its own look at the amount.
    const targets = items.filter((i) => i.groupKey === groupKey && !resolvedIds[i.id] && i.canBatch);
    if (targets.length === 0) return;
    setBatchConfirm(null);
    setActionError(null);
    setBatch({ key: groupKey, done: 0, total: targets.length, current: targets[0].id });
    let done = 0;
    for (const t of targets) {
      setBatch({ key: groupKey, done, total: targets.length, current: t.id });
      setActiveId(t.id);
      try {
        await approveRequest(eventId, t.id, "Approved via Eventra Operations Console (batch)");
        done += 1;
        markResolved(t.id, "approved");
      } catch (err: any) {
        console.error("Batch approval stopped:", err);
        setActionError(
          `Stopped after ${done} of ${targets.length}: couldn't approve “${t.title}”. ${err?.message || "Please try again."} The rest are still waiting.`
        );
        setBatch(null);
        return;
      }
    }
    setBatch(null);
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 1400);
    setToast({ msg: `Approved all ${done} requests`, tone: "go" });
  };

  /* Keyboard: J/K or ↑/↓ move, A approves, D declines. */
  const keyStateRef = useRef({ visible, activeId, processing, batch, resolution, showRejectInput });
  keyStateRef.current = { visible, activeId, processing, batch, resolution, showRejectInput };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = keyStateRef.current;
      if (!s.visible.length || s.batch) return;
      const idx = s.visible.findIndex((v) => v.id === s.activeId);
      const move = (d: number) => {
        const n = s.visible[Math.max(0, Math.min(s.visible.length - 1, (idx < 0 ? 0 : idx) + d))];
        if (n) {
          e.preventDefault();
          setActiveId(n.id);
          setShowRejectInput(false);
          document.getElementById(`approval-${n.id}`)?.focus();
        }
      };
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") move(1);
      else if (k === "k" || e.key === "ArrowUp") move(-1);
      else if (k === "a" && !s.processing && !s.resolution) {
        e.preventDefault();
        void handleActionRef.current("approved");
      } else if (k === "d" && !s.processing && !s.resolution) {
        e.preventDefault();
        if (!s.showRejectInput) setShowRejectInput(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handleActionRef = useRef(handleAction);
  handleActionRef.current = handleAction;

  const impactCfg = activeRequest ? IMPACT[activeRequest.impact] : null;

  return (
    <EventShell eventId={eventId} currentStage="READY">
      <div className="space-y-5">
        <PushNotificationBanner />

        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              Engage <span className="text-ink-300">/</span> Approvals
            </span>
          }
          title={
            <span className="flex items-baseline gap-3">
              Decisions waiting for you
              <AnimatePresence mode="popLayout">
                {pending.length > 0 && (
                  <motion.span
                    key={pending.length}
                    initial={reduce ? false : { y: -8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 8, opacity: 0 }}
                    transition={SPRING}
                    className="font-mono text-[15px] font-semibold tracking-normal text-cue-600"
                  >
                    {pending.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          }
          description="EVENTRA proposes; you decide. Nothing on this list happens until you approve it."
          actions={
            <>
              <span className="hidden items-center gap-1.5 text-[11.5px] text-ink-400 lg:inline-flex" title="Keyboard shortcuts">
                <Keyboard className="h-3.5 w-3.5" />
                <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>D</Kbd> decline
              </span>
              <button onClick={() => fetchApprovals()} disabled={loading || !!batch} className="btn-secondary">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-cue-200 bg-cue-50 px-4 py-3 text-[13px] text-cue-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-cue-600" />
            <span className="flex-1">
              <strong className="font-semibold">Couldn&apos;t load approvals.</strong>{" "}
              {/fetch|network/i.test(error) ? "EVENTRA's server isn't reachable right now." : error}
            </span>
            <button onClick={() => fetchApprovals()} className="btn-ghost h-7 !px-2 text-cue-700">
              Try again
            </button>
          </div>
        )}

        <AnimatePresence>
          {actionError && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 rounded-xl border border-standby-200 bg-standby-50 px-4 py-3 text-[13px] text-standby-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-standby-600" />
              <span className="flex-1">{actionError}</span>
              <button onClick={() => setActionError(null)} className="btn-ghost h-6 !px-2 text-[12px] text-standby-800">
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && items.length === 0 ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="space-y-2.5 lg:col-span-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="workspace-shimmer h-[92px] rounded-xl" />
              ))}
            </div>
            <div className="workspace-shimmer h-[420px] rounded-xl lg:col-span-7" />
          </div>
        ) : visible.length === 0 ? (
          !error && (
            <motion.div initial={reduce ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING}>
              <EmptyState
                icon={items.length > 0 ? <CheckCheck className="h-5 w-5 text-go-600" /> : <Inbox className="h-5 w-5" />}
                title={items.length > 0 ? "All caught up" : "Nothing needs your sign-off"}
                description={
                  items.length > 0
                    ? "Every request in this queue has a decision. New ones will appear here."
                    : "When EVENTRA wants to contact a vendor, book, or spend above your limits, the request lands here with its reasoning."
                }
                action={
                  items.length > 0 ? (
                    <button onClick={() => fetchApprovals()} className="btn-secondary">
                      <RefreshCw className="h-3.5 w-3.5" /> Check for new requests
                    </button>
                  ) : undefined
                }
              />
            </motion.div>
          )
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            {/* ── Queue ─────────────────────────── */}
            <div className="space-y-5 lg:col-span-5" role="listbox" aria-label="Approval requests">
              {groups.map((group) => {
                const groupPending = group.items.filter((i) => !resolvedIds[i.id]);
                const batchable = groupPending.filter((i) => i.canBatch);
                const running = batch?.key === group.key;
                return (
                  <section key={group.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-[13.5px] font-semibold text-ink-900">{group.label}</h3>
                        <span className="font-mono text-[11px] text-ink-400">{groupPending.length} waiting</span>
                      </div>
                      {batchable.length > 1 && !running && batchConfirm !== group.key && (
                        <button
                          onClick={() => setBatchConfirm(group.key)}
                          disabled={!!batch || processing}
                          className="btn-ghost h-7 !px-2.5 text-[12px] text-ink-700"
                        >
                          <CheckCheck className="h-3.5 w-3.5" /> Approve all {batchable.length}
                        </button>
                      )}
                    </div>

                    {/* Batch confirm / progress */}
                    <AnimatePresence initial={false}>
                      {batchConfirm === group.key && !running && (
                        <PresenceItem key="confirm">
                          <div className="rounded-xl border border-ink-900 bg-ink-900 px-4 py-3 text-ink-50 shadow-md">
                            <p className="text-[13px] leading-snug">
                              Approve all <strong>{batchable.length}</strong> {group.label.toLowerCase()} requests?
                              {group.key === "COMMUNICATION_OUTREACH" &&
                                " EVENTRA will start contacting each of these vendors."}
                            </p>
                            <div className="mt-2.5 flex justify-end gap-2">
                              <button onClick={() => setBatchConfirm(null)} className="btn h-8 text-ink-300 hover:text-white">
                                Cancel
                              </button>
                              <button onClick={() => runBatch(group.key)} className="btn-cue h-8">
                                <CheckCheck className="h-3.5 w-3.5" /> Yes, approve {batchable.length}
                              </button>
                            </div>
                          </div>
                        </PresenceItem>
                      )}
                      {running && batch && (
                        <PresenceItem key="progress">
                          <div className="rounded-xl border border-ink-200 bg-[#FDFCFA] px-4 py-3">
                            <div className="flex items-center justify-between text-[12.5px]">
                              <span className="flex items-center gap-2 font-semibold text-ink-800">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Approving…
                              </span>
                              <span className="font-mono text-ink-500">
                                {batch.done} of {batch.total}
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-200/70">
                              <motion.div
                                className="h-full rounded-full bg-go-500"
                                animate={{ width: `${(batch.done / batch.total) * 100}%` }}
                                transition={SPRING}
                              />
                            </div>
                          </div>
                        </PresenceItem>
                      )}
                    </AnimatePresence>

                    <div className="space-y-2">
                      <AnimatePresence initial={false}>
                        {group.items.map((req, idx) => (
                          <PresenceItem key={req.id}>
                            <QueueCard
                              req={req}
                              index={idx}
                              active={activeId === req.id}
                              status={resolvedIds[req.id]}
                              busy={batch?.current === req.id}
                              onSelect={() => {
                                setActiveId(req.id);
                                setShowRejectInput(false);
                                setActionError(null);
                                setConfirmNoAmount(null);
                              }}
                            />
                          </PresenceItem>
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                );
              })}
            </div>

            {/* ── Decision sheet ────────────────── */}
            <div className="lg:sticky lg:top-16 lg:col-span-7">
              <AnimatePresence mode="wait">
                {activeRequest && impactCfg ? (
                  <motion.div
                    key={activeRequest.id}
                    initial={reduce ? false : { opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                    className="surface overflow-hidden"
                  >
                    <div className="space-y-3 border-b border-ink-200 px-6 pb-5 pt-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {resolution ? (
                            <CueChip tone={resolution === "approved" ? "go" : "idle"}>
                              {resolution === "approved" ? "You approved this" : "You declined this"}
                            </CueChip>
                          ) : (
                            <CueChip tone="standby" pulse>
                              Waiting for your decision
                            </CueChip>
                          )}
                          <CueChip tone={impactCfg.tone}>{impactCfg.label}</CueChip>
                        </div>
                        <Link
                          href={`/events/${eventId}/approvals/${activeRequest.id}`}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-900"
                        >
                          Full record <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      <h2
                        className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink-900"
                        style={{ fontStretch: "88%" }}
                      >
                        {activeRequest.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-2">
                        {activeRequest.category && (
                          <span className="chip border-ink-200 bg-ink-100 text-ink-700">{activeRequest.category}</span>
                        )}
                        {activeRequest.channel && <ChannelChip channel={activeRequest.channel} />}
                        <span className="text-[12.5px] text-ink-500">
                          Asked by <strong className="font-semibold text-ink-700">{activeRequest.requestedBy}</strong>
                          {activeRequest.createdAt && (
                            <>
                              {" "}
                              · <span title={new Date(activeRequest.createdAt).toLocaleString()}>{timeAgo(activeRequest.createdAt)}</span>
                            </>
                          )}
                        </span>
                      </div>
                      {!resolution && activeRequest.expiresAt && <DecideBy iso={activeRequest.expiresAt} />}
                    </div>

                    <div className="space-y-5 px-6 py-5">
                      <MoneyPanel req={activeRequest} />

                      <section className="rounded-xl border border-agent-200 bg-agent-50/70 p-4">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-label text-agent-700">
                            {activeRequest.whyIsDerived ? "Why this needs you" : "✦ Why the agent proposes it"}
                          </span>
                          {!activeRequest.whyIsDerived && <ProvenanceBadge source="AGENT" size="sm" />}
                        </div>
                        <p className="text-[13.5px] leading-relaxed text-agent-950">{activeRequest.why}</p>
                      </section>

                      <ActionDetails req={activeRequest} />

                      {!resolution && <Consequences req={activeRequest} />}

                      <AnimatePresence>
                        {confirmNoAmount === activeRequest.id && !resolution && (
                          <motion.div
                            initial={reduce ? false : { opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex items-start gap-2 rounded-xl border border-standby-300 bg-standby-50 px-4 py-3 text-[13px] text-standby-900"
                          >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-standby-600" />
                            <span>
                              <strong className="font-semibold">Approve without knowing the amount?</strong> Press Approve again to
                              confirm, or decline and ask the vendor for a price first.
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {showRejectInput && !resolution && (
                          <motion.div
                            initial={reduce ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-2 overflow-hidden"
                          >
                            <label htmlFor="reject-reason" className="eyebrow block text-cue-700">
                              Reason for declining (saved to the history log)
                            </label>
                            <textarea
                              id="reject-reason"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setShowRejectInput(false);
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleAction("denied");
                              }}
                              placeholder="Why are you saying no? (optional)"
                              rows={3}
                              autoFocus
                              className="w-full rounded-xl border border-ink-200 bg-ink-50 p-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-cue-400 focus:bg-white focus:outline-none"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {resolution && (
                          <motion.div
                            initial={reduce ? false : { opacity: 0, scale: 0.96, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={SPRING}
                            className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
                              resolution === "approved" ? "border-go-200 bg-go-50 text-go-900" : "border-ink-200 bg-ink-100 text-ink-800"
                            }`}
                          >
                            {resolution === "approved" ? (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-go-600" />
                            ) : (
                              <XCircle className="h-5 w-5 shrink-0 text-ink-500" />
                            )}
                            <div>
                              <div className="text-[13.5px] font-semibold">
                                {resolution === "approved" ? "Approval recorded" : "Request declined"}
                              </div>
                              <div className="text-[12.5px] opacity-80">
                                {resolution === "approved"
                                  ? "Saved. EVENTRA takes it from here — you'll see the outcome in Messages & Calls."
                                  : "Saved. Nothing will happen for this request."}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {!resolution && (
                      <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-ink-200 bg-ink-50/80 px-6 py-4 sm:flex-row sm:items-center">
                        <p className="flex items-center gap-2 text-[12px] text-ink-500">
                          <Fingerprint className="h-4 w-4 text-ink-400" />
                          Your decision is saved to the event&apos;s history log.
                        </p>
                        <div className="relative flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => (showRejectInput ? handleAction("denied") : setShowRejectInput(true))}
                            disabled={processing || !!batch}
                            className="btn-secondary flex-1 sm:flex-none"
                          >
                            {showRejectInput ? "Confirm decline" : "Decline"}
                            <Kbd dim>D</Kbd>
                          </button>
                          <motion.button
                            type="button"
                            data-guide-step="approve_requests"
                            onClick={() => handleAction("approved")}
                            disabled={processing || !!batch}
                            whileTap={reduce ? undefined : { scale: 0.96 }}
                            className="btn-cue flex-1 px-5 sm:flex-none"
                          >
                            {processing ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                {confirmNoAmount === activeRequest.id
                                  ? "Yes, approve"
                                  : activeRequest.money.amount !== null
                                  ? `Approve ${formatMoney(activeRequest.money.amount, activeRequest.money.currency)}`
                                  : "Approve"}
                                <Kbd dim light>
                                  A
                                </Kbd>
                              </>
                            )}
                          </motion.button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="surface p-16 text-center text-[13px] text-ink-500">Pick a request to see its details and decide.</div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* success burst + toast */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[61] -translate-x-1/2">
        <Celebrate show={celebrate} label="Approved" />
      </div>
      <Toast message={toast?.msg ?? null} tone={toast?.tone ?? "ink"} onDone={() => setToast(null)} />
    </EventShell>
  );
}

/* ── Queue card ───────────────────────────────────────────── */

function QueueCard({
  req,
  index,
  active,
  status,
  busy,
  onSelect,
}: {
  req: DisplayApproval;
  index: number;
  active: boolean;
  status?: Resolution;
  busy: boolean;
  onSelect: () => void;
}) {
  const imp = IMPACT[req.impact];
  return (
    <PopCard index={index} interactive={!status} className="rounded-xl">
      <button
        id={`approval-${req.id}`}
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={`group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cue-500 ${
          active ? "border-ink-900 bg-[#FDFCFA] shadow-md" : "border-ink-200 bg-[#FDFCFA] hover:border-ink-300"
        } ${status ? "opacity-80" : ""}`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-1 transition-colors ${
            status ? (status === "approved" ? "bg-go-500" : "bg-ink-300") : imp.bar
          }`}
        />
        {active && (
          <motion.span
            layoutId="approval-active-glow"
            className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-ink-900/80"
            transition={SPRING}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="block truncate text-[14px] font-semibold leading-snug text-ink-900">{req.title}</span>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-500" />
            ) : status === "approved" ? (
              <CueChip tone="go">Approved</CueChip>
            ) : status === "denied" ? (
              <CueChip tone="idle">Declined</CueChip>
            ) : (
              <ChevronRight
                className={`h-4 w-4 shrink-0 transition ${active ? "text-ink-900" : "text-ink-300 group-hover:translate-x-0.5 group-hover:text-ink-500"}`}
              />
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-500">
            {req.category && <span className="chip border-ink-200 bg-ink-100/80 py-0 text-[10.5px] text-ink-700">{req.category}</span>}
            {!status && <CueChip tone={imp.tone} className="py-0 text-[10.5px]">{imp.label}</CueChip>}
            {req.money.amount !== null && (
              <span className="font-semibold tabular-nums text-ink-800">{formatMoney(req.money.amount, req.money.currency)}</span>
            )}
            {req.money.involvesMoney && req.money.amount === null && !status && (
              <span className="font-semibold text-standby-700">Amount not given</span>
            )}
            <span className="truncate">
              {req.requestedBy}
              {req.createdAt ? ` · ${timeAgo(req.createdAt)}` : ""}
            </span>
          </span>
          {!status && req.expiresAt && (
            <span className="mt-1 block">
              <DecideBy iso={req.expiresAt} compact />
            </span>
          )}
        </span>
      </button>
    </PopCard>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function Kbd({ children, dim, light }: { children: React.ReactNode; dim?: boolean; light?: boolean }) {
  return (
    <kbd
      className={`ml-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded border px-1 font-mono text-[10px] font-semibold ${
        light ? "border-white/30 text-white/80" : "border-ink-300 bg-[#FDFCFA] text-ink-500"
      } ${dim ? "hidden lg:inline-grid" : ""}`}
    >
      {children}
    </kbd>
  );
}

function ChannelChip({ channel }: { channel: string }) {
  const c = channel.toLowerCase();
  const Icon = c === "call" || c === "voice" ? Phone : c === "whatsapp" ? MessageSquare : Send;
  return (
    <span className="chip border-info-200 bg-info-50 text-info-700">
      <Icon className="h-3 w-3" />
      {c === "whatsapp" ? "WhatsApp" : humanizeCode(channel)}
    </span>
  );
}

const SHOWN_ELSEWHERE = new Set([
  "title",
  "description",
  "reason",
  "ai_context",
  "reasoning",
  "recommendation",
  "action",
  "candidate_name",
  "vendor_name",
  "provider_name",
  "category",
  "channel",
  "preferred_channel",
  "amount",
  "cost",
  "price",
  "quoted_amount",
  "total",
  "currency",
]);

/** Readable request fields up front; IDs and codes tucked into "Technical details". */
function ActionDetails({ req }: { req: DisplayApproval }) {
  const action = (req.raw.requested_action || {}) as Record<string, unknown>;
  const scalar = (v: unknown) => v !== null && v !== undefined && v !== "" && ["string", "number", "boolean"].includes(typeof v);
  const entries = Object.entries(action).filter(([k, v]) => !SHOWN_ELSEWHERE.has(k) && scalar(v));
  const isTech = (k: string, v: unknown) => /(^|_)id$/.test(k) || (typeof v === "string" && isUuid(v));
  const readable = entries.filter(([k, v]) => !isTech(k, v));
  const tech: Array<[string, string]> = [
    ...entries.filter(([k, v]) => isTech(k, v)).map(([k, v]) => [humanizeCode(k), String(v)] as [string, string]),
    ["Request", req.raw.id],
    ["Action type", req.actionType],
    ...(req.raw.target_id ? ([["Target", req.raw.target_id]] as Array<[string, string]>) : []),
    ...(req.raw.impact_level ? ([["Impact level (raw)", req.raw.impact_level]] as Array<[string, string]>) : []),
  ];

  return (
    <section className="space-y-3">
      {readable.length > 0 && (
        <div>
          <h4 className="eyebrow mb-1.5">Details</h4>
          <dl className="ruled rounded-xl border border-ink-200 px-4">
            {readable.slice(0, 10).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-[12.5px] text-ink-500">{humanizeCode(k)}</dt>
                <dd className="truncate text-right text-[13px] font-medium text-ink-900">
                  {typeof v === "boolean" ? (v ? "Yes" : "No") : humanizeCode(String(v))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <details className="group rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-[12.5px]">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-ink-500 hover:text-ink-800">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          Technical details
        </summary>
        <dl className="mt-2 space-y-1">
          {tech.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-500">{k}</dt>
              <dd className="truncate font-mono text-[11.5px] text-ink-700" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

