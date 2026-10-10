"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  browserAgentApi,
  ExecutionResponse,
  ExecutionEvent,
  ExecutionStatus,
  DiscoveredCandidate,
  BrowserDiscoveryResponse,
} from "../../lib/api/browserAgent";
import { TabInfo } from "../../lib/api/browserRuntime";
import { useSearchParams } from "next/navigation";
import { CompanionPairingModal } from "@/components/browser/CompanionPairingModal";
import { browserCompanionApi, CompanionStatusResponse } from "@/lib/api/browserCompanion";
import { Laptop } from "lucide-react";

const PRESET_EVENTS = [
  { id: "wedding_demo", label: "Demo Wedding (San Francisco • 150 guests • $25k)", city: "San Francisco", type: "WEDDING" },
  { id: "college_fest_demo", label: "Demo College Fest (Boston • 800 guests • $50k)", city: "Boston", type: "COLLEGE_FEST" },
  { id: "conference_demo", label: "Demo Tech Conference (Seattle • 300 guests • $40k)", city: "Seattle", type: "CONFERENCE" },
];

const CATEGORIES = [
  { id: "CATERING", label: "Catering" },
  { id: "VENUE", label: "Event Venue / Hall" },
  { id: "PHOTOGRAPHY", label: "Photography" },
  { id: "VIDEOGRAPHY", label: "Videography" },
  { id: "DECOR", label: "Decor & Styling" },
  { id: "DJ_MUSIC", label: "DJ & Music" },
  { id: "LIGHTING", label: "Lighting & AV" },
  { id: "SECURITY", label: "Security & Guarding" },
];

export default function BrowserRuntimePage() {
  const [activeTab, setActiveTab] = useState<"discovery" | "manual">("discovery");

  // Core execution state
  const [execution, setExecution] = useState<ExecutionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string>("https://www.google.com/maps");
  const [eventId, setEventId] = useState<string>("wedding_demo");
  const [customEventId, setCustomEventId] = useState<string>("");
  const [reconnectId, setReconnectId] = useState<string>("");
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [viewerKey, setViewerKey] = useState<number>(0);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const searchParams = useSearchParams();
  const queryEventId = searchParams ? searchParams.get("eventId") : null;

  useEffect(() => {
    if (queryEventId) {
      setEventId("custom");
      setCustomEventId(queryEventId);
    }
  }, [queryEventId]);

  const [isPairingOpen, setIsPairingOpen] = useState<boolean>(false);
  const [companionStatus, setCompanionStatus] = useState<CompanionStatusResponse | null>(null);

  useEffect(() => {
    browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {});
    const interval = setInterval(() => {
      browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Phase 3 Discovery state
  const [discoveryCategory, setDiscoveryCategory] = useState<string>("CATERING");
  const [discoveryMaxResults, setDiscoveryMaxResults] = useState<number>(5);
  const [customQuery, setCustomQuery] = useState<string>("");
  const [persistDiscovery, setPersistDiscovery] = useState<boolean>(true);
  const [candidates, setCandidates] = useState<DiscoveredCandidate[]>([]);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [discoveryStatus, setDiscoveryStatus] = useState<string | null>(null);
  const [discoverySummary, setDiscoverySummary] = useState<BrowserDiscoveryResponse | null>(null);

  const wsUnsubscribeRef = useRef<(() => void) | null>(null);

  const addEvent = useCallback((event: ExecutionEvent) => {
    setEvents((prev) => {
      if (prev.some((e) => e.seq === event.seq)) return prev;
      return [event, ...prev.slice(0, 99)];
    });
  }, []);

  // Subscribe to WebSocket live event stream when execution exists
  useEffect(() => {
    if (!execution?.execution_id) return;

    if (wsUnsubscribeRef.current) {
      wsUnsubscribeRef.current();
    }

    setWsConnected(true);
    const lastSeq = events.length > 0 ? events[0].seq : undefined;

    const unsubscribe = browserAgentApi.subscribeEvents(
      execution.execution_id,
      (evt) => {
        addEvent(evt);

        // Update discovery status text in UI if event is a discovery phase
        if (evt.event_type.startsWith("discovery.")) {
          setDiscoveryStatus(evt.message);
          if (
            evt.event_type === "discovery.candidate_found" ||
            evt.event_type === "discovery.candidate_validated" ||
            evt.event_type === "discovery.persistence_completed"
          ) {
            browserAgentApi
              .getCandidates(execution.execution_id)
              .then((cands) => {
                if (cands && cands.length > 0) setCandidates(cands);
              })
              .catch(() => {});
          }
        }

        // Refresh local execution snapshot when browser state updates
        if (evt.event_type.startsWith("browser.") || evt.event_type.startsWith("execution.")) {
          setExecution((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              status: (evt.data?.status as ExecutionStatus) || prev.status,
              current_url: evt.data?.current_url || evt.data?.url || prev.current_url,
              current_title: evt.data?.current_title || evt.data?.title || prev.current_title,
              active_tab_id: evt.data?.active_tab_id || evt.data?.tab_id || prev.active_tab_id,
            };
          });
        }
      },
      (err) => {
        console.warn("WebSocket error:", err);
        setWsConnected(false);
      },
      lastSeq,
    );

    wsUnsubscribeRef.current = unsubscribe;

    return () => {
      if (wsUnsubscribeRef.current) {
        wsUnsubscribeRef.current();
        wsUnsubscribeRef.current = null;
      }
      setWsConnected(false);
    };
  }, [execution?.execution_id, addEvent]);

  // Load existing candidates when execution ID changes
  useEffect(() => {
    if (!execution?.execution_id) return;
    browserAgentApi
      .getCandidates(execution.execution_id)
      .then((cands) => {
        if (cands && cands.length > 0) setCandidates(cands);
      })
      .catch(() => {});
  }, [execution?.execution_id]);

  // Load active executions on initial mount
  useEffect(() => {
    async function loadRecent() {
      try {
        const list = await browserAgentApi.listExecutions();
        const active = list.find((e) => e.status === "running" || e.status === "starting");
        if (active) {
          setExecution(active);
          setTargetUrl(active.current_url || "https://www.google.com/maps");
        }
      } catch {}
    }
    loadRecent();
  }, []);

  // Effective event ID (preset or custom input)
  const effectiveEventId = eventId === "custom" ? customEventId.trim() : eventId;

  // Launch Phase 3 Discovery Workflow
  const handleStartDiscovery = async () => {
    if (!effectiveEventId) {
      setError("Please specify a valid EVENTRA Event ID to load event requirements.");
      return;
    }

    setIsDiscovering(true);
    setError(null);
    setDiscoveryStatus("Initializing live browser session on virtual display...");

    try {
      let currentExec = execution;
      if (!currentExec || currentExec.status !== "running") {
        setDiscoveryStatus("Starting new Browser Agent execution...");
        currentExec = await browserAgentApi.createExecution("https://www.google.com/maps", effectiveEventId);
        setExecution(currentExec);
        setViewerKey((k) => k + 1);
      }

      setDiscoveryStatus(`Searching Google Maps for ${discoveryCategory}...`);
      const resp = await browserAgentApi.discover(currentExec.execution_id, {
        event_id: effectiveEventId,
        category: discoveryCategory,
        max_results: Number(discoveryMaxResults),
        custom_query: customQuery.trim() || undefined,
        persist_results: persistDiscovery,
        use_fallback_if_blocked: true,
      });

      setDiscoverySummary(resp);
      setCandidates(resp.candidates);
      setDiscoveryStatus(
        `Discovery finished: ${resp.total_found} found, ${resp.total_qualified} qualified, ${resp.total_persisted} persisted to database.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setDiscoveryStatus("Discovery encountered an error.");
    } finally {
      setIsDiscovering(false);
    }
  };

  // Start Generic Browser Execution
  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await browserAgentApi.createExecution(targetUrl, effectiveEventId);
      setExecution(resp);
      setViewerKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Stop Execution
  const handleStop = async () => {
    if (!execution?.execution_id) return;
    setLoading(true);
    setError(null);
    setIsDiscovering(false);
    try {
      const updated = await browserAgentApi.stopExecution(execution.execution_id, "User requested halt");
      setExecution(updated);
      setViewerKey((k) => k + 1);
      setDiscoveryStatus("Execution stopped by operator.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Reconnect to an existing execution
  const handleReconnect = async () => {
    if (!reconnectId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await browserAgentApi.getExecution(reconnectId.trim());
      setExecution(resp);
      setViewerKey((k) => k + 1);
      setReconnectId("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Manual Tab Navigation
  const handleNavigate = async (urlToNav?: string) => {
    if (!execution?.execution_id) return;
    const url = urlToNav || targetUrl;
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await browserAgentApi.navigate(execution.execution_id, url);
      setExecution(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Create Tab
  const handleCreateTab = async () => {
    if (!execution?.execution_id) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await browserAgentApi.createTab(execution.execution_id);
      setExecution(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Activate Tab
  const handleActivateTab = async (tabId: string) => {
    if (!execution?.execution_id || execution.active_tab_id === tabId) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await browserAgentApi.activateTab(execution.execution_id, tabId);
      setExecution(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const viewerUrl =
    execution?.viewer_url || "http://localhost:6080/vnc.html?autoconnect=true&resize=scale";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 text-lg">
            BA
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              EVENTRA Real Browser Agent
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Phase 3: Real Discovery
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Headed Chromium Virtual Desktop &bull; Live Google Search & Maps &bull; Evidence-Backed Persistence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              execution?.status === "running"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : execution?.status === "starting"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                execution?.status === "running"
                  ? "bg-emerald-400 animate-pulse"
                  : execution?.status === "starting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-slate-500"
              }`}
            />
            {execution ? execution.status.toUpperCase() : "IDLE"}
          </span>

          {/* WebSocket stream status indicator */}
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono border ${
              wsConnected
                ? "bg-emerald-950/60 text-emerald-400 border-emerald-800"
                : "bg-slate-900 text-slate-500 border-slate-800"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
            WS {wsConnected ? "STREAM LIVE" : "OFFLINE"}
          </span>

          {execution?.status === "running" ? (
            <button
              onClick={handleStop}
              disabled={loading || isDiscovering}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-md shadow-rose-600/20"
            >
              Stop Session
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-md shadow-indigo-600/20"
            >
              {loading ? "Starting..." : "Start Browser"}
            </button>
          )}

          <button
            onClick={() => setIsPairingOpen(true)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition flex items-center gap-1.5"
            title="Manage Option A: Windows Visible Browser Companion"
          >
            {companionStatus?.is_connected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Laptop className="w-3.5 h-3.5 text-emerald-400" />
                <span>Desktop Browser Ready</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <Laptop className="w-3.5 h-3.5 text-amber-400" />
                <span>Pair Windows Browser</span>
              </>
            )}
          </button>

          <a
            href={viewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
          >
            Standalone Viewer ↗
          </a>
        </div>
      </header>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <span className="font-bold">Notice:</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white font-bold text-sm px-2">
            &times;
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col p-6 gap-6 max-w-7xl w-full mx-auto">
        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-slate-800 gap-4">
          <button
            onClick={() => setActiveTab("discovery")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === "discovery"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            Venue & Vendor Discovery (Phase 3)
          </button>
          <button
            onClick={() => setActiveTab("manual")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === "manual"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Manual Navigation & Tabs (Phase 2)
          </button>
        </div>

        {/* Tab 1: Discovery Controls Panel */}
        {activeTab === "discovery" && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  Real Browser-Based Venue & Vendor Discovery
                </h2>
                <p className="text-xs text-slate-400">
                  Select an authorized event to extract its actual requirements and command the browser to research candidates on Google Maps.
                </p>
              </div>
              {execution?.execution_id && (
                <div className="text-xs font-mono text-slate-400">
                  Execution: <span className="text-indigo-400 font-semibold">{execution.execution_id}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              {/* Event Selector */}
              <div>
                <label className="text-slate-400 font-medium block mb-1.5">Target EVENTRA Event</label>
                <select
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  disabled={isDiscovering}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  {PRESET_EVENTS.map((pe) => (
                    <option key={pe.id} value={pe.id}>
                      {pe.label}
                    </option>
                  ))}
                  <option value="custom">Custom Event ID...</option>
                </select>
                {eventId === "custom" && (
                  <input
                    type="text"
                    value={customEventId}
                    onChange={(e) => setCustomEventId(e.target.value)}
                    placeholder="Enter event ID (e.g. evt_...)"
                    className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                )}
              </div>

              {/* Vendor Category */}
              <div>
                <label className="text-slate-400 font-medium block mb-1.5">Discovery Category</label>
                <select
                  value={discoveryCategory}
                  onChange={(e) => setDiscoveryCategory(e.target.value)}
                  disabled={isDiscovering}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50 font-medium"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max Results */}
              <div>
                <label className="text-slate-400 font-medium block mb-1.5">
                  Inspection Depth: <span className="text-indigo-400 font-bold">{discoveryMaxResults} Listings</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={discoveryMaxResults}
                  onChange={(e) => setDiscoveryMaxResults(Number(e.target.value))}
                  disabled={isDiscovering}
                  className="w-full accent-indigo-500 mt-2 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Fast (1)</span>
                  <span>Standard (5)</span>
                  <span>Deep (10)</span>
                </div>
              </div>

              {/* Launch & Persistence */}
              <div className="flex flex-col justify-end gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="persist-check"
                    checked={persistDiscovery}
                    onChange={(e) => setPersistDiscovery(e.target.checked)}
                    disabled={isDiscovering}
                    className="accent-indigo-500 rounded cursor-pointer"
                  />
                  <label htmlFor="persist-check" className="text-slate-300 font-medium cursor-pointer">
                    Persist qualified vendors to DB
                  </label>
                </div>

                <button
                  onClick={handleStartDiscovery}
                  disabled={isDiscovering || loading}
                  className="w-full py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:from-indigo-700 active:to-violet-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDiscovering ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Researching in Browser...
                    </>
                  ) : (
                    "Launch Browser Discovery"
                  )}
                </button>
              </div>
            </div>

            {/* Custom query override toggle */}
            <div className="pt-2 border-t border-slate-800/80">
              <label className="text-[11px] text-slate-400 font-medium block mb-1">
                Custom Search Query (Optional override):
              </label>
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder="Leave blank to use event-derived query template (e.g. Catering in San Francisco)..."
                disabled={isDiscovering}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Live Progress Banner */}
            {discoveryStatus && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isDiscovering ? "bg-amber-400 animate-ping" : "bg-emerald-400"
                    }`}
                  />
                  <span className="text-slate-300 font-medium">{discoveryStatus}</span>
                </div>
                {discoverySummary && (
                  <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                    <span className="text-emerald-400 font-semibold">{discoverySummary.total_found} Found</span>
                    <span>&bull;</span>
                    <span className="text-indigo-400 font-semibold">{discoverySummary.total_qualified} Qualified</span>
                    <span>&bull;</span>
                    <span className="text-violet-400 font-semibold">{discoverySummary.total_persisted} Persisted</span>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Manual Navigation Controls */}
        {activeTab === "manual" && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Manual Browser Control</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
                placeholder="https://..."
                disabled={execution?.status !== "running" || loading}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={() => handleNavigate()}
                disabled={execution?.status !== "running" || loading}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
              >
                Navigate
              </button>
              <button
                onClick={handleCreateTab}
                disabled={execution?.status !== "running" || loading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition"
              >
                + New Tab
              </button>
            </div>

            {/* Tab list */}
            {execution?.tabs && execution.tabs.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Tabs:</span>
                {execution.tabs.map((tab: TabInfo) => (
                  <button
                    key={tab.tab_id}
                    onClick={() => handleActivateTab(tab.tab_id)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      tab.is_active
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                    }`}
                  >
                    {tab.title || "Untitled"} [{tab.tab_id}]
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Real Live Graphical Desktop Canvas (noVNC) */}
        <section className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative min-h-[520px]">
          <div className="bg-slate-950/90 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-mono text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 text-slate-300 font-semibold">Live Chromium Graphical Desktop (noVNC)</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">Virtual Display :99 &bull; Real-Time Playwright Navigation</span>
            </div>
            <button
              onClick={() => setViewerKey((k) => k + 1)}
              className="text-xs text-slate-400 hover:text-white underline font-mono"
            >
              Reload Frame
            </button>
          </div>

          <div className="flex-1 w-full bg-black relative min-h-[500px]">
            <iframe
              key={viewerKey}
              src={viewerUrl}
              title="EVENTRA Live Chromium Desktop (noVNC)"
              className="w-full h-full min-h-[500px] border-0"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          </div>
        </section>

        {/* Discovered Candidates Grid */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Discovered Candidates & Qualification Results
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                {candidates.length} Verified
              </span>
            </div>
            {candidates.length > 0 && (
              <span className="text-xs text-slate-400 font-mono">
                {candidates.filter((c) => c.is_persisted).length} Persisted to Database
              </span>
            )}
          </div>

          {candidates.length === 0 ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <span className="text-3xl">🔍</span>
              <p className="text-sm font-medium">No candidates discovered yet.</p>
              <p className="text-xs text-slate-600 max-w-md">
                Launch Browser Discovery above to instruct the real browser to search Google Maps and inspect businesses.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {candidates.map((cand) => (
                <div
                  key={cand.id}
                  className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between gap-3 hover:border-slate-700 transition shadow-lg relative group"
                >
                  <div className="space-y-2">
                    {/* Header: Name and Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition">
                          {cand.name}
                        </h3>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          {cand.category} &bull; {cand.city}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                          cand.qualification_status === "qualified"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : cand.qualification_status === "uncertain"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                        }`}
                      >
                        {cand.qualification_status.toUpperCase()}
                      </span>
                    </div>

                    {/* Rating & Reviews */}
                    <div className="flex items-center gap-2 text-xs">
                      {cand.rating ? (
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                          ★ {cand.rating}
                          <span className="text-slate-500 font-normal">
                            ({cand.review_count ? `${cand.review_count} reviews` : "reviews verified"})
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-500 italic text-[11px]">Rating: Not listed</span>
                      )}
                    </div>

                    {/* Address & Phone */}
                    <div className="space-y-1 text-xs text-slate-300 font-sans">
                      {cand.address && (
                        <div className="flex items-start gap-1.5 text-slate-400 text-[11px]">
                          <span className="shrink-0 text-slate-500">📍</span>
                          <span className="line-clamp-2">{cand.address}</span>
                        </div>
                      )}
                      {cand.phone ? (
                        <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
                          <span className="shrink-0 text-slate-500">📞</span>
                          <a href={`tel:${cand.phone}`} className="hover:text-indigo-400 underline">
                            {cand.phone}
                          </a>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">📞 Phone: Unknown</div>
                      )}
                    </div>

                    {/* Links */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                      {cand.website ? (
                        <a
                          href={cand.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 underline font-medium flex items-center gap-0.5"
                        >
                          Official Website ↗
                        </a>
                      ) : (
                        <span className="text-slate-600 italic">No website listed</span>
                      )}

                      {cand.maps_url && (
                        <a
                          href={cand.maps_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-200 underline"
                        >
                          Google Maps Link
                        </a>
                      )}
                    </div>

                    {/* Evidence & Qualification Explanations */}
                    <div className="pt-2 border-t border-slate-900 text-[11px] text-slate-400 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Qualification Notes:
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                        {cand.qualification_reasons.slice(0, 2).map((reason, idx) => (
                          <li key={idx} className="line-clamp-1">
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Persistence Badge */}
                  <div className="pt-2 border-t border-slate-900/80 flex items-center justify-between text-[11px]">
                    {cand.is_persisted ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Persisted in DB {cand.vendor_id ? `(${cand.vendor_id.slice(0, 8)}...)` : ""}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">Not Persisted</span>
                    )}

                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 font-mono text-slate-400 border border-slate-800">
                      {cand.source}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Live Activity Telemetry Event Stream */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Live Activity Event Stream (WebSocket Telemetry)
              </h2>
              <span className="text-[11px] font-mono text-indigo-400 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
                {events.length} Events Received
              </span>
            </div>
            <button onClick={() => setEvents([])} className="text-[11px] text-slate-500 hover:text-slate-300 font-medium">
              Clear Events
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 font-mono text-xs max-h-48 overflow-y-auto space-y-1.5">
            {events.length === 0 ? (
              <div className="text-slate-600 italic">No events received yet. Start discovery to observe live telemetry.</div>
            ) : (
              events.map((evt) => (
                <div key={evt.seq} className="flex items-start gap-2.5 text-slate-300 border-b border-slate-900/60 pb-1">
                  <span className="text-indigo-400 font-semibold shrink-0">#{evt.seq}</span>
                  <span className="text-slate-500 shrink-0 text-[11px]">
                    [{new Date(evt.timestamp).toLocaleTimeString()}]
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      evt.event_type.startsWith("discovery.")
                        ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                        : evt.event_type.startsWith("execution.")
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    }`}
                  >
                    {evt.event_type}
                  </span>
                  <span className="flex-1 text-slate-200">{evt.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <CompanionPairingModal
        isOpen={isPairingOpen}
        onClose={() => setIsPairingOpen(false)}
        onConnected={() => browserCompanionApi.getStatus().then(setCompanionStatus).catch(() => {})}
      />
    </div>
  );
}
