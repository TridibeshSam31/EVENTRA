"use client";

import React, { useState } from "react";
import {
  Search,
  MapPin,
  Sparkles,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PhoneCall,
  ShieldCheck,
  Building2,
  BadgeCheck,
  HelpCircle,
  TrendingUp,
} from "lucide-react";

export interface CandidateCard {
  id: string;
  name: string;
  category: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  maps_url?: string;
  rating?: number;
  review_count?: number;
  base_cost?: number;
  capacity?: number;
  qualification: string;
  availability: string;
  score: number;
  rank: number;
  confidence: number;
  reasons: string[];
  field_sources: Record<string, string>;
  distance_km?: number;
}

export interface FunnelStats {
  total_scraped: number;
  total_deduplicated: number;
  total_qualified: number;
  total_disqualified: number;
  total_contacted: number;
  total_responded: number;
  total_confirmed: number;
  radius_searched_km: number;
  iterations_run: number;
}

export interface AgenticDiscoveryResponse {
  top_matches: CandidateCard[];
  other_available_options: CandidateCard[];
  backup_waitlist: CandidateCard[];
  funnel_stats: FunnelStats;
  target_count_met: boolean;
  diagnosis_message?: string;
  search_queries_used: string[];
}

interface AgenticProviderDiscoveryProps {
  eventId?: string;
  defaultCity?: string;
  defaultCategory?: string;
  onSelectCandidate?: (candidate: CandidateCard) => void;
}

export function AgenticProviderDiscovery({
  eventId,
  defaultCity = "Delhi",
  defaultCategory = "CATERING",
  onSelectCandidate,
}: AgenticProviderDiscoveryProps) {
  const [category, setCategory] = useState<string>(defaultCategory);
  const [location, setLocation] = useState<string>(defaultCity);
  const [eventType, setEventType] = useState<string>("WEDDING");
  const [guestCount, setGuestCount] = useState<number>(150);
  const [maxBudget, setMaxBudget] = useState<number>(15000);
  const [baseRadius, setBaseRadius] = useState<number>(10);
  const [requiredAmenities, setRequiredAmenities] = useState<string>("");
  const [demoMode, setDemoMode] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [results, setResults] = useState<AgenticDiscoveryResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOtherOptions, setShowOtherOptions] = useState<boolean>(false);
  const [showQueries, setShowQueries] = useState<boolean>(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

  const handleRunAgenticDiscovery = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    const endpoint = eventId
      ? `${apiBase}/events/${eventId}/providers/agentic-discovery`
      : `${apiBase}/vendors/agentic-discovery`;

    const amenitiesList = requiredAmenities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          location: location.trim(),
          event_type: eventType,
          guest_count: guestCount > 0 ? guestCount : undefined,
          max_budget: maxBudget > 0 ? maxBudget : undefined,
          base_radius_km: baseRadius,
          required_amenities: amenitiesList,
          target_count: 6,
          max_iterations: 3,
          simulate_outreach: demoMode,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.message || `Discovery error status ${res.status}`);
      }

      const data: AgenticDiscoveryResponse = await res.json();
      setResults(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed executing agentic discovery controller.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Configuration Panel */}
      <form onSubmit={handleRunAgenticDiscovery} className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">EVENTRA Agentic Discovery Pipeline</h2>
          </div>
          <span className="text-xs text-cyan-400 font-mono bg-cyan-950/80 px-2.5 py-1 rounded border border-cyan-800/60">
            Multi-Iteration Adaptive Search
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">Provider Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
            >
              <option value="CATERING">Catering & Food Services</option>
              <option value="VENUE">Venues & Banquet Lawns</option>
              <option value="DECOR">Decor & Floral Styling</option>
              <option value="PHOTOGRAPHY">Photography</option>
              <option value="VIDEOGRAPHY">Videography & Film</option>
              <option value="DJ_MUSIC">DJ & Sound Systems</option>
              <option value="LIGHTING">Stage & Ambient Lighting</option>
              <option value="AV_TECH">AV Tech & Production</option>
              <option value="ENTERTAINMENT">Live Entertainment & Bands</option>
              <option value="TRANSPORT">Transport & Logistics</option>
              <option value="SECURITY">Event Security & Bouncers</option>
              <option value="STAFFING">Hospitality Staffing</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Target Location / City</label>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Delhi, Noida"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 pl-8 pr-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Event Type (Weight Profile)</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
            >
              <option value="WEDDING">Wedding & Reception</option>
              <option value="CORPORATE_CONFERENCE">Corporate Conference / Summit</option>
              <option value="COLLEGE_FEST">College Fest / Concert</option>
              <option value="GENERIC">General Event</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Guest Count</label>
            <input
              type="number"
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Max Budget Ceiling ($)</label>
            <input
              type="number"
              value={maxBudget}
              onChange={(e) => setMaxBudget(Number(e.target.value))}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Base Search Radius (km)</label>
            <input
              type="number"
              value={baseRadius}
              onChange={(e) => setBaseRadius(Number(e.target.value))}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-slate-400 mb-1 text-xs font-medium">
            Required Amenities / Capabilities (Comma separated)
          </label>
          <input
            type="text"
            value={requiredAmenities}
            onChange={(e) => setRequiredAmenities(e.target.value)}
            placeholder="e.g. pure_veg, outdoor_lawn, valet_parking"
            className="w-full rounded-lg bg-slate-950 border border-slate-700 text-slate-100 px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-800">
          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 h-3.5 w-3.5"
            />
            <span className="font-semibold text-yellow-400">Demo Mode</span>
            <span className="text-slate-500">(Simulate vendor outreach replies)</span>
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-4 py-2 text-xs font-semibold shadow-lg shadow-cyan-950/40 transition-all duration-150"
          >
            {isLoading ? (
              <>
                <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                Executing Agentic Search…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Agentic Discovery
              </>
            )}
          </button>
        </div>
      </form>

      {errorMsg && (
        <div className="rounded-lg border border-red-800/80 bg-red-950/50 p-4 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {results && (
        <div className="space-y-6">
          {/* Funnel Transparency Banner */}
          <div className="rounded-xl border border-cyan-900/60 bg-gradient-to-r from-slate-900 via-slate-900/95 to-cyan-950/40 p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3 border-b border-cyan-900/40 pb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <h3 className="text-xs font-semibold text-slate-200">Discovery Funnel Transparency Stats</h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                {results.funnel_stats.iterations_run} Iteration(s) | {results.funnel_stats.radius_searched_km}km Radius
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center text-xs">
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Scraped</p>
                <p className="text-sm font-bold text-slate-200 font-mono">{results.funnel_stats.total_scraped}</p>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Deduplicated</p>
                <p className="text-sm font-bold text-slate-200 font-mono">{results.funnel_stats.total_deduplicated}</p>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Qualified</p>
                <p className="text-sm font-bold text-emerald-400 font-mono">{results.funnel_stats.total_qualified}</p>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Contacted</p>
                <p className="text-sm font-bold text-cyan-400 font-mono">{results.funnel_stats.total_contacted}</p>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Responded</p>
                <p className="text-sm font-bold text-amber-400 font-mono">{results.funnel_stats.total_responded}</p>
              </div>
              <div className="bg-cyan-950/70 p-2 rounded border border-cyan-800/80">
                <p className="text-[10px] text-cyan-300 uppercase font-medium">Confirmed</p>
                <p className="text-sm font-bold text-cyan-200 font-mono">{results.funnel_stats.total_confirmed}</p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-300 text-center font-medium">
              Contacted <span className="text-cyan-400 font-semibold">{results.funnel_stats.total_contacted}</span> vendors within {results.funnel_stats.radius_searched_km}km →{" "}
              <span className="text-amber-400 font-semibold">{results.funnel_stats.total_responded}</span> responded →{" "}
              <span className="text-emerald-400 font-semibold">{results.funnel_stats.total_confirmed}</span> confirmed availability matching your event requirements.
            </p>

            {results.search_queries_used && results.search_queries_used.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px]">
                <button
                  onClick={() => setShowQueries(!showQueries)}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <span>Search queries generated ({results.search_queries_used.length})</span>
                  {showQueries ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showQueries && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {results.search_queries_used.map((q, i) => (
                      <span key={i} className="bg-slate-950 text-slate-300 px-2 py-0.5 rounded font-mono text-[10px] border border-slate-800">
                        "{q}"
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Diagnostic Warning Banner if Target Count Unmet */}
          {!results.target_count_met && results.diagnosis_message && (
            <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 text-xs text-amber-200 flex items-start gap-3 shadow-lg">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="font-semibold text-amber-300">Target Candidate Count Unfulfilled</p>
                <p>{results.diagnosis_message}</p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      setBaseRadius(baseRadius + 5);
                      handleRunAgenticDiscovery();
                    }}
                    className="bg-amber-900/80 hover:bg-amber-800 text-amber-100 px-3 py-1 rounded text-[11px] font-medium border border-amber-700/60"
                  >
                    + Widen Radius (+5km)
                  </button>
                  <button
                    onClick={() => {
                      setMaxBudget(maxBudget * 1.25);
                      handleRunAgenticDiscovery();
                    }}
                    className="bg-amber-900/80 hover:bg-amber-800 text-amber-100 px-3 py-1 rounded text-[11px] font-medium border border-amber-700/60"
                  >
                    + Increase Budget Ceiling (+25%)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tier 1: Top Matches */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">Top Matches ({results.top_matches.length})</h3>
              </div>
              <span className="text-xs text-slate-400">Best Overall Fit & Confirmed Availability</span>
            </div>

            {results.top_matches.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-4 text-center">No confirmed top matches found matching requirements.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.top_matches.map((cand) => (
                  <CandidateCardComponent key={cand.id} card={cand} onSelect={onSelectCandidate} />
                ))}
              </div>
            )}
          </div>

          {/* Tier 2: Other Available Options */}
          {results.other_available_options.length > 0 && (
            <div className="space-y-3 pt-2">
              <button
                onClick={() => setShowOtherOptions(!showOtherOptions)}
                className="w-full flex items-center justify-between border-b border-slate-800 pb-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-200">
                    Other Available Options ({results.other_available_options.length})
                  </h3>
                </div>
                <div className="flex items-center gap-1 text-xs text-cyan-400 font-medium">
                  <span>{showOtherOptions ? "Hide options" : "Show options"}</span>
                  {showOtherOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>

              {showOtherOptions && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {results.other_available_options.map((cand) => (
                    <CandidateCardComponent key={cand.id} card={cand} onSelect={onSelectCandidate} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tier 3: Backup / Waitlist */}
          {results.backup_waitlist.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <PhoneCall className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-300">
                  Backup / Waitlist ({results.backup_waitlist.length})
                </h3>
                <span className="text-[11px] text-slate-500 italic ml-2">Good Fit — Outreach Response Pending</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-80 hover:opacity-100 transition-opacity">
                {results.backup_waitlist.map((cand) => (
                  <CandidateCardComponent key={cand.id} card={cand} onSelect={onSelectCandidate} isWaitlist />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateCardComponent({
  card,
  onSelect,
  isWaitlist = false,
}: {
  card: CandidateCard;
  onSelect?: (c: CandidateCard) => void;
  isWaitlist?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg backdrop-blur transition-all duration-200 hover:border-slate-700">
      <div className="space-y-3">
        {/* Rank & Badges */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-lg bg-cyan-950 px-2.5 py-1 text-xs font-bold text-cyan-400 border border-cyan-800/80 font-mono">
              #{card.rank}
            </span>
            <span className="text-xs font-semibold text-slate-200">{card.name}</span>
          </div>
          <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-2 py-0.5 text-[11px] font-mono text-cyan-300 border border-slate-700/60">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Score: {(card.score * 100).toFixed(0)}%
          </span>
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60">
            <ShieldCheck className="h-3 w-3" />
            Qualified
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium border ${
              card.availability === "confirmed"
                ? "bg-cyan-950/80 text-cyan-300 border-cyan-800/80"
                : "bg-amber-950/80 text-amber-300 border-amber-800/80"
            }`}
          >
            <PhoneCall className="h-3 w-3" />
            {card.availability === "confirmed" ? "Availability Confirmed" : "Outreach Pending"}
          </span>

          {card.distance_km !== undefined && (
            <span className="text-slate-400 font-mono">{card.distance_km}km away</span>
          )}
        </div>

        {/* Key Attributes with Verified vs Estimated Badges */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <div>
            <span className="text-slate-400 block text-[10px]">Estimated Price</span>
            <div className="flex items-center gap-1.5 font-mono text-slate-200">
              <span>{card.base_cost ? `$${card.base_cost.toLocaleString()}` : "N/A"}</span>
              <FieldTag tag={card.field_sources?.base_cost || "inferred"} />
            </div>
          </div>

          <div>
            <span className="text-slate-400 block text-[10px]">Capacity Fit</span>
            <div className="flex items-center gap-1.5 font-mono text-slate-200">
              <span>{card.capacity ? `${card.capacity} guests` : "Standard"}</span>
              <FieldTag tag={card.field_sources?.capacity || "inferred"} />
            </div>
          </div>
        </div>

        {/* Evidence Reasons List */}
        {card.reasons && card.reasons.length > 0 && (
          <div className="space-y-1 pt-1">
            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Scraped & Verified Evidence</span>
            <ul className="space-y-1 text-xs text-slate-300">
              {card.reasons.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Select Candidate Action */}
      {onSelect && (
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-mono">{card.city}</span>
          <button
            onClick={() => onSelect(card)}
            disabled={isWaitlist}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow transition-all duration-150"
          >
            {isWaitlist ? "Waitlist Pending" : "Select Candidate"}
          </button>
        </div>
      )}
    </div>
  );
}

function FieldTag({ tag }: { tag: string }) {
  const isVerified = tag === "verified";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.2 text-[9px] font-semibold border ${
        isVerified
          ? "bg-emerald-950/80 text-emerald-400 border-emerald-800/60"
          : "bg-amber-950/80 text-amber-400 border-amber-800/60"
      }`}
    >
      {isVerified ? "VERIFIED" : "ESTIMATED"}
    </span>
  );
}
