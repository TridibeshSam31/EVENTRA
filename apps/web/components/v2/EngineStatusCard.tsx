"use client";

import React from "react";
import {
  Cpu,
  Database,
  CheckCircle2,
  Clock,
  AlertCircle,
  ShieldCheck,
  Layers,
  ArrowRight,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface EngineInfo {
  id: string;
  name: string;
  category: string;
  deterministicRole: string;
  backendModule: string;
  lastExecution?: string | null;
  lastResult?: string | null;
}

interface EngineStatusCardProps {
  className?: string;
}

export function EngineStatusCard({ className = "" }: EngineStatusCardProps) {
  // Authoritative list of deterministic backend engines implemented in EVENTRA (app.engines.*)
  const engines: EngineInfo[] = [
    {
      id: "planning",
      name: "Planning Engine",
      category: "Blueprint & Task Synthesis",
      deterministicRole: "Generates task blueprints, predecessors, and resource requirements from intake specs",
      backendModule: "app.engines.planning",
    },
    {
      id: "schedule",
      name: "Schedule & CPM Engine",
      category: "Critical Path Traversal",
      deterministicRole: "Calculates forward/backward schedule passes, total float, and critical path milestones",
      backendModule: "app.engines.schedule",
    },
    {
      id: "budget",
      name: "Budget Calculation Engine",
      category: "Variance & Allocation",
      deterministicRole: "Computes category allocations, committed spend, variances, and threshold alerts",
      backendModule: "app.engines.budget",
    },
    {
      id: "impact_risk",
      name: "Impact & Risk Engine",
      category: "Cascade Severity Evaluation",
      deterministicRole: "Analyzes task delays, downstream dependency breaches, and composite risk scoring",
      backendModule: "app.engines.impact / app.engines.risk",
    },
    {
      id: "recovery",
      name: "Recovery Engine",
      category: "Option Generation & Scoring",
      deterministicRole: "Generates alternative provider options, simulates schedule recovery, and scores viability",
      backendModule: "app.engines.recovery",
    },
    {
      id: "verification",
      name: "Verification Engine",
      category: "Operational State Invariants",
      deterministicRole: "Deterministic rule verifier ensuring post-action state invariants and recovery contracts hold",
      backendModule: "app.engines.verification",
    },
    {
      id: "discovery",
      name: "Discovery & Qualification Engine",
      category: "Provider Ranking & Deduplication",
      deterministicRole: "Scores scraper-backed candidates, normalizes metadata, and filters verified providers",
      backendModule: "app.services.discovery_ranking_engine",
    },
    {
      id: "state_machine",
      name: "Event State Machine",
      category: "Lifecycle Transition Validation",
      deterministicRole: "Validates immutable lifecycle transitions and prevents illegal operational states",
      backendModule: "app.engines.state",
    },
  ];

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-50 text-indigo-700 border border-slate-200">
            <Cpu className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Backend Deterministic Engines
              </h3>
              <ProvenanceBadge provenance="ENGINE" size="sm" />
            </div>
            <p className="text-[11px] text-slate-500">
              Discrete computational engines executing deterministic business invariants
            </p>
          </div>
        </div>

        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 self-start sm:self-auto">
          {engines.length} Deterministic Engines
        </span>
      </div>

      {/* Strict Truth Banner: Engine Health Notice */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
          <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
          <span>Engine health/status is not exposed by backend.</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          EVENTRA engines are stateless, deterministic modules invoked synchronously or asynchronously during operational workflows rather than maintaining persistent health probes. Status reflects architecture contracts.
        </p>
      </div>

      {/* Engines Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {engines.map((eng) => (
          <div
            key={eng.id}
            className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors flex flex-col justify-between space-y-2"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-bold text-slate-900">
                  {eng.name}
                </span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  {eng.category}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {eng.deterministicRole}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span className="truncate max-w-[200px]">{eng.backendModule}</span>
              <span className="text-slate-500 font-sans">On-Demand Engine</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
