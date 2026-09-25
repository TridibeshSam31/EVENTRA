"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getFinalExecutionPlan, generateFinalExecutionPlan } from "../../../../lib/api/planning";
import type { FinalExecutionPlan, ExecutionPlanTask, PlanReadiness } from "../../../../types/api";
import {
  Compass,
  RefreshCw,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  Users,
  ArrowRight,
  GitCommit,
  Layers,
  ShieldAlert,
  Info,
  ChevronRight,
  Flag,
  Calendar,
  MapPin,
  Sparkles,
  Search,
  Filter,
} from "lucide-react";

export default function ExecutionPlanPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [plan, setPlan] = useState<FinalExecutionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<"ALL" | "CRITICAL" | "ASSIGNED" | "UNASSIGNED">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const loadPlan = async () => {
    setLoading(true);
    try {
      const data = await getFinalExecutionPlan(eventId);
      setPlan(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Execution plan could not be compiled. Ensure event state is initialized.");
      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      loadPlan();
    }
  }, [eventId]);

  const handleRecompile = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await generateFinalExecutionPlan(eventId);
      setPlan(data);
    } catch (err: any) {
      setError(err?.message || "Failed to recompile execution plan.");
    } finally {
      setRefreshing(false);
    }
  };

  const getReadinessBadge = (readiness: PlanReadiness) => {
    switch (readiness) {
      case "READY":
        return {
          bg: "bg-emerald-950/80 border-emerald-600 text-emerald-400",
          icon: CheckCircle2,
          label: "EXECUTION READY",
          description: "All mandatory tasks assigned, constraints respected, no blocking conflicts.",
        };
      case "PARTIALLY_READY":
        return {
          bg: "bg-amber-950/80 border-amber-600 text-amber-400",
          icon: AlertTriangle,
          label: "PARTIALLY READY",
          description: "Plan is executable, but non-critical tasks or warnings require monitoring.",
        };
      case "BLOCKED":
        return {
          bg: "bg-rose-950/80 border-rose-600 text-rose-400",
          icon: AlertOctagon,
          label: "EXECUTION BLOCKED",
          description: "Critical blockers prevent reliable execution. Action required.",
        };
      case "INCOMPLETE":
      default:
        return {
          bg: "bg-slate-900 border-slate-700 text-slate-400",
          icon: Info,
          label: "INCOMPLETE",
          description: "Required event tasks or operational specifications missing.",
        };
    }
  };

  const filteredTasks = (plan?.tasks || []).filter((task) => {
    const matchesSearch =
      task.task_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.assigned_provider_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.required_provider_category || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (taskFilter === "CRITICAL") return task.is_critical_path;
    if (taskFilter === "ASSIGNED") return task.is_assigned;
    if (taskFilter === "UNASSIGNED") return !task.is_assigned;
    return true;
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800 font-bold">
              TASK 9 AUTHORITATIVE BLUEPRINT
            </span>
            {plan && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                Plan v{plan.plan_version}
              </span>
            )}
            {plan && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {new Date(plan.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-1.5 flex items-center gap-2">
            <Compass className="w-7 h-7 text-blue-400" />
            Final Execution Plan
          </h1>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            <span>Deterministic operational blueprint: schedule, provider bindings, critical path, and governance checkpoints.</span>
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleRecompile}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/40 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Recompiling..." : "Recompile Plan"}</span>
          </button>
          <Link
            href={`/events/${eventId}/live`}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/40 transition"
          >
            <span>Live Command Center →</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-start space-x-3">
          <AlertOctagon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">Plan Generation Issue</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {loading && !plan ? (
        <div className="flex flex-col items-center justify-center p-16 space-y-4 rounded-2xl bg-slate-900/40 border border-slate-800">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-mono">Compiling authoritative operational state from Task 8...</p>
        </div>
      ) : plan ? (
        <div className="space-y-6">
          {/* Readiness & Operational Focus Header Banner */}
          {(() => {
            const rBadge = getReadinessBadge(plan.readiness_status);
            const IconComponent = rBadge.icon;
            return (
              <div className={`p-4 md:p-5 rounded-2xl border ${rBadge.bg} transition shadow-xl`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start space-x-3.5">
                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 mt-0.5">
                      <IconComponent className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-black tracking-wider uppercase">{rBadge.label}</span>
                        <span className="text-[11px] font-mono text-white/80">({plan.event_summary.event_name})</span>
                      </div>
                      <p className="text-xs text-white/80 mt-0.5">{rBadge.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 text-xs font-mono border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 md:pl-5">
                    <div>
                      <span className="text-[10px] text-white/60 block uppercase">Critical Tasks</span>
                      <span className="text-base font-bold text-white">{plan.critical_path.length}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/60 block uppercase">Critical Span</span>
                      <span className="text-base font-bold text-white">{plan.total_critical_duration_minutes}m</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/60 block uppercase">Committed</span>
                      <span className="text-base font-bold text-white">₹{Number(plan.budget_summary.total_committed).toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>

                {plan.operational_focus && (
                  <div className="mt-4 pt-3 border-t border-white/10 text-xs text-white/90 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                    <span>{plan.operational_focus}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Real-time Current & Next Task HUD */}
          {plan.current_and_next && (plan.current_and_next.current_task || plan.current_and_next.next_task) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-3 py-1 bg-blue-950/80 border-b border-l border-blue-800 text-[10px] font-mono text-blue-300 font-bold rounded-bl-lg">
                  CURRENT OPERATIONAL TASK
                </div>
                {plan.current_and_next.current_task ? (
                  <div className="space-y-2 mt-1">
                    <h3 className="text-base font-bold text-white">
                      {plan.current_and_next.current_task.task_name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5 text-blue-400" />
                        {plan.current_and_next.current_task.planned_start?.split("T")[1]?.slice(0, 5) || "TBD"} –{" "}
                        {plan.current_and_next.current_task.planned_end?.split("T")[1]?.slice(0, 5) || "TBD"}
                      </span>
                      <span>•</span>
                      <span className="font-mono text-slate-300">
                        Vendor: {plan.current_and_next.current_task.assigned_provider_name || "Unassigned"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 font-mono py-3">
                    {plan.current_and_next.position_note || "No active task in execution window."}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-3 py-1 bg-purple-950/80 border-b border-l border-purple-800 text-[10px] font-mono text-purple-300 font-bold rounded-bl-lg">
                  NEXT SCHEDULED TASK
                </div>
                {plan.current_and_next.next_task ? (
                  <div className="space-y-2 mt-1">
                    <h3 className="text-base font-bold text-white">
                      {plan.current_and_next.next_task.task_name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5 text-purple-400" />
                        Starts at {plan.current_and_next.next_task.planned_start?.split("T")[1]?.slice(0, 5) || "TBD"}
                      </span>
                      <span>•</span>
                      <span className="font-mono text-slate-300">
                        Vendor: {plan.current_and_next.next_task.assigned_provider_name || "Unassigned"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 font-mono py-3">
                    No further upcoming tasks scheduled.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Blockers & Warnings Section */}
          {(plan.blockers.length > 0 || plan.warnings.length > 0 || plan.unresolved_unknowns.length > 0) && (
            <div className="space-y-3">
              {plan.blockers.length > 0 && (
                <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800 space-y-2.5">
                  <div className="flex items-center space-x-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <AlertOctagon className="w-4 h-4" />
                    <span>Blocking Items ({plan.blockers.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {plan.blockers.map((b, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-rose-900/30 border border-rose-800/60 flex items-start space-x-2">
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 font-mono text-[9px] font-bold">
                          {b.reason_code}
                        </span>
                        <span className="text-rose-200">{b.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.warnings.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 space-y-2.5">
                  <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Operational Warnings ({plan.warnings.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {plan.warnings.map((w, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-amber-900/20 border border-amber-800/40 flex items-start space-x-2">
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono text-[9px] font-bold">
                          {w.reason_code}
                        </span>
                        <span className="text-amber-200">{w.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Critical Path Timeline Sequence */}
          <div className="p-5 rounded-2xl bg-[#0b101c] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-blue-400 font-bold tracking-wider">
                  DETERMINISTIC CPM
                </span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  Critical Path Sequence ({plan.critical_path.length} Tasks)
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Total Critical Span: <strong className="text-white">{plan.total_critical_duration_minutes} min</strong>
              </span>
            </div>

            <div className="flex flex-col md:flex-row items-stretch gap-2 overflow-x-auto pb-2">
              {plan.critical_path.map((cp, idx) => (
                <div key={cp.task_id} className="flex-1 min-w-[200px] flex items-center gap-2">
                  <div className="flex-1 p-3.5 rounded-xl bg-slate-900/90 border border-blue-900/50 hover:border-blue-500/80 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 font-bold">
                        #{cp.sequence_order} CRITICAL
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {cp.slack_minutes}m slack
                      </span>
                    </div>
                    <div className="font-bold text-xs text-white line-clamp-1">{cp.task_name}</div>
                    <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                      <span>{cp.planned_start || "TBD"} – {cp.planned_end || "TBD"}</span>
                      <span className="text-emerald-400 font-semibold">{cp.assigned_provider_name}</span>
                    </div>
                  </div>
                  {idx < plan.critical_path.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0 hidden md:block" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Execution Checkpoints & Budget Metrics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Checkpoints Timeline (2 cols) */}
            <div className="lg:col-span-2 p-5 rounded-2xl bg-[#0b101c] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold tracking-wider">
                    OPERATIONAL RUNBOOK
                  </span>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Flag className="w-4 h-4 text-emerald-400" />
                    Execution Milestones & Checkpoints
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {plan.execution_checkpoints.length} Checkpoints
                </span>
              </div>

              <div className="space-y-3 relative pl-6 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {plan.execution_checkpoints.slice(0, 8).map((chk) => (
                  <div key={chk.checkpoint_id} className="relative flex items-start space-x-3 text-xs">
                    <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ring-slate-900" />
                    <div className="font-mono font-bold text-blue-400 min-w-[55px]">
                      {chk.time}
                    </div>
                    <div className="flex-1 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{chk.title}</span>
                        <span className="text-[9px] font-mono uppercase px-1 rounded bg-slate-800 text-slate-400">
                          {chk.checkpoint_type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{chk.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Budget & Resource Summary (1 col) */}
            <div className="p-5 rounded-2xl bg-[#0b101c] border border-slate-800 space-y-4">
              <div>
                <span className="text-[10px] font-mono uppercase text-amber-400 font-bold tracking-wider">
                  FINANCIAL INTEGRITY
                </span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                  Budget Summary
                </h2>
              </div>

              <div className="space-y-3 font-mono">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex justify-between items-center">
                  <span className="text-xs text-slate-400">Total Budget</span>
                  <span className="text-sm font-bold text-white">
                    ₹{Number(plan.budget_summary.total_budget).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex justify-between items-center">
                  <span className="text-xs text-slate-400">Committed Spend</span>
                  <span className="text-sm font-bold text-emerald-400">
                    ₹{Number(plan.budget_summary.total_committed).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex justify-between items-center">
                  <span className="text-xs text-slate-400">Remaining Budget</span>
                  <span className="text-sm font-bold text-blue-400">
                    ₹{Number(plan.budget_summary.remaining_budget).toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Budget Utilization</span>
                    <span className="text-white font-bold">{plan.budget_summary.utilization_percent}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${
                        plan.budget_summary.is_over_budget ? "bg-rose-500" : "bg-blue-500"
                      }`}
                      style={{ width: `${Math.min(100, Number(plan.budget_summary.utilization_percent))}%` }}
                    />
                  </div>
                </div>

                {/* Resource Metrics */}
                <div className="pt-3 border-t border-slate-800">
                  <span className="text-[10px] text-slate-500 block uppercase mb-2">Resource Deployments</span>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">TOTAL</span>
                      <span className="font-bold text-white">{plan.resource_summary.total_resources}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">ALLOCATED</span>
                      <span className="font-bold text-emerald-400">{plan.resource_summary.allocated_count}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">AVAILABLE</span>
                      <span className="font-bold text-blue-400">{plan.resource_summary.available_count}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Deterministic Execution Task Table */}
          <div className="p-5 rounded-2xl bg-[#0b101c] border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-mono uppercase text-blue-400 font-bold tracking-wider">
                  TOPOLOGICAL ORDER
                </span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <GitCommit className="w-4 h-4 text-blue-400" />
                  Authoritative Execution Sequence ({filteredTasks.length} Tasks)
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search task or vendor..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44 md:w-56"
                  />
                </div>

                <div className="flex items-center space-x-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono">
                  {(["ALL", "CRITICAL", "ASSIGNED", "UNASSIGNED"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setTaskFilter(filter)}
                      className={`px-2 py-1 rounded ${
                        taskFilter === filter ? "bg-blue-600 text-white font-bold" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400">
                    <th className="py-2.5 px-3">Seq / Task</th>
                    <th className="py-2.5 px-3">Assigned Vendor</th>
                    <th className="py-2.5 px-3">Schedule</th>
                    <th className="py-2.5 px-3">Slack / CPM</th>
                    <th className="py-2.5 px-3">Predecessors</th>
                    <th className="py-2.5 px-3">Commitment</th>
                    <th className="py-2.5 px-3">Readiness</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredTasks.map((t, idx) => (
                    <tr key={t.task_id} className="hover:bg-slate-900/40 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold">#{idx + 1}</span>
                          <div>
                            <span className="font-bold text-white block">{t.task_name}</span>
                            {t.phase && (
                              <span className="text-[9px] text-slate-500 uppercase">{t.phase}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {t.is_assigned ? (
                          <div className="space-y-0.5">
                            <span className="text-emerald-400 font-bold block">{t.assigned_provider_name}</span>
                            <span className="text-[9px] text-slate-500">{t.assigned_provider_category}</span>
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-[10px] font-bold">
                            UNASSIGNED
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="space-y-0.5">
                          <span className="text-slate-300 block">
                            {t.planned_start ? t.planned_start.split("T")[1]?.slice(0, 5) : "—"} –{" "}
                            {t.planned_end ? t.planned_end.split("T")[1]?.slice(0, 5) : "—"}
                          </span>
                          <span className="text-[9px] text-slate-500">{t.duration_minutes} min</span>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {t.is_critical_path ? (
                          <span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-700 text-blue-300 text-[10px] font-bold">
                            CRITICAL (0m)
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">
                            {t.slack_minutes !== null && t.slack_minutes !== undefined
                              ? `${t.slack_minutes}m slack`
                              : "—"}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        {t.predecessors.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {t.predecessors.map((p) => (
                              <span
                                key={p.task_id}
                                className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[9px] truncate max-w-[120px]"
                                title={`Depends on: ${p.task_name}`}
                              >
                                {p.task_name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[10px]">None (Root)</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        {t.committed_amount ? (
                          <span className="text-emerald-400 font-bold">
                            ₹{Number(t.committed_amount).toLocaleString("en-IN")}
                          </span>
                        ) : t.budget_allocation ? (
                          <span className="text-slate-400">
                            Est: ₹{Number(t.budget_allocation).toLocaleString("en-IN")}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.readiness_state === "READY"
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                              : t.readiness_state === "BLOCKED"
                              ? "bg-rose-950 text-rose-400 border border-rose-800"
                              : "bg-amber-950 text-amber-400 border border-amber-800"
                          }`}
                        >
                          {t.readiness_state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
