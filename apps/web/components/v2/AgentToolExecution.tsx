"use client";

import React, { useState, useEffect } from "react";
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
  Lock,
  Layers,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { getAgentTools } from "@/lib/api/agent";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { AgentToolSummary, ToolHistoryEntry } from "@/types/api";

interface AgentToolExecutionProps {
  eventId: string;
  toolHistory?: ToolHistoryEntry[];
  className?: string;
}

export function AgentToolExecution({
  eventId,
  toolHistory = [],
  className = "",
}: AgentToolExecutionProps) {
  const [registeredTools, setRegisteredTools] = useState<AgentToolSummary[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [activeTab, setActiveTab] = useState<"HISTORY" | "REGISTRY">(
    toolHistory.length > 0 ? "HISTORY" : "REGISTRY"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  useEffect(() => {
    async function loadTools() {
      try {
        setLoadingTools(true);
        const tools = await getAgentTools(eventId);
        if (Array.isArray(tools)) {
          setRegisteredTools(tools);
        } else {
          setRegisteredTools([]);
        }
      } catch (err) {
        console.error("Failed to load agent tools registry:", err);
        setRegisteredTools([]);
      } finally {
        setLoadingTools(false);
      }
    }
    loadTools();
  }, [eventId]);

  const getToolStatusBadge = (status: string) => {
    const s = (status || "UNKNOWN").toUpperCase();
    switch (s) {
      case "SUCCESS":
      case "SUCCEEDED":
        return {
          bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
          icon: CheckCircle2,
          label: "Tool Succeeded",
        };
      case "WAITING_FOR_APPROVAL":
      case "REQUIRES_APPROVAL":
        return {
          bg: "bg-amber-50 text-amber-700 border-amber-200",
          icon: ShieldAlert,
          label: "Waiting For Approval",
        };
      case "RUNNING":
      case "QUEUED":
        return {
          bg: "bg-blue-50 text-blue-700 border-blue-200",
          icon: Clock,
          label: "Executing",
        };
      case "FAILED":
      case "FAILURE":
      case "BLOCKED":
        return {
          bg: "bg-rose-50 text-rose-700 border-rose-200",
          icon: AlertTriangle,
          label: "Tool Failed",
        };
      default:
        return {
          bg: "bg-slate-100 text-slate-600 border-slate-200",
          icon: Clock,
          label: s,
        };
    }
  };

  const filteredHistory = toolHistory.filter((th) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      th.tool.toLowerCase().includes(q) ||
      (th.result_summary || "").toLowerCase().includes(q) ||
      (th.reason_code || "").toLowerCase().includes(q)
    );
  });

  const filteredTools = registeredTools.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
            <Wrench className="w-4 h-4 text-[#D6003C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Agent Tool Execution & Registry
              </h3>
              <ProvenanceBadge provenance="AGENT" size="sm" />
            </div>
            <p className="text-[11px] text-slate-500">
              Deterministic tool invocations with strict recursive credential redaction
            </p>
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-3 py-1 rounded font-medium transition ${
              activeTab === "HISTORY"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Execution History ({toolHistory.length})
          </button>
          <button
            onClick={() => setActiveTab("REGISTRY")}
            className={`px-3 py-1 rounded font-medium transition ${
              activeTab === "REGISTRY"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Registered Tools ({registeredTools.length})
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder={
            activeTab === "HISTORY"
              ? "Search executed tools by name or summary..."
              : "Search available tools in registry..."
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 bg-slate-50"
        />
      </div>

      {/* Security & State Distinction Banner */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
        <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-900">Security & Execution Truth: </span>
          Secrets and authorization headers are permanently redacted at the backend.
          Notice that a <span className="font-semibold text-slate-800">Tool Succeeded</span> status means the tool call ran without system fault, while the resulting business state remains distinct.
        </div>
      </div>

      {/* Tab 1: Execution History */}
      {activeTab === "HISTORY" && (
        <div className="space-y-2">
          {filteredHistory.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 space-y-1">
              <p className="font-semibold text-slate-600">No tool execution records in recent run.</p>
              <p className="text-[11px]">
                {searchQuery
                  ? "No executed tools matched your search query."
                  : "Dispatch an agent directive or trigger autonomous discovery to view live tool execution records."}
              </p>
            </div>
          ) : (
            filteredHistory.map((item, idx) => {
              const statusCfg = getToolStatusBadge(item.status);
              const StatusIcon = statusCfg.icon;
              const isExpanded = expandedItem === `hist-${idx}`;

              return (
                <div
                  key={`th-${idx}`}
                  className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50/50 transition-colors"
                >
                  <div
                    onClick={() => setExpandedItem(isExpanded ? null : `hist-${idx}`)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-slate-400 w-6">
                        #{item.step || idx + 1}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {item.tool}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusCfg.bg}`}
                      >
                        <StatusIcon className="w-2.5 h-2.5" />
                        <span>{statusCfg.label}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {item.reason_code && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">
                          {item.reason_code}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                  </div>

                  {item.result_summary && (
                    <p className="text-xs text-slate-600 mt-1.5 font-medium pl-8">
                      {item.result_summary}
                    </p>
                  )}

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-100 pl-8 space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Sanitized Arguments & Details
                      </span>
                      {item.arguments && Object.keys(item.arguments).length > 0 ? (
                        <pre className="text-[10px] font-mono bg-slate-50 p-2.5 rounded border border-slate-200 text-slate-700 overflow-x-auto max-h-40">
                          {JSON.stringify(item.arguments, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">
                          No arguments passed.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Registered Tools in EVENTRA */}
      {activeTab === "REGISTRY" && (
        <div className="space-y-2">
          {loadingTools ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Loading registered agent tools from backend...
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No registered tools found.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {filteredTools.map((tool) => (
                <div key={tool.name} className="p-3 bg-white hover:bg-slate-50/60 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {tool.name}
                        </span>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          {tool.category}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
                            tool.access_mode === "WRITE"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}
                        >
                          {tool.access_mode}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-snug">
                        {tool.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {tool.requires_approval ? (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                          <ShieldAlert className="w-2.5 h-2.5" /> Approval Required
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          Autonomous
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
