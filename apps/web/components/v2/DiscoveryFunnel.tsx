"use client";

import React from "react";
import { ArrowRight, CheckCircle2, Filter, Layers, Users, Zap } from "lucide-react";

interface DiscoveryFunnelProps {
  discovered: number;
  unique: number;
  relevant: number;
  matching: number;
  shortlisted: number;
  activeStage?: "DISCOVERED" | "UNIQUE" | "RELEVANT" | "MATCHING" | "SHORTLISTED" | null;
  onStageClick?: (stage: "DISCOVERED" | "UNIQUE" | "RELEVANT" | "MATCHING" | "SHORTLISTED") => void;
  className?: string;
}

export function DiscoveryFunnel({
  discovered = 0,
  unique = 0,
  relevant = 0,
  matching = 0,
  shortlisted = 0,
  activeStage,
  onStageClick,
  className = "",
}: DiscoveryFunnelProps) {
  const stages = [
    {
      id: "DISCOVERED" as const,
      label: "Discovered",
      sublabel: "Raw candidates found",
      count: discovered,
      icon: Layers,
    },
    {
      id: "UNIQUE" as const,
      label: "Unique",
      sublabel: "Deduplicated entities",
      count: unique,
      icon: Filter,
    },
    {
      id: "RELEVANT" as const,
      label: "Relevant",
      sublabel: "Category & geo verified",
      count: relevant,
      icon: Zap,
    },
    {
      id: "MATCHING" as const,
      label: "Matching",
      sublabel: "Constraint verified",
      count: matching,
      icon: CheckCircle2,
    },
    {
      id: "SHORTLISTED" as const,
      label: "Shortlisted",
      sublabel: "Outreach & fit ready",
      count: shortlisted,
      icon: Users,
    },
  ];

  return (
    <div className={`w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-[#D6003C]" />
          <span>Discovery Qualification Funnel</span>
        </h4>
        <span className="text-[11px] text-slate-500 font-mono">
          Authoritative Backend Telemetry
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {stages.map((stage, idx) => {
          const isActive = activeStage === stage.id;
          const prevCount = idx > 0 ? stages[idx - 1].count : null;
          const convRate =
            prevCount && prevCount > 0
              ? Math.min(100, Math.round((stage.count / prevCount) * 100))
              : null;
          const Icon = stage.icon;

          return (
            <div
              key={stage.id}
              onClick={() => onStageClick && onStageClick(stage.id)}
              className={`p-3 rounded-lg border transition-all relative cursor-pointer ${
                isActive
                  ? "bg-slate-100 border-slate-400 shadow-xs"
                  : "bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white"
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {stage.label}
                </span>
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[#D6003C]" : "text-slate-400"}`} />
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold tracking-tight text-slate-900">
                  {stage.count}
                </span>
                {convRate !== null && (
                  <span className="text-[10px] font-mono font-medium text-emerald-600 bg-emerald-50 px-1 rounded">
                    {convRate}%
                  </span>
                )}
              </div>

              <p className="text-[10px] text-slate-500 mt-1 truncate">
                {stage.sublabel}
              </p>

              {idx < stages.length - 1 && (
                <div className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-slate-300">
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
