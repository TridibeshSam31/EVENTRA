"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEvent } from "../../../hooks/useEvent";
import { useLiveState } from "../../../hooks/useLiveState";
import {
  Radio,
  Settings,
  Building2,
  CalendarCheck,
  Clock,
  DollarSign,
  Users,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Compass,
} from "lucide-react";

export default function EventOverviewPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const { event, specification, isLoading } = useEvent(eventId);
  const { liveState } = useLiveState(eventId);

  const modules = [
    {
      title: "Final Execution Plan",
      description: "Authoritative operational blueprint: schedule, provider bindings, critical path CPM, and checkpoints.",
      href: `/events/${eventId}/execution-plan`,
      icon: Compass,
      badge: "EXECUTION READY",
      color: "blue",
      highlight: true,
    },
    {
      title: "Live Operations Command Center",
      description: "Real-time task telemetry, schedule deviations, and operational triggers.",
      href: `/events/${eventId}/live`,
      icon: Radio,
      badge: liveState?.lifecycle_state || "PLANNED",
      color: "emerald",
    },
    {
      title: "Incident Triage & Blast Radius",
      description: "Log disruptions, compute downstream dependency impact, evaluate risk scorecard.",
      href: `/events/${eventId}/incidents`,
      icon: AlertTriangle,
      badge: "ACTIVE",
      color: "red",
    },
    {
      title: "Recovery Engine",
      description: "Generate deterministic candidate recovery options and evaluate trade-offs.",
      href: `/events/${eventId}/recovery`,
      icon: RotateCcw,
      badge: "OPTIMIZER",
      color: "purple",
    },
    {
      title: "Governance & Approvals",
      description: "Review escalated actions, enforce separation of duties, authorize mutations.",
      href: `/events/${eventId}/approvals`,
      icon: ShieldCheck,
      badge: "GOVERNANCE",
      color: "amber",
    },
    {
      title: "Planning Engine & DAG",
      description: "Materialize tasks, dependencies, resources, and baseline budget items.",
      href: `/events/${eventId}/plan`,
      icon: CalendarCheck,
      badge: "CPM DAG",
      color: "blue",
    },
    {
      title: "Schedule Engine & Gantt",
      description: "Forward-pass scheduler, critical path identification, slack analysis.",
      href: `/events/${eventId}/schedule`,
      icon: Clock,
      badge: "TIMELINE",
      color: "blue",
    },
    {
      title: "Decimal Budget Engine",
      description: "Deterministic totals, category breakdown, hard budget ceiling validation.",
      href: `/events/${eventId}/budget`,
      icon: DollarSign,
      badge: "ACCOUNTING",
      color: "blue",
    },
    {
      title: "Provider Network & Assignments",
      description: "Vendor directory, capability filtering, operational contract assignments.",
      href: `/events/${eventId}/vendors`,
      icon: Users,
      badge: "NETWORK",
      color: "blue",
    },
    {
      title: "Venue Discovery & Suitability",
      description: "Search venues, evaluate physical amenities and capacity suitability checks.",
      href: `/events/${eventId}/venue`,
      icon: Building2,
      badge: "FACILITIES",
      color: "blue",
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Event Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5 mb-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800 font-bold">
              {event?.event_type || specification?.event_type || "EVENT"}
            </span>
            <span className="text-xs font-mono text-slate-500">
              ID: {eventId}
            </span>
            <span
              className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full ${
                event?.state === "EMERGENCY"
                  ? "bg-red-950 text-red-400 border border-red-800"
                  : event?.state === "CRITICAL"
                  ? "bg-orange-950 text-orange-400 border border-orange-800"
                  : "bg-emerald-950 text-emerald-400 border border-emerald-800"
              }`}
            >
              {event?.state || "NORMAL"}
            </span>
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {event?.name || specification?.title || "Operational Event Workspace"}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            {event?.description || specification?.description || "Deterministic operational event specification"}
          </p>

          <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-slate-800/80 text-xs font-mono text-slate-300">
            <div>
              <span className="text-slate-500">CAPACITY: </span>
              <span className="font-semibold">{event?.guest_count || specification?.guest_count || 300} attendees</span>
            </div>
            <div>
              <span className="text-slate-500">BUDGET: </span>
              <span className="font-semibold">${Number(event?.total_budget || specification?.total_budget || 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-500">LOCATION: </span>
              <span className="font-semibold">{event?.location || "San Francisco"}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row md:flex-col gap-2 flex-shrink-0">
          <Link
            href={`/events/${eventId}/live`}
            className="flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/60 transition"
          >
            <Radio className="w-4 h-4 text-white" />
            <span>Open Command Center</span>
          </Link>
          <Link
            href={`/events/${eventId}/setup`}
            className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span>Inspect Specification</span>
          </Link>
        </div>
      </div>

      {/* Operational Modules Navigation Grid */}
      <div>
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
          Operational Control Modules
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`p-5 rounded-xl border transition flex flex-col justify-between group ${
                  m.highlight
                    ? "bg-emerald-950/20 border-emerald-800/40 hover:border-emerald-600 hover:bg-emerald-950/30"
                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`p-2 rounded-lg ${
                        m.highlight
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {m.badge}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition">
                    {m.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {m.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-white transition">
                  <span>Access Module</span>
                  <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
