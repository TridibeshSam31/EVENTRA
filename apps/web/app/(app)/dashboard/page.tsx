"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock,
  CheckCircle2,
  Users,
  DollarSign,
  Activity,
  AlertTriangle,
  Radar,
  Radio,
  PlusCircle,
  Building2,
  Loader2,
  ShieldCheck,
  Calendar,
  Sparkles,
} from "lucide-react";
import { listEvents } from "@/lib/api/events";
import { getLiveState } from "@/lib/api/live";
import { getPlan } from "@/lib/api/planning";
import { getActivityFeed } from "@/lib/api/observability";
import { listIncidents } from "@/lib/api/incidents";
import { formatRelativeTime } from "@/lib/utils/time";

export default function DashboardHome() {
  const [events, setEvents] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [liveState, setLiveState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const evList = await listEvents();
        setEvents(evList || []);

        if (evList && evList.length > 0) {
          const currentEvent = evList[0];
          setActiveEvent(currentEvent);

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
          } catch {}
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <Loader2 className="w-8 h-8 text-[#D6003C] animate-spin mb-3" />
        <h2 className="text-lg font-bold tracking-tight text-slate-800">Connecting to Operations Fleet…</h2>
        <p className="text-xs text-slate-500 mt-1">Retrieving authoritative events and live telemetry.</p>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="max-w-xl mx-auto my-16 p-10 bg-white rounded-2xl border border-slate-200 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
          <Building2 className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">No Events Found</h2>
        <p className="text-xs text-slate-500">
          There are no operational events currently configured in this environment. Deploy your first event to begin autonomous operations.
        </p>
        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition"
        >
          <PlusCircle className="w-4 h-4" />
          Initialize First Event
        </Link>
      </div>
    );
  }

  const sortedTasks = [...tasks].sort((a, b) =>
    a.completed === b.completed ? 0 : a.completed ? 1 : -1
  );

  const curr = activeEvent.currency === "INR" || !activeEvent.currency ? "₹" : `${activeEvent.currency} `;
  const totalBudget = Number(activeEvent.total_budget) || 0;
  const spentBudget = liveState?.budget_deviation?.total_spent ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Top Header & Fleet Status Bar */}
      <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              Fleet Operations
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Active: {activeEvent.name}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">
            Executive Command Center
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time status, financial variance, and risk radar across active deployments.
          </p>
        </div>

        {/* Big Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-100">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>Headcount</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {(activeEvent.guest_count || 0).toLocaleString()}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-slate-400" />
              <span>Committed / Budget</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 truncate">
              {curr}{spentBudget > 0 ? (spentBudget / 1000).toFixed(0) : 0}k
              <span className="text-xs text-slate-400 font-normal ml-1">
                / {totalBudget > 0 ? `${(totalBudget / 1000).toFixed(0)}k` : "Unset"}
              </span>
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span>Operational Health</span>
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-700 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              {activeEvent.state || "NORMAL"}
            </div>
          </div>
        </div>
      </div>

      {/* 4 Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Event Workspace Quick Link */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between space-y-4 hover:border-slate-300 transition">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Active Event
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {activeEvent.lifecycle_state || "PLANNED"}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 leading-snug">{activeEvent.name}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {activeEvent.location || "Venue unset"} •{" "}
              {activeEvent.start_datetime ? new Date(activeEvent.start_datetime).toLocaleDateString() : "Unscheduled"}
            </p>
          </div>

          <Link
            href={`/events/${activeEvent.id}`}
            className="w-full py-2.5 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Open Event Workspace</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-80" />
          </Link>
        </div>

        {/* Card 2: Risk Radar / Incidents */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between space-y-4 hover:border-slate-300 transition">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-rose-600" />
                <h3 className="text-sm font-bold text-slate-900">Risk Radar</h3>
              </div>
              <Link
                href={`/events/${activeEvent.id}/incidents`}
                className="text-[11px] text-slate-500 hover:text-slate-900 font-semibold flex items-center gap-1"
              >
                Inspect <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="space-y-2">
              {incidents.slice(0, 2).map((inc) => (
                <div
                  key={inc.id}
                  className="p-2.5 rounded-lg bg-rose-50 border border-rose-200/80 text-xs space-y-0.5"
                >
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-rose-700">
                    <span>{inc.severity}</span>
                    <span>{inc.status}</span>
                  </div>
                  <div className="font-semibold text-rose-950 truncate">{inc.title}</div>
                </div>
              ))}
              {incidents.length === 0 && (
                <p className="text-xs text-slate-400 py-3 text-center">No active operational disruptions.</p>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span>Critical Alerts</span>
            <span className="font-bold text-slate-700">{incidents.length} Active</span>
          </div>
        </div>

        {/* Card 3: Budget Burn Rate */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between space-y-4 hover:border-slate-300 transition">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Budget Tracking</h3>
              </div>
              <Link
                href={`/events/${activeEvent.id}/budget`}
                className="text-[11px] text-slate-500 hover:text-slate-900 font-semibold flex items-center gap-1"
              >
                Plan <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="space-y-2">
              <div className="text-xl font-bold font-mono text-slate-900">
                {curr}{spentBudget.toLocaleString()}
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#D6003C] h-full rounded-full transition-all"
                  style={{
                    width: `${totalBudget > 0 ? Math.min(100, Math.round((spentBudget / totalBudget) * 100)) : 0}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Cap: {totalBudget > 0 ? `${curr}${totalBudget.toLocaleString()}` : "Unset"}</span>
                <span>
                  {totalBudget > 0 ? `${Math.round((spentBudget / totalBudget) * 100)}% committed` : "0%"}
                </span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span>Variance Status</span>
            <span className="font-bold text-emerald-700">On Track</span>
          </div>
        </div>

        {/* Card 4: Action Items */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between space-y-4 hover:border-slate-300 transition">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-slate-600" />
                <h3 className="text-sm font-bold text-slate-900">Execution Plan</h3>
              </div>
              <span className="text-xs font-mono font-bold text-slate-500">
                {sortedTasks.filter((t) => t.completed).length}/{sortedTasks.length} Done
              </span>
            </div>

            <div className="space-y-2 max-h-[140px] overflow-y-auto no-scrollbar">
              {sortedTasks.slice(0, 3).map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-xs">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${
                      task.completed ? "text-emerald-600" : "text-slate-300"
                    }`}
                  />
                  <span
                    className={`truncate ${
                      task.completed ? "text-slate-400 line-through" : "text-slate-800 font-medium"
                    }`}
                  >
                    {task.title}
                  </span>
                </div>
              ))}
              {sortedTasks.length === 0 && (
                <p className="text-xs text-slate-400 py-3 text-center">No execution tasks scheduled.</p>
              )}
            </div>
          </div>

          <Link
            href={`/events/${activeEvent.id}/plan`}
            className="text-[11px] text-[#D6003C] hover:underline font-semibold flex items-center justify-between pt-2 border-t border-slate-100"
          >
            <span>Review Full Timeline</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Bottom Row: Recent Activity & Quick Nav */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Recent Activity Feed (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-500" />
              Fleet Activity Stream
            </h3>
            <Link
              href={`/events/${activeEvent.id}/activity`}
              className="text-xs font-semibold text-[#D6003C] hover:underline flex items-center gap-1"
            >
              Open Unified Activity <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-3">
            {activity.slice(0, 5).map((act, idx) => (
              <div key={act.id || idx} className="flex items-start gap-3 text-xs border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
                <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-slate-800 leading-snug">
                    <strong className="text-slate-900">{act.actor}</strong> {act.message || act.action}
                  </p>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatRelativeTime(act.timestamp)}
                  </span>
                </div>
              </div>
            ))}
            {activity.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">No recent activity events recorded.</p>
            )}
          </div>
        </div>

        {/* Right Column: Fleet Shortcuts (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-3">
            Operations Shortcuts
          </h3>

          <div className="space-y-2 text-xs">
            <Link
              href={`/events/${activeEvent.id}/live`}
              className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-rose-600" />
                <span className="font-semibold">Live Operations Command</span>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>

            <Link
              href={`/events/${activeEvent.id}/recovery`}
              className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-amber-600" />
                <span className="font-semibold">Incident Recovery Engine</span>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>

            <Link
              href={`/events/${activeEvent.id}/approvals`}
              className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="font-semibold">Governance Sign-off Queue</span>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>

            <Link
              href={`/events/${activeEvent.id}/procurement`}
              className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-slate-600" />
                <span className="font-semibold">Quotes &amp; Supplier Matrix</span>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
