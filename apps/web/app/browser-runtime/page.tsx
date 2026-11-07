"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
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
import Link from "next/link";
import {
  Laptop,
  ArrowLeft,
  ExternalLink,
  Square,
  Play,
  AlertTriangle,
  X,
  Loader2,
  Search,
  Globe,
  Plus,
  RotateCw,
  Star,
  MapPin,
  Phone,
  PhoneCall,
  ChevronDown,
} from "lucide-react";
import { BrandMark } from "@/components/shell/BrandMark";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import {
  addShortlistEntry,
  selectShortlistCandidate,
  approveShortlistCommunication,
} from "@/lib/api/shortlist";

const PRESET_EVENTS = [
  { id: "b134fac2-3642-43d5-b38c-64899bae0753", label: "Annual Corporate Gala (Delhi • 350 guests • ₹15L)", city: "Delhi", type: "CONFERENCE" },
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

function BrowserRuntimeContent() {
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
  const queryCategory = searchParams ? searchParams.get("category") : null;
  const [showVncFallback, setShowVncFallback] = useState<boolean>(false);

  useEffect(() => {
    if (queryEventId) {
      setEventId("custom");
      setCustomEventId(queryEventId);
    }
    if (queryCategory) {
      const match = CATEGORIES.find(
        (c) => c.id.toUpperCase() === queryCategory.toUpperCase()
      );
      if (match) {
        setDiscoveryCategory(match.id);
      }
    }
  }, [queryEventId, queryCategory]);

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
  const [showRejected, setShowRejected] = useState<boolean>(false);
  const [callStates, setCallStates] = useState<
    Record<string, { phase: "confirm" | "running" | "done" | "error"; message?: string }>
  >({});
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

  const activeCandidates = candidates.filter((c) => c.qualification_status !== "rejected");
  const rejectedCandidates = candidates.filter((c) => c.qualification_status === "rejected");

  // Human-in-the-loop call: shortlist -> select -> approve-communication (existing gated flow).
  // The approve step is what actually places the Twilio call + WhatsApp message, and it only
  // runs after the organizer confirms in the card.
  const handleCallCandidate = async (cand: DiscoveredCandidate) => {
    if (!cand.vendor_id) return;
    const eventForCall = effectiveEventId;
    setCallStates((prev) => ({ ...prev, [cand.id]: { phase: "running" } }));
    try {
      await addShortlistEntry(eventForCall, {
        candidate_id: cand.vendor_id,
        provider_id: cand.vendor_id,
        category: cand.category,
        candidate_name: cand.name,
        ranking: cand.rank ?? null,
        selection_source: "BROWSER_AGENT",
        candidate_data: {
          address: cand.address,
          city: cand.city,
          rating: cand.rating,
          score: cand.score,
          maps_url: cand.maps_url,
          recommendation_reasons: cand.recommendation_reasons,
        },
      });
      await selectShortlistCandidate(eventForCall, cand.vendor_id);
      await approveShortlistCommunication(eventForCall, cand.vendor_id);
      setCallStates((prev) => ({
        ...prev,
        [cand.id]: { phase: "done", message: "Call + WhatsApp dispatched. Track it on the event's Negotiations page." },
      }));
    } catch (err: any) {
      setCallStates((prev) => ({
        ...prev,
        [cand.id]: { phase: "error", message: err?.message || "Could not start the call." },
      }));
    }
  };

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

  const sessionMeta =
    execution?.status === "running"
      ? { label: "Running", chip: "border-go-400/30 bg-go-500/15 text-go-300", dot: "bg-go-400 animate-cue-blink" }
      : execution?.status === "starting"
      ? { label: "Starting", chip: "border-standby-400/30 bg-standby-500/15 text-standby-300", dot: "bg-standby-400 animate-cue-blink" }
      : execution
      ? { label: humanizeStatus(execution.status), chip: "border-white/10 bg-white/5 text-ink-300", dot: "bg-ink-500" }
      : { label: "Idle", chip: "border-white/10 bg-white/5 text-ink-400", dot: "bg-ink-600" };

  const companionView = !!companionStatus?.is_connected && !showVncFallback;
  const field =
    "w-full rounded-lg border border-ink-200 bg-[#FDFCFA] px-3 py-2 text-[13px] text-ink-900 shadow-sm transition placeholder:text-ink-400 focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-cue-500/15 disabled:opacity-50";
  const label = "mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-label text-ink-500";

  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink-900">
      {/* Header */}
      <header className="relative overflow-hidden bg-ink-950 text-ink-100">
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-60" aria-hidden />
        <div
          className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(214,0,60,0.35), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={effectiveEventId ? `/events/${effectiveEventId}/vendors` : "/dashboard"} aria-label="Back">
              <BrandMark className="h-9 w-9" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[20px] font-extrabold tracking-[-0.01em] text-white" style={{ fontStretch: "88%" }}>
                  Browser agent
                </h1>
                <span className={`chip ${sessionMeta.chip}`}>
                  <span className={`cue-light ${sessionMeta.dot}`} />
                  {sessionMeta.label}
                </span>
                <span
                  className={`chip ${
                    wsConnected ? "border-go-400/30 bg-go-500/10 text-go-300" : "border-white/10 bg-white/5 text-ink-500"
                  }`}
                  title="Live event stream from the browser session"
                >
                  {wsConnected ? "Stream live" : "Stream off"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-400">
                A real, visible browser that searches Google Maps for this event and saves what it finds as evidence.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {effectiveEventId && (
              <Link
                href={`/events/${effectiveEventId}/vendors`}
                className="btn h-8 border border-white/10 bg-white/5 px-3 text-[12px] text-ink-200 hover:bg-white/10"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Vendors
              </Link>
            )}
            <button
              onClick={() => setIsPairingOpen(true)}
              className="btn h-8 border border-white/10 bg-white/5 px-3 text-[12px] text-ink-200 hover:bg-white/10"
              title="Pair or manage the Windows browser companion"
            >
              <span className={`cue-light ${companionStatus?.is_connected ? "bg-go-400" : "bg-standby-400"}`} />
              <Laptop className="h-3.5 w-3.5" />
              {companionStatus?.is_connected ? "Desktop browser ready" : "Pair Windows browser"}
            </button>
            <a
              href={viewerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn h-8 border border-white/10 bg-white/5 px-3 text-[12px] text-ink-200 hover:bg-white/10"
            >
              Viewer <ExternalLink className="h-3 w-3" />
            </a>
            {execution?.status === "running" ? (
              <button onClick={handleStop} disabled={loading || isDiscovering} className="btn-cue h-8 px-3 text-[12px]">
                <Square className="h-3 w-3 fill-white" /> Stop session
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading}
                className="btn h-8 bg-ink-50 px-3 text-[12px] text-ink-900 hover:bg-white"
              >
                <Play className="h-3 w-3 fill-ink-900" /> {loading ? "Starting…" : "Start browser"}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-cue-200 bg-cue-50" role="alert">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-cue-900 sm:px-6">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-cue-600" />
              {error}
            </span>
            <button onClick={() => setError(null)} className="rounded p-1 text-cue-500 hover:bg-cue-100 hover:text-cue-800" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {/* Mode switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="inline-flex rounded-lg border border-ink-200 bg-ink-100/70 p-0.5">
            {(
              [
                { id: "discovery", label: "Discover vendors" },
                { id: "manual", label: "Manual control" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  activeTab === t.id ? "bg-[#FDFCFA] text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {execution?.execution_id && (
            <span className="font-mono text-[11px] text-ink-500">
              Session <span className="text-ink-800">{execution.execution_id}</span>
            </span>
          )}
        </div>

        {/* Discovery controls */}
        {activeTab === "discovery" && (
          <section className="surface overflow-hidden">
            <div className="px-5 pb-1 pt-5">
              <div className="eyebrow">Discovery brief</div>
              <h2 className="mt-1 text-[16px] font-semibold text-ink-900">What should the browser look for?</h2>
              <p className="mt-0.5 text-[13px] text-ink-500">
                The agent reads the event&apos;s real requirements, then searches Google Maps and inspects each listing.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 px-5 py-5 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={label} htmlFor="br-event">
                  Event
                </label>
                <select
                  id="br-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  disabled={isDiscovering}
                  className={field}
                >
                  {PRESET_EVENTS.map((pe) => (
                    <option key={pe.id} value={pe.id}>
                      {pe.label}
                    </option>
                  ))}
                  <option value="custom">Custom event ID…</option>
                </select>
                {eventId === "custom" && (
                  <input
                    type="text"
                    value={customEventId}
                    onChange={(e) => setCustomEventId(e.target.value)}
                    placeholder="Event ID, e.g. evt_…"
                    aria-label="Custom event ID"
                    className={`${field} mt-2 font-mono text-[12px]`}
                  />
                )}
              </div>

              <div>
                <label className={label} htmlFor="br-category">
                  Category
                </label>
                <select
                  id="br-category"
                  value={discoveryCategory}
                  onChange={(e) => setDiscoveryCategory(e.target.value)}
                  disabled={isDiscovering}
                  className={field}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={label} htmlFor="br-depth">
                  Depth · <span className="text-ink-900">{discoveryMaxResults} listings</span>
                </label>
                <input
                  id="br-depth"
                  type="range"
                  min={1}
                  max={10}
                  value={discoveryMaxResults}
                  onChange={(e) => setDiscoveryMaxResults(Number(e.target.value))}
                  disabled={isDiscovering}
                  className="mt-2.5 w-full cursor-pointer accent-cue-600"
                />
                <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-400">
                  <span>Fast · 1</span>
                  <span>5</span>
                  <span>Deep · 10</span>
                </div>
              </div>

              <div className="flex flex-col justify-end gap-2.5">
                <label htmlFor="persist-check" className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
                  <input
                    type="checkbox"
                    id="persist-check"
                    checked={persistDiscovery}
                    onChange={(e) => setPersistDiscovery(e.target.checked)}
                    disabled={isDiscovering}
                    className="h-4 w-4 cursor-pointer rounded accent-cue-600"
                  />
                  Save qualified vendors to the event
                </label>
                <button onClick={handleStartDiscovery} disabled={isDiscovering || loading} className="btn-cue w-full">
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Researching…
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5" /> Launch discovery
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="border-t border-ink-200 bg-ink-50/60 px-5 py-4">
              <label className={label} htmlFor="br-query">
                Custom search query <span className="normal-case tracking-normal text-ink-400">(optional)</span>
              </label>
              <input
                id="br-query"
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder="Leave blank to use the query built from the event, e.g. “Catering in San Francisco”"
                disabled={isDiscovering}
                className={field}
              />
            </div>

            {discoveryStatus && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 bg-ink-900 px-5 py-3 text-[12.5px] text-ink-100"
                role="status"
                aria-live="polite"
              >
                <span className="flex items-center gap-2.5">
                  <span className={`cue-light ${isDiscovering ? "bg-standby-400 animate-cue-blink" : "bg-go-400"}`} />
                  {discoveryStatus}
                </span>
                {discoverySummary && (
                  <span className="flex items-center gap-4 font-mono text-[11.5px]">
                    <span>
                      <span className="text-white">{discoverySummary.total_found}</span> <span className="text-ink-400">found</span>
                    </span>
                    <span>
                      <span className="text-go-300">{discoverySummary.total_qualified}</span>{" "}
                      <span className="text-ink-400">qualified</span>
                    </span>
                    <span>
                      <span className="text-engine-300">{discoverySummary.total_persisted}</span>{" "}
                      <span className="text-ink-400">saved</span>
                    </span>
                  </span>
                )}
              </div>
            )}
          </section>
        )}

        {/* Manual control */}
        {activeTab === "manual" && (
          <section className="surface px-5 py-5">
            <div className="eyebrow mb-3">Manual browser control</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
                  placeholder="https://…"
                  aria-label="URL"
                  disabled={execution?.status !== "running" || loading}
                  className={`${field} pl-9 font-mono text-[12.5px]`}
                />
              </div>
              <button
                onClick={() => handleNavigate()}
                disabled={execution?.status !== "running" || loading}
                className="btn-primary"
              >
                Go
              </button>
              <button
                onClick={handleCreateTab}
                disabled={execution?.status !== "running" || loading}
                className="btn-secondary"
              >
                <Plus className="h-3.5 w-3.5" /> New tab
              </button>
            </div>
            {execution?.status !== "running" && (
              <p className="mt-2 text-[12px] text-ink-500">Start the browser to navigate manually.</p>
            )}

            {execution?.tabs && execution.tabs.length > 0 && (
              <div className="mt-4 flex items-center gap-1.5 overflow-x-auto border-t border-dashed border-ink-200 pt-3">
                <span className="mr-1 font-mono text-[10px] uppercase tracking-label text-ink-400">Tabs</span>
                {execution.tabs.map((tab: TabInfo) => (
                  <button
                    key={tab.tab_id}
                    onClick={() => handleActivateTab(tab.tab_id)}
                    className={`max-w-[220px] shrink-0 truncate rounded-md px-3 py-1 text-[12px] font-medium transition ${
                      tab.is_active ? "bg-ink-900 text-ink-50" : "border border-ink-200 bg-[#FDFCFA] text-ink-600 hover:border-ink-300"
                    }`}
                    title={`${tab.title || "Untitled"} [${tab.tab_id}]`}
                  >
                    {tab.title || "Untitled"}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Viewer */}
        <section className="overflow-hidden rounded-2xl bg-ink-950 shadow-xl ring-1 ring-black/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-cue-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-standby-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-go-500/80" />
              </span>
              <span className="truncate text-[12.5px] font-semibold text-ink-100">
                {companionView ? "Windows desktop browser" : "Container browser (noVNC)"}
              </span>
              <span className="hidden truncate font-mono text-[11px] text-ink-500 md:inline">
                {companionView ? "Visible on your desktop" : "Virtual display · Playwright"}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              {companionView ? (
                <button onClick={() => setShowVncFallback(true)} className="text-ink-400 transition hover:text-white">
                  Switch to container view
                </button>
              ) : (
                <>
                  {companionStatus?.is_connected && (
                    <button onClick={() => setShowVncFallback(false)} className="text-go-300 transition hover:text-go-200">
                      Switch to desktop view
                    </button>
                  )}
                  <button
                    onClick={() => setViewerKey((k) => k + 1)}
                    className="inline-flex items-center gap-1 text-ink-400 transition hover:text-white"
                  >
                    <RotateCw className="h-3 w-3" /> Reload
                  </button>
                </>
              )}
            </div>
          </div>

          {companionView ? (
            <div className="flex min-h-[420px] flex-col justify-between gap-5 p-5 sm:p-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-go-500/10 text-go-300 ring-1 ring-go-400/30">
                      <Laptop className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
                        Browser is running on your desktop
                        <span className="cue-light bg-go-400 animate-cue-blink" />
                      </div>
                      <p className="mt-0.5 text-[12px] text-ink-400">
                        Connected to {companionStatus?.device_name || "Windows desktop"} · watch it work in the real window
                      </p>
                    </div>
                  </div>
                  {execution?.execution_id && (
                    <span className="font-mono text-[11px] text-ink-500">
                      Session <span className="text-ink-300">{execution.session_id || execution.execution_id}</span>
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/[0.06] md:grid-cols-3">
                  <div className="bg-ink-950 px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-label text-ink-500">Current page</dt>
                    <dd className="mt-1 truncate">
                      {execution?.current_url ? (
                        <a
                          href={execution.current_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[12px] text-ink-200 hover:text-white hover:underline"
                          title={execution.current_url}
                        >
                          {execution.current_url}
                        </a>
                      ) : (
                        <span className="text-[12px] italic text-ink-500">Waiting for navigation…</span>
                      )}
                    </dd>
                  </div>
                  <div className="bg-ink-950 px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-label text-ink-500">Page title</dt>
                    <dd className="mt-1 truncate text-[12.5px] text-ink-200">{execution?.current_title || "Untitled tab"}</dd>
                  </div>
                  <div className="bg-ink-950 px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-label text-ink-500">Browser</dt>
                    <dd className="mt-1 text-[12.5px] text-ink-200">
                      {execution?.tabs?.length ?? 1} tab(s) · {execution?.status ? humanizeStatus(execution.status) : "Idle"}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-xl bg-black/30 px-4 py-3 ring-1 ring-white/[0.05]">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-label text-ink-500">Latest activity</div>
                  <ul className="max-h-36 space-y-1 overflow-y-auto font-mono text-[11.5px]">
                    {events.slice(0, 5).map((evt) => (
                      <li key={evt.seq} className="flex gap-3">
                        <span className="shrink-0 tabular-nums text-ink-500">{timecode(evt.timestamp)}</span>
                        <span className="shrink-0 text-agent-300">{evt.event_type}</span>
                        <span className="truncate text-ink-200">{evt.message}</span>
                      </li>
                    ))}
                    {events.length === 0 && (
                      <li className="text-[12px] italic text-ink-500">
                        Ready. The browser window on your desktop will start moving when a task begins.
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[12px] text-ink-400">
                <span className="flex items-center gap-2">
                  <span className="cue-light bg-go-400" /> Managed by Playwright
                </span>
                {execution?.status === "running" && (
                  <button
                    onClick={handleStop}
                    className="btn h-8 border border-cue-400/30 bg-cue-500/10 px-3 text-[12px] text-cue-200 hover:bg-cue-500/20"
                  >
                    <Square className="h-3 w-3" /> Stop the browser
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="relative min-h-[500px] w-full bg-black">
              <iframe
                key={viewerKey}
                src={viewerUrl}
                title="EVENTRA live browser (noVNC)"
                className="h-full min-h-[500px] w-full border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
              {!execution && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950 bg-dots-dark text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/5 text-ink-400 ring-1 ring-white/10">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div className="text-[14px] font-semibold text-ink-100">No browser session running</div>
                  <p className="max-w-[40ch] text-[12.5px] text-ink-500">
                    Start the browser, or launch discovery and a session will start for you.
                  </p>
                  <button
                    onClick={handleStart}
                    disabled={loading}
                    className="btn mt-1 h-8 bg-ink-50 px-3 text-[12px] text-ink-900 hover:bg-white"
                  >
                    <Play className="h-3 w-3 fill-ink-900" /> {loading ? "Starting…" : "Start browser"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Candidates */}
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="eyebrow">Results</div>
              <h2 className="mt-1 text-[16px] font-semibold text-ink-900">
                Candidates found{" "}
                <span className="font-mono text-[12px] font-normal text-ink-400">{candidates.length}</span>
              </h2>
            </div>
            {candidates.length > 0 && (
              <span className="font-mono text-[11.5px] text-ink-500">
                {candidates.filter((c) => c.is_persisted).length} saved to the event
              </span>
            )}
          </div>

          {candidates.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-6 py-12 text-center">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-400 shadow-sm">
                <Search className="h-5 w-5" />
              </div>
              <p className="text-[15px] font-semibold text-ink-900">No candidates yet</p>
              <p className="mt-1 max-w-[46ch] text-[13px] text-ink-500">
                Launch discovery and the browser will search Google Maps, inspect each business and list it here with
                its evidence.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...activeCandidates, ...(showRejected ? rejectedCandidates : [])].map((cand) => {
                const q = cand.qualification_status;
                const qMeta =
                  q === "qualified"
                    ? { label: "Qualified", cls: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" }
                    : q === "uncertain"
                    ? { label: "Uncertain", cls: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500" }
                    : { label: "Excluded", cls: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600" };
                const call = callStates[cand.id];
                return (
                  <article
                    key={cand.id}
                    className={`flex flex-col overflow-hidden rounded-xl border bg-[#FDFCFA] shadow-sm transition hover:shadow-md ${
                      q === "rejected" ? "border-ink-200 opacity-80" : "border-ink-200 hover:border-ink-300"
                    }`}
                  >
                    <div className="flex-1 space-y-3 px-4 pb-3 pt-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-[14.5px] font-semibold leading-snug text-ink-900">{cand.name}</h3>
                          <p className="mt-0.5 text-[12px] text-ink-500">
                            {humanizeStatus(cand.category)}
                            {cand.city ? ` · ${cand.city}` : ""}
                          </p>
                        </div>
                        <span className={`chip shrink-0 ${qMeta.cls}`}>
                          <span className={`cue-light ${qMeta.dot}`} />
                          {qMeta.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {cand.recommended && (
                          <span className="chip border-agent-200 bg-agent-50 text-agent-700">
                            <span aria-hidden>✦</span> Recommended
                            {typeof cand.score === "number" ? ` · ${Math.round(cand.score * 100)}%` : ""}
                          </span>
                        )}
                        {cand.rating ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-800">
                            <Star className="h-3 w-3 fill-standby-400 text-standby-400" />
                            {cand.rating}
                            {cand.review_count ? (
                              <span className="font-normal text-ink-400">({cand.review_count})</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-[11.5px] italic text-ink-400">No rating listed</span>
                        )}
                      </div>

                      <dl className="space-y-1.5 text-[12px]">
                        {cand.address && (
                          <div className="flex items-start gap-2 text-ink-600">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                            <span className="line-clamp-2">{cand.address}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                          {cand.phone ? (
                            <a href={`tel:${cand.phone}`} className="font-mono text-[12px] text-ink-800 hover:underline">
                              {cand.phone}
                            </a>
                          ) : (
                            <span className="italic text-ink-400">Phone unknown</span>
                          )}
                        </div>
                      </dl>

                      <div className="flex flex-wrap gap-3 text-[12px]">
                        {cand.website ? (
                          <a
                            href={cand.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:text-ink-900 hover:underline"
                          >
                            Website <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="italic text-ink-400">No website</span>
                        )}
                        {cand.maps_url && (
                          <a
                            href={cand.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:text-ink-900 hover:underline"
                          >
                            Google Maps <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>

                      {cand.qualification_reasons.length > 0 && (
                        <div className="rounded-lg bg-ink-100/60 px-3 py-2">
                          <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-label text-ink-500">
                            <span className="text-engine-600">✓</span> Qualification notes
                          </div>
                          <ul className="space-y-0.5 text-[12px] text-ink-700">
                            {cand.qualification_reasons.slice(0, 2).map((reason, idx) => (
                              <li key={idx} className="line-clamp-1">
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Human-in-the-loop call */}
                    {q !== "rejected" && cand.vendor_id && cand.phone && (
                      <div className="border-t border-dashed border-ink-200 px-4 py-3 text-[12px]">
                        {!call && (
                          <button
                            onClick={() => setCallStates((prev) => ({ ...prev, [cand.id]: { phase: "confirm" } }))}
                            className="btn-primary h-8 w-full text-[12px]"
                          >
                            <PhoneCall className="h-3.5 w-3.5" /> Call this {cand.category.toLowerCase() === "venue" ? "venue" : "vendor"}
                          </button>
                        )}
                        {call?.phase === "confirm" && (
                          <div className="space-y-2">
                            <p className="text-ink-700">
                              The agent will call <span className="font-mono">{cand.phone}</span> and message {cand.name} on
                              WhatsApp.
                            </p>
                            <div className="flex gap-2">
                              <button onClick={() => handleCallCandidate(cand)} className="btn-cue h-8 flex-1 text-[12px]">
                                Confirm call
                              </button>
                              <button
                                onClick={() =>
                                  setCallStates((prev) => {
                                    const next = { ...prev };
                                    delete next[cand.id];
                                    return next;
                                  })
                                }
                                className="btn-secondary h-8 flex-1 text-[12px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {call?.phase === "running" && (
                          <p className="flex items-center gap-2 text-standby-800">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting call…
                          </p>
                        )}
                        {call?.phase === "done" && <p className="text-go-700">{call.message}</p>}
                        {call?.phase === "error" && <p className="text-cue-700">{call.message}</p>}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 border-t border-ink-200 bg-ink-50/70 px-4 py-2 text-[11.5px]">
                      {cand.is_persisted ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-go-700">
                          <span className="cue-light bg-go-500" />
                          Saved{cand.vendor_id ? <span className="font-mono font-normal text-ink-400"> {cand.vendor_id.slice(0, 8)}</span> : null}
                        </span>
                      ) : (
                        <span className="italic text-ink-400">Not saved</span>
                      )}
                      <ProvenanceBadge source={cand.source} size="sm" />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {rejectedCandidates.length > 0 && (
            <button
              onClick={() => setShowRejected((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRejected ? "rotate-180" : ""}`} />
              {showRejected
                ? "Hide excluded candidates"
                : `${rejectedCandidates.length} excluded (government, institutions, not hireable) — review`}
            </button>
          )}
        </section>

        {/* Event stream */}
        <section className="overflow-hidden rounded-xl bg-ink-950 ring-1 ring-black/20">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-label text-ink-400">Event stream</span>
              <span className="font-mono text-[11px] text-ink-500">{events.length} received</span>
            </div>
            <button onClick={() => setEvents([])} className="font-mono text-[11px] text-ink-500 transition hover:text-ink-200">
              Clear
            </button>
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed">
            {events.length === 0 ? (
              <li className="italic text-ink-500">Nothing yet. Start discovery to watch the browser&apos;s events live.</li>
            ) : (
              events.map((evt) => (
                <li key={evt.seq} className="flex items-start gap-3">
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-600">#{evt.seq}</span>
                  <span className="shrink-0 tabular-nums text-ink-500">{timecode(evt.timestamp)}</span>
                  <span
                    className={`shrink-0 ${
                      evt.event_type.startsWith("discovery.")
                        ? "text-agent-300"
                        : evt.event_type.startsWith("execution.")
                        ? "text-info-300"
                        : "text-go-300"
                    }`}
                  >
                    {evt.event_type}
                  </span>
                  <span className="min-w-0 flex-1 text-ink-200">{evt.message}</span>
                </li>
              ))
            )}
          </ul>
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

function humanizeStatus(s?: string | null) {
  if (!s) return "";
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function timecode(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function BrowserRuntimePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-paper font-mono text-[12px] text-ink-500">
          Loading browser agent…
        </div>
      }
    >
      <BrowserRuntimeContent />
    </Suspense>
  );
}
