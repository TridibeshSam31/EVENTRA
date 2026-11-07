"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Radio,
  Plus,
  ShieldCheck,
  Wallet,
  RotateCcw,
  FileText,
  MapPin,
  Users,
  Mic,
  Search,
  CalendarCheck,
} from "lucide-react";
import { listEventsOrThrow } from "@/lib/api/events";
import { getLiveState } from "@/lib/api/live";
import { getPlan } from "@/lib/api/planning";
import { getActivityFeed } from "@/lib/api/observability";
import { listIncidents } from "@/lib/api/incidents";
import { formatRelativeTime } from "@/lib/utils/time";
import { useEventStore, getActiveEventId, setActiveEventId } from "@/stores/eventStore";
import { PageHeader, Panel, CueChip, EmptyState, Meter } from "@/components/ds";
import { PopCard, AnimatedNumber, StaggerList } from "@/components/ds/motion";
import { humanizeAction, humanizeActor, humanizeCode, stripIds } from "@/lib/humanize";

/** Rewrite SCREAMING_CODES embedded in a sentence ("…for 'COMMUNICATION_OUTREACH'…") as words. */
function humanizeInline(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/'?([A-Z]{2,}(?:_[A-Z0-9]+)+)'?/g, (_m, code: string) => humanizeAction(code).toLowerCase())
    .replace(/\(Impact: ([A-Z]+)\)/g, (_m, lvl: string) => `(${lvl.charAt(0)}${lvl.slice(1).toLowerCase()} impact)`);
}

const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNED: "Planning",
  PLANNING: "Planning",
  READY: "Ready",
  LIVE: "Happening now",
  COMPLETED: "Finished",
  CONCLUDED: "Finished",
  CANCELLED: "Cancelled",
};

function stateTone(state?: string) {
  if (state === "DISRUPTED") return { tone: "cue" as const, label: "Urgent problem", pulse: true };
  if (state === "DEGRADED") return { tone: "standby" as const, label: "Needs attention", pulse: true };
  return { tone: "go" as const, label: "No problems", pulse: false };
}

function initials(name?: string) {
  return (name || "Event")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function dateParts(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: d.toLocaleDateString(undefined, { day: "2-digit" }),
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    year: d.getFullYear(),
    full: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/* ── Event card on the board ─────────────────────────────── */
function EventCard({ ev, focused, index }: { ev: any; focused: boolean; index: number }) {
  const dp = dateParts(ev.start_datetime);
  const st = stateTone(ev.state);
  const lifecycle = LIFECYCLE_LABELS[(ev.lifecycle_state || "").toUpperCase()] || "Planning";
  const type = (ev.event_type || "Event").replace(/_/g, " ").toLowerCase();

  return (
    <PopCard index={index} className="h-full rounded-xl">
    <Link
      href={`/events/${ev.id}`}
      onClick={() => setActiveEventId(ev.id)}
      className={`group relative flex h-full flex-col overflow-hidden rounded-xl border bg-[#FDFCFA] shadow-sm transition-colors ${
        focused ? "border-ink-900 ring-1 ring-ink-900" : "border-ink-200 hover:border-ink-300"
      }`}
    >
      <div className="flex items-stretch">
        {/* Date block — like a ticket stub */}
        <div
          className={`flex w-[74px] shrink-0 flex-col items-center justify-center border-r border-dashed py-4 ${
            focused ? "border-ink-700 bg-ink-900 text-ink-50" : "border-ink-200 bg-ink-100/60 text-ink-800"
          }`}
        >
          {dp ? (
            <>
              <span className={`font-mono text-[10px] tracking-label ${focused ? "text-cue-300" : "text-cue-600"}`}>{dp.month}</span>
              <span className="font-display text-[30px] font-extrabold leading-none" style={{ fontStretch: "85%" }}>
                {dp.day}
              </span>
              <span className={`font-mono text-[10px] ${focused ? "text-ink-400" : "text-ink-500"}`}>{dp.year}</span>
            </>
          ) : (
            <>
              <span className="font-display text-[18px] font-extrabold leading-none" style={{ fontStretch: "85%" }}>
                {initials(ev.name)}
              </span>
              <span className={`mt-1 font-mono text-[9.5px] uppercase tracking-label ${focused ? "text-ink-400" : "text-ink-400"}`}>
                No date
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow capitalize">{type}</span>
            {focused && <span className="font-mono text-[9.5px] uppercase tracking-label text-cue-600">In focus</span>}
          </div>
          <h3
            className="mt-1 line-clamp-2 font-display text-[19px] font-bold leading-[1.1] tracking-[-0.015em] text-ink-900"
            style={{ fontStretch: "90%" }}
          >
            {ev.name}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {ev.location || <span className="text-ink-400">Location unset</span>}
            </span>
            {ev.guest_count ? (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {Number(ev.guest_count).toLocaleString()} guests
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-200/80 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <CueChip tone={st.tone} pulse={st.pulse}>
            {st.label}
          </CueChip>
          <span className="chip border-ink-200 bg-[#FDFCFA] text-ink-600">{lifecycle}</span>
        </div>
        <ArrowUpRight className="h-4 w-4 text-ink-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-900" />
      </div>
    </Link>
    </PopCard>
  );
}

/* ── Loading skeleton ────────────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading your events">
      <div className="space-y-3">
        <div className="workspace-shimmer h-3 w-32 rounded" />
        <div className="workspace-shimmer h-8 w-72 rounded-lg" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="workspace-shimmer h-[150px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="workspace-shimmer h-72 rounded-xl lg:col-span-8" />
        <div className="workspace-shimmer h-72 rounded-xl lg:col-span-4" />
      </div>
    </div>
  );
}

/* ── First-run empty state ───────────────────────────────── */
function FirstRun() {
  const steps = [
    { n: "01", icon: Mic, title: "Describe it", body: "Type or say what you're planning — guests, city, date, budget." },
    { n: "02", icon: Search, title: "EVENTRA finds vendors", body: "Real venues and providers, checked against your requirements." },
    { n: "03", icon: CalendarCheck, title: "Run the day", body: "Live status, incidents and recovery — with you approving what matters." },
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="surface-ink relative overflow-hidden rounded-2xl p-8 sm:p-12">
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(214,0,60,0.45), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-label text-ink-400">
            <span className="cue-light bg-standby-500 animate-cue-blink" />
            Standing by
          </div>
          <h1
            className="mt-4 max-w-[16ch] font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.02em] text-ink-50 sm:text-[56px]"
            style={{ fontStretch: "86%" }}
          >
            No events on the run sheet yet.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-300">
            Tell EVENTRA what you&apos;re planning. It will build the plan, find real vendors, contact them and keep the event on
            track on the day.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/events/new" className="btn-cue h-11 px-5 text-[14px]">
              <Plus className="h-4 w-4" />
              Plan your first event
            </Link>
          </div>
        </div>

        <ol className="relative mt-10 grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] tracking-label text-ink-500">{s.n}</span>
                <s.icon className="h-4 w-4 text-cue-400" />
              </div>
              <div className="mt-3 text-[14px] font-semibold text-ink-50">{s.title}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const [events, setEvents] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [liveState, setLiveState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incidentsError, setIncidentsError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const activeEventId = useEventStore((state) => state.activeEventId);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      setIncidentsError(false);
      let evList: any[] = [];
      try {
        evList = await listEventsOrThrow();
      } catch (err: any) {
        // A failed request is NOT "no events" — show a distinct, retryable error.
        console.error("Failed to load events:", err);
        setLoadError(err?.message || "The server didn't respond.");
        setIsLoading(false);
        return;
      }
      try {
        setEvents(evList || []);

        if (evList && evList.length > 0) {
          const targetId = activeEventId || getActiveEventId();
          const currentEvent = evList.find((e: any) => e.id === targetId) || evList[0];
          setActiveEvent(currentEvent);
          if (currentEvent?.id && currentEvent.id !== activeEventId) {
            setActiveEventId(currentEvent.id);
          }

          try {
            const ls = await getLiveState(currentEvent.id);
            if (ls) {
              setLiveState(ls);
              if (ls.task_progress) {
                setTasks(
                  ls.task_progress.map((t: any) => ({
                    id: t.task_id,
                    title: t.task_name,
                    completed: t.status === "COMPLETED",
                    dueDate: t.planned_end ? new Date(t.planned_end).toLocaleDateString() : "TBD",
                    urgent: t.priority === "CRITICAL" || t.priority === "HIGH",
                  }))
                );
              }
            }
          } catch {
            try {
              const plan = await getPlan(currentEvent.id);
              if (plan && plan.tasks) {
                setTasks(
                  plan.tasks.map((t: any) => ({
                    id: t.id,
                    title: t.name,
                    completed: t.status === "COMPLETED",
                    dueDate: t.planned_end ? new Date(t.planned_end).toLocaleDateString() : "TBD",
                    urgent: t.priority === "CRITICAL" || t.priority === "HIGH",
                  }))
                );
              }
            } catch {}
          }

          try {
            const feed = await getActivityFeed(currentEvent.id, 10);
            if (feed && feed.items) {
              setActivity(
                feed.items.map((a: any) => ({
                  id: a.id,
                  type: a.category,
                  message: a.summary,
                  timestamp: a.timestamp || new Date().toISOString(),
                  actor: a.actor_id || "System",
                  action: a.status,
                }))
              );
            }
          } catch {}

          try {
            const incRes = await listIncidents(currentEvent.id);
            if (incRes && incRes.items) {
              setIncidents(incRes.items.filter((i: any) => i.status !== "RESOLVED"));
            }
          } catch {
            // Don't claim "no problems" when we couldn't check.
            setIncidentsError(true);
          }
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [reloadKey]);

  if (isLoading) return <DashboardSkeleton />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5 text-cue-600" />}
          title="Couldn't load your events"
          description={`${loadError} Your events haven't been lost — this is a connection problem. Check that the EVENTRA server is running, then try again.`}
          action={
            <button type="button" className="btn-primary" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </button>
          }
        />
      </div>
    );
  }
  if (!activeEvent) return <FirstRun />;

  const sortedTasks = [...tasks].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
  const doneCount = sortedTasks.filter((t) => t.completed).length;

  const curr = activeEvent.currency === "INR" || !activeEvent.currency ? "₹" : `${activeEvent.currency} `;
  const totalBudget = Number(activeEvent.total_budget) || 0;
  const spentBudget = liveState?.budget_deviation?.total_spent ?? 0;
  const spentPct = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
  const overBudget = totalBudget > 0 && spentBudget > totalBudget;

  const id = activeEvent.id;
  const shortcuts = [
    { href: `/events/${id}/live`, label: "Live event monitor", icon: Radio, tone: "text-cue-600" },
    { href: `/events/${id}/approvals`, label: "Approvals", icon: ShieldCheck, tone: "text-go-600" },
    { href: `/events/${id}/recovery`, label: "Backup plans", icon: RotateCcw, tone: "text-standby-600" },
    { href: `/events/${id}/procurement`, label: "Vendor quotes", icon: FileText, tone: "text-ink-600" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`My events · ${events.length}`}
        title={greeting() + "."}
        description={
          incidents.length > 0
            ? `${incidents.length} open problem${incidents.length === 1 ? "" : "s"} on ${activeEvent.name}. Start there.`
            : "Here's where every event stands, and what needs you next."
        }
        actions={
          <Link href="/events/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Plan a new event
          </Link>
        }
      />

      {/* Event board */}
      <section aria-label="Your events" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {events.map((ev, i) => (
          <EventCard key={ev.id} ev={ev} focused={ev.id === activeEvent.id} index={i} />
        ))}
        <PopCard index={events.length} className="rounded-xl">
        <Link
          href="/events/new"
          className="group flex h-full min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 text-ink-500 transition hover:border-ink-500 hover:bg-[#FDFCFA] hover:text-ink-900"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full border border-ink-300 transition group-hover:border-ink-900 group-hover:bg-ink-900 group-hover:text-ink-50">
            <Plus className="h-4 w-4" />
          </span>
          <span className="text-[13px] font-semibold">New event</span>
        </Link>
        </PopCard>
      </section>

      {/* Focused event run sheet */}
      <section aria-labelledby="focus-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-200 pb-3">
          <div>
            <div className="eyebrow">In focus</div>
            <h2
              id="focus-heading"
              className="mt-1 font-display text-[22px] font-extrabold tracking-[-0.02em] text-ink-900"
              style={{ fontStretch: "88%" }}
            >
              {activeEvent.name}
            </h2>
          </div>
          <Link href={`/events/${id}`} className="btn-secondary">
            Open event
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          {/* Needs you */}
          <Panel
            className="lg:col-span-5"
            eyebrow="Needs you"
            title={
              incidentsError
                ? "Couldn't check for problems"
                : incidents.length > 0
                ? `${incidents.length} open problem${incidents.length === 1 ? "" : "s"}`
                : "No open problems"
            }
            actions={
              <Link href={`/events/${id}`} className="btn-ghost h-7 px-2 text-[12px]">
                All decisions <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            {incidents.length > 0 ? (
              <StaggerList className="space-y-2">
                {incidents.slice(0, 3).map((inc) => (
                  <div key={inc.id} className="flex items-center gap-3 rounded-lg border border-cue-200 bg-cue-50/70 p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-cue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink-900">{inc.title}</div>
                      <div className="mt-0.5 text-[11.5px] text-cue-700">
                        {[humanizeCode(inc.severity), humanizeCode(inc.status)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Link href={`/events/${id}/incidents`} className="btn-cue h-7 shrink-0 px-2.5 text-[12px]">
                      Respond
                    </Link>
                  </div>
                ))}
              </StaggerList>
            ) : incidentsError ? (
              <div className="flex items-center gap-3 rounded-lg border border-standby-200 bg-standby-50/70 p-3 text-[13px] text-standby-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-standby-600" />
                <span className="flex-1">We couldn&apos;t load problems for this event, so we can&apos;t say it&apos;s all clear.</span>
                <button type="button" className="btn-secondary h-7 px-2.5 text-[12px]" onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-go-200 bg-go-50/60 p-3 text-[13px] text-go-800">
                <CheckCircle2 className="h-4 w-4 text-go-600" />
                No problems right now. Picks and approvals are listed on the event overview.
              </div>
            )}
          </Panel>

          {/* Budget */}
          <Panel
            className="lg:col-span-4"
            eyebrow="Budget"
            title={
              <span className="font-display text-[26px] font-bold tabular-nums tracking-[-0.02em]" style={{ fontStretch: "90%" }}>
                {curr}
                <AnimatedNumber value={spentBudget} />
              </span>
            }
            actions={
              <Link href={`/events/${id}/budget`} className="btn-ghost h-7 px-2 text-[12px]">
                <Wallet className="h-3.5 w-3.5" /> Budget
              </Link>
            }
          >
            <Meter value={spentBudget} max={totalBudget || 1} tone={overBudget ? "cue" : spentPct > 85 ? "standby" : "go"} label="Budget committed" />
            <div className="mt-2.5 flex items-center justify-between text-[12px]">
              <span className="text-ink-500">
                of {totalBudget > 0 ? `${curr}${totalBudget.toLocaleString()}` : "no cap set"}
              </span>
              {totalBudget <= 0 ? (
                <span className="font-semibold text-ink-500">No budget set</span>
              ) : overBudget ? (
                <span className="font-semibold text-cue-700">Over budget · {spentPct}%</span>
              ) : (
                <span className="font-semibold text-go-700">{spentPct}% committed</span>
              )}
            </div>
          </Panel>

          {/* Shortcuts */}
          <Panel className="lg:col-span-3" eyebrow="Jump to" bodyClassName="px-2 pb-2 pt-2">
            <ul>
              {shortcuts.map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink-800 transition hover:bg-ink-100"
                  >
                    <span className="flex items-center gap-2.5">
                      <s.icon className={`h-4 w-4 ${s.tone}`} />
                      {s.label}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-ink-300 transition group-hover:text-ink-700" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Tasks */}
          <Panel
            className="lg:col-span-5"
            eyebrow="Run sheet"
            title="Upcoming tasks"
            actions={
              <span className="font-mono text-[11px] text-ink-500">
                {doneCount}/{sortedTasks.length} done
              </span>
            }
          >
            {sortedTasks.length > 0 ? (
              <>
                <Meter value={doneCount} max={sortedTasks.length} tone="ink" className="mb-3" label="Tasks complete" />
                <ul className="ruled">
                  {sortedTasks.slice(0, 6).map((task) => (
                    <li key={task.id} className="flex items-center gap-3 py-2 text-[13px]">
                      {task.completed ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-go-600" />
                      ) : (
                        <Circle className={`h-4 w-4 shrink-0 ${task.urgent ? "text-cue-500" : "text-ink-300"}`} />
                      )}
                      <span className={`min-w-0 flex-1 truncate ${task.completed ? "text-ink-400 line-through" : "font-medium text-ink-800"}`}>
                        {task.title}
                      </span>
                      {task.urgent && !task.completed && (
                        <span className="font-mono text-[9.5px] uppercase tracking-label text-cue-600">Priority</span>
                      )}
                      <span className="timecode shrink-0 text-[11px] text-ink-400">{task.dueDate}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-500">No tasks yet — they appear once the plan is built.</p>
            )}
            <Link
              href={`/events/${id}/plan`}
              className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3 text-[12.5px] font-semibold text-ink-700 hover:text-ink-900"
            >
              Review full plan
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Panel>

          {/* Activity */}
          <Panel
            className="lg:col-span-7"
            eyebrow="Log"
            title="Recent activity"
            actions={
              <Link href={`/events/${id}/activity`} className="btn-ghost h-7 px-2 text-[12px]">
                See all <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          >
            {activity.length > 0 ? (
              <ol className="relative space-y-0.5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-ink-200">
                {activity.slice(0, 6).map((act, idx) => (
                  <li key={act.id || idx} className="relative flex items-start gap-3 py-2 pl-5">
                    <span
                      className={`absolute left-0 top-[13px] h-[11px] w-[11px] rounded-full border-2 border-[#FDFCFA] ${
                        idx === 0 ? "bg-cue-600" : "bg-ink-300"
                      }`}
                    />
                    <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-700">
                      <span className="font-semibold text-ink-900">{humanizeActor(act.actor)}</span>{" "}
                      {humanizeInline(stripIds(act.message)) || humanizeCode(act.action)}
                    </p>
                    <span className="timecode shrink-0 pt-0.5 text-[11px] text-ink-400">{formatRelativeTime(act.timestamp)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                className="border-0 bg-transparent py-6"
                title="Nothing logged yet"
                description="Agent actions, vendor replies and approvals will appear here as they happen."
              />
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}
