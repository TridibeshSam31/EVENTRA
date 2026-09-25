"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { generatePlan, getPlan } from "../../../../lib/api/planning";
import type { EventPlan, PlanTaskEntry } from "../../../../types/api";
import {
  CalendarCheck,
  Play,
  Layers,
  ArrowRight,
  GitBranch,
  Boxes,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Compass,
} from "lucide-react";

export default function PlanningPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [plan, setPlan] = useState<EventPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tasks" | "dag" | "resources" | "budget">("tasks");

  const loadPlan = async () => {
    setLoading(true);
    try {
      const p = await getPlan(eventId);
      setPlan(p);
      setError(null);
    } catch {
      // Plan might not be generated yet
      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlan();
  }, [eventId]);

  const handleGeneratePlan = async () => {
    setGenerating(true);
    setError(null);
    try {
      const p = await generatePlan(eventId);
      setPlan(p);
    } catch (err: any) {
      setError(err?.message || "Plan generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800 font-bold">
            PHASE 4 PLANNING ENGINE
          </span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-1">
            Operational Plan & Materialized DAG
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Deterministic plan generation: tasks, dependencies, resource allocations, and budget items.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <Link
            href={`/events/${eventId}/execution-plan`}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg bg-blue-900/60 hover:bg-blue-800/80 border border-blue-700 text-blue-200 text-xs font-bold transition shadow-lg"
          >
            <Compass className="w-3.5 h-3.5 text-blue-400" />
            <span>Final Execution Blueprint →</span>
          </Link>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/40 transition disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{generating ? "Materializing Plan..." : plan ? "Regenerate Plan" : "Generate Plan"}</span>
          </button>
          {plan && (
            <Link
              href={`/events/${eventId}/schedule`}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/40 transition"
            >
              <span>Compute Schedule →</span>
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {plan ? (
        <div className="space-y-6">
          {/* Plan Telemetry Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono">
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TASKS</span>
              <span className="text-xl font-bold text-white">{plan.summary?.total_tasks || plan.tasks?.length}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
              <span className="text-[10px] text-slate-500 block">DEPENDENCIES</span>
              <span className="text-xl font-bold text-blue-400">{plan.summary?.total_dependencies || plan.dependencies?.length}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
              <span className="text-[10px] text-slate-500 block">RESOURCES</span>
              <span className="text-xl font-bold text-purple-400">{plan.summary?.total_resources || plan.resources?.length}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
              <span className="text-[10px] text-slate-500 block">CRITICAL PATH</span>
              <span className="text-xl font-bold text-red-400">{plan.summary?.critical_path_tasks || plan.tasks?.filter(t => t.is_critical_path).length}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 col-span-2 md:col-span-1">
              <span className="text-[10px] text-slate-500 block">EST. BUDGET</span>
              <span className="text-xl font-bold text-emerald-400">${(plan.summary?.total_estimated_budget || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 space-x-1 text-xs font-semibold">
            <button
              onClick={() => setActiveTab("tasks")}
              className={`pb-2.5 px-3 border-b-2 transition ${
                activeTab === "tasks"
                  ? "border-blue-500 text-blue-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Tasks ({plan.tasks?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab("dag")}
              className={`pb-2.5 px-3 border-b-2 transition ${
                activeTab === "dag"
                  ? "border-blue-500 text-blue-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Dependency DAG ({plan.dependencies?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab("resources")}
              className={`pb-2.5 px-3 border-b-2 transition ${
                activeTab === "resources"
                  ? "border-blue-500 text-blue-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Resources ({plan.resources?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab("budget")}
              className={`pb-2.5 px-3 border-b-2 transition ${
                activeTab === "budget"
                  ? "border-blue-500 text-blue-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Budget Items ({plan.budget_items?.length || 0})
            </button>
          </div>

          {/* Tab 1: Tasks List */}
          {activeTab === "tasks" && (
            <div className="space-y-2.5">
              {plan.tasks?.map((t) => (
                <div
                  key={t.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start space-x-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase mt-0.5 ${
                        t.priority === "CRITICAL"
                          ? "bg-red-950 text-red-400 border border-red-800"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {t.priority}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-sm">{t.name}</span>
                        {t.is_critical_path && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-800 font-bold">
                            CRITICAL PATH
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-xs mt-0.5">{t.description || "Baseline task"}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 font-mono text-[11px] text-slate-400 border-t md:border-t-0 pt-2 md:pt-0 border-slate-800">
                    <div>
                      <span className="text-slate-500">PROVIDER: </span>
                      <span className="text-slate-300 uppercase">{t.required_provider_category || "GENERAL"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">DURATION: </span>
                      <span className="text-slate-300">{t.duration_minutes || 60}m</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase text-[10px]">
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 2: Visual Dependency Graph (DAG) */}
          {activeTab === "dag" && (
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-950/70 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                    <GitBranch className="w-4 h-4 text-blue-400" />
                    <span>Authoritative Dependency Edges</span>
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Directed Acyclic Graph calculated deterministically by the Dependency Engine.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {plan.dependencies?.map((dep, idx) => {
                  const pred = plan.tasks?.find((t) => t.id === dep.predecessor_task_id);
                  const succ = plan.tasks?.find((t) => t.id === dep.successor_task_id);
                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="text-slate-300 font-semibold truncate max-w-xs">
                          {pred?.name || dep.predecessor_task_id.slice(0, 10)}
                        </span>
                        <ArrowRight className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <span className="text-blue-300 font-semibold truncate max-w-xs">
                          {succ?.name || dep.successor_task_id.slice(0, 10)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 text-slate-500 text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {dep.dependency_type}
                        </span>
                        {dep.lag_minutes > 0 && <span>LAG: {dep.lag_minutes}m</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 3: Resources */}
          {activeTab === "resources" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {plan.resources?.map((r) => (
                <div key={r.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 uppercase">
                      {r.type}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400">{r.status}</span>
                  </div>
                  <h4 className="font-bold text-white text-sm">{r.name}</h4>
                  <div className="text-[11px] font-mono text-slate-400 mt-2">
                    QUANTITY: <span className="text-slate-200 font-bold">{r.quantity} {r.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 4: Budget Items */}
          {activeTab === "budget" && (
            <div className="space-y-2">
              {plan.budget_items?.map((b) => (
                <div key={b.id} className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">
                      {b.category}
                    </span>
                    <h4 className="font-semibold text-white mt-1">{b.name}</h4>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-emerald-400 font-bold text-sm">${b.estimated_amount.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 uppercase">{b.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-16 rounded-2xl border border-slate-800 bg-slate-900/40 text-center space-y-4">
          <CalendarCheck className="w-10 h-10 text-blue-500 mx-auto opacity-75" />
          <div>
            <h3 className="text-base font-bold text-white">No Plan Materialized Yet</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Click &quot;Generate Plan&quot; to invoke the Planning Engine. It will synthesize baseline tasks, DAG edges, resources, and budget allocations.
            </p>
          </div>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/40 transition disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Operational Plan"}
          </button>
        </div>
      )}
    </div>
  );
}
