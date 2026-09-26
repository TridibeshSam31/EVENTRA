"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  MapPin, 
  Users, 
  Star, 
  ArrowRight, 
  Filter, 
  Check, 
  Loader2, 
  Sparkles, 
  Trophy, 
  CheckCircle2, 
  ShieldCheck, 
  Compass, 
  SlidersHorizontal, 
  Building2, 
  Flame, 
  ThumbsUp, 
  DollarSign,
  Info,
  Radio
} from 'lucide-react';
import { 
  recommendVenues, 
  selectEventVenue, 
  type RankedVenue, 
  type VenueRecommendationResult 
} from '../../../../../lib/api/venues';
import { getEvent } from '../../../../../lib/api/events';

const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=2000',
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?auto=format&fit=crop&q=80&w=2000',
];

export default function VenueSearchPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  // Search & Navigation States
  const [targetCity, setTargetCity] = useState('Delhi');
  const [userDescription, setUserDescription] = useState('Conference space for 500 attendees with stage, lighting, audio visual, and parking');
  const [guestCount, setGuestCount] = useState<number>(500);
  const [eventType, setEventType] = useState('CONFERENCE');

  // AI Recommendation State
  const [isAiScouting, setIsAiScouting] = useState(false);
  const [recData, setRecData] = useState<VenueRecommendationResult | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'All' | 'Highest Match' | 'Mega Capacity' | 'Value'>('All');
  
  // Selection feedback
  const [lockingVenueId, setLockingVenueId] = useState<string | null>(null);
  const [lockedVenueId, setLockedVenueId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const quickCities = ['Delhi', 'Noida', 'Mumbai', 'Bengaluru', 'San Francisco', 'Chicago'];

  async function scoutVenues(cityOverride?: string, descOverride?: string, guestsOverride?: number) {
    setIsAiScouting(true);
    setFeedbackMsg(null);
    try {
      const city = cityOverride || targetCity || 'Delhi';
      const desc = descOverride !== undefined ? descOverride : userDescription;
      const guests = guestsOverride || guestCount || 500;

      const res = await recommendVenues({
        city: city,
        guest_count: guests,
        event_type: eventType,
        description: desc,
        event_id: eventId || undefined,
      });
      setRecData(res);
    } catch (err: any) {
      console.error("Failed to scout venues:", err);
    } finally {
      setIsAiScouting(false);
    }
  }

  useEffect(() => {
    async function loadEventData() {
      if (!eventId) return;
      try {
        const ev = await getEvent(eventId);
        if (ev) {
          const c = ev.location ? ev.location.split(',')[0].trim() : 'Delhi';
          const g = ev.guest_count || 500;
          const t = ev.event_type || 'CONFERENCE';
          const d = ev.description || `Grand ${t.toLowerCase()} for ${g} guests in ${c} with audio visual setup and stage`;
          
          setTargetCity(c);
          setGuestCount(g);
          setEventType(t);
          setUserDescription(d);
          scoutVenues(c, d, g);
          return;
        }
      } catch (e) {
        console.error("Could not load initial event details:", e);
      }
      scoutVenues();
    }
    loadEventData();
  }, [eventId]);

  async function handleLockVenue(venue: RankedVenue) {
    if (!eventId) return;
    setLockingVenueId(venue.id);
    try {
      const res = await selectEventVenue(eventId, venue.id);
      if (res.success) {
        setLockedVenueId(venue.id);
        setFeedbackMsg(`✓ Successfully locked "${venue.name}" as the official event venue!`);
      }
    } catch (err: any) {
      console.error("Error locking venue:", err);
      setFeedbackMsg("Failed to lock venue. Please try again.");
    } finally {
      setLockingVenueId(null);
    }
  }

  // Filter candidate items
  const candidates = (recData?.ranked_venues || []).filter(v => {
    if (selectedFilter === 'Highest Match') return v.suitability_score >= 90;
    if (selectedFilter === 'Mega Capacity') return v.capacity >= 1000;
    if (selectedFilter === 'Value') return (v.hourly_rate || 0) < 250;
    return true;
  });

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-y-auto no-scrollbar p-4 md:p-8 relative text-white font-sans">
      
      {/* Header & AI Intelligence Banner */}
      <div className="max-w-5xl mx-auto w-full space-y-6 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Compass className="text-purple-400 w-5 h-5 animate-spin-slow" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-purple-400 uppercase">
              Geospatial Operations Radar
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-light tracking-tight">
            AI Venue <span className="font-bold">Navigator</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Autonomous scouting across live open geospatial networks to navigate and recommend the best venue for your event requirements.
          </p>
        </div>

        {/* AI Requirement Navigator Box */}
        <div className="bg-[#0e111a] border border-white/10 rounded-2xl p-5 shadow-2xl relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              scoutVenues();
            }}
            className="space-y-4 relative z-10"
          >
            {/* Quick city selectors */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-gray-400 mr-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-purple-400" /> City / State:
              </span>
              {quickCities.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setTargetCity(c);
                    scoutVenues(c);
                  }}
                  className={`text-xs px-3 py-1 rounded-full font-mono transition-all ${
                    targetCity.toLowerCase() === c.toLowerCase()
                      ? 'bg-purple-600 text-white font-bold shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Inputs grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-1">
                <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider block mb-1">
                  Target City or State
                </label>
                <input 
                  type="text"
                  value={targetCity}
                  onChange={(e) => setTargetCity(e.target.value)}
                  placeholder="e.g. Delhi, Mumbai, California"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50"
                  required
                />
              </div>

              <div className="md:col-span-1">
                <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider block mb-1">
                  Expected Guests
                </label>
                <input 
                  type="number"
                  value={guestCount}
                  onChange={(e) => setGuestCount(parseInt(e.target.value) || 0)}
                  placeholder="e.g. 500"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50"
                  min={10}
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider block mb-1">
                  Event Description &amp; Venue Requirements
                </label>
                <input 
                  type="text"
                  value={userDescription}
                  onChange={(e) => setUserDescription(e.target.value)}
                  placeholder="e.g. Conference hall with stage, AV sound, parking, and catering..."
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Radio className={`w-3.5 h-3.5 text-emerald-400 ${isAiScouting ? 'animate-ping' : ''}`} />
                <span>Geospatial Radar: Connected (Global OpenStreetMap Network)</span>
              </div>

              <button
                type="submit"
                disabled={isAiScouting || !targetCity.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-50"
              >
                {isAiScouting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Scouting Live Map...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>AI Scout Best Venue</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Feedback message banner if venue locked */}
        {feedbackMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
            <button 
              onClick={() => setFeedbackMsg(null)}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="max-w-5xl mx-auto w-full space-y-8 pb-16">
        
        {/* Loading state */}
        {isAiScouting && (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-4 bg-[#0B0B0F] border border-white/10 rounded-2xl">
            <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
            <div>
              <h3 className="text-lg font-bold text-white">Scouting Live Geospatial Grid</h3>
              <p className="text-xs text-gray-400 font-mono mt-1">
                Searching real spaces in {targetCity} and calculating suitability for {guestCount} guests...
              </p>
            </div>
          </div>
        )}

        {/* AI Best Match Spotlight Card */}
        {!isAiScouting && recData?.best_venue && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-3xl p-1 bg-gradient-to-r from-emerald-500/40 via-purple-500/40 to-blue-500/40 shadow-[0_0_40px_rgba(168,85,247,0.15)]"
          >
            <div className="bg-[#0b0e17] rounded-[22px] p-6 md:p-8 flex flex-col md:flex-row gap-6 relative overflow-hidden">
              
              {/* Image & Match Percentage Badge */}
              <div className="md:w-5/12 h-64 md:h-auto min-h-[220px] rounded-2xl overflow-hidden relative border border-white/10 shrink-0">
                <img 
                  src={PLACEHOLDER_IMAGES[0]} 
                  alt={recData.best_venue.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-300">
                    AI Top Recommendation
                  </span>
                </div>

                <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span className="text-xs font-bold font-mono text-white">
                    {recData.best_venue.suitability_score}% Match
                  </span>
                </div>
              </div>

              {/* Details & Rationale */}
              <div className="flex-1 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-purple-400 mb-1">
                    <Building2 className="w-3.5 h-3.5" />
                    <span>{recData.best_venue.venue_type} • {recData.best_venue.city}</span>
                  </div>

                  <h2 className="text-2xl font-bold text-white mb-2 leading-tight">
                    {recData.best_venue.name}
                  </h2>

                  <p className="text-xs text-gray-400 font-mono mb-3">
                    📍 {recData.best_venue.address}
                  </p>

                  {/* AI Agent Rationale Box */}
                  <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/30 text-xs text-purple-200 leading-relaxed space-y-1 mb-4">
                    <div className="flex items-center gap-1.5 font-bold text-purple-300 text-[11px] uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>Why The AI Agent Chose This Venue</span>
                    </div>
                    <p className="text-gray-300 text-xs">
                      {recData.agent_summary}
                    </p>
                  </div>

                  {/* Operational Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <div className="text-[10px] uppercase font-mono text-gray-400">Capacity</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {recData.best_venue.capacity.toLocaleString()} Pax
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">
                        Fits {guestCount} Guests
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <div className="text-[10px] uppercase font-mono text-gray-400">Hourly Rate</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        ₹{recData.best_venue.hourly_rate || 300}/hr
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        Standard Commercial
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 col-span-2 sm:col-span-1">
                      <div className="text-[10px] uppercase font-mono text-gray-400">Suitability</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {recData.best_venue.suitability_score}% Optimal
                      </div>
                      <div className="text-[10px] text-purple-400 font-mono">
                        Rank #1 of {recData.total_scouted}
                      </div>
                    </div>
                  </div>

                  {/* Key Match Strengths (Pros) */}
                  {recData.best_venue.pros && recData.best_venue.pros.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-bold">
                        Key Strengths:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recData.best_venue.pros.map((p, idx) => (
                          <span 
                            key={idx}
                            className="text-[11px] font-mono px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          >
                            ✓ {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary Action Button */}
                <div className="pt-2 flex items-center justify-between gap-4">
                  <button
                    onClick={() => handleLockVenue(recData.best_venue!)}
                    disabled={lockingVenueId === recData.best_venue.id || lockedVenueId === recData.best_venue.id}
                    className={`flex-1 py-3 px-6 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                      lockedVenueId === recData.best_venue.id
                        ? 'bg-emerald-600 text-white cursor-default shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_25px_rgba(16,185,129,0.3)] hover:scale-[1.01]'
                    }`}
                  >
                    {lockingVenueId === recData.best_venue.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-black" />
                        <span>Locking to Event Matrix...</span>
                      </>
                    ) : lockedVenueId === recData.best_venue.id ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-white" />
                        <span>Locked as Event Venue</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 text-black" />
                        <span>Select &amp; Lock as Event Venue</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* All Scouted Candidates Section */}
        {!isAiScouting && candidates.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>Candidate Spaces in {targetCity}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                    {candidates.length} options scouted
                  </span>
                </h3>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-1.5">
                {(['All', 'Highest Match', 'Mega Capacity', 'Value'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSelectedFilter(f)}
                    className={`text-xs px-3 py-1 rounded-lg font-mono transition-colors ${
                      selectedFilter === f
                        ? 'bg-white/10 text-white border border-white/20'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of other venues */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {candidates.slice(1).map((v, idx) => {
                const img = PLACEHOLDER_IMAGES[(idx + 1) % PLACEHOLDER_IMAGES.length];
                const isLocked = lockedVenueId === v.id;

                return (
                  <motion.div
                    key={v.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`bg-[#0d1017] border rounded-2xl p-5 flex flex-col justify-between transition-all hover:border-purple-500/30 ${
                      isLocked ? 'border-emerald-500/50 bg-emerald-950/10' : 'border-white/10'
                    }`}
                  >
                    <div className="flex gap-4 mb-4">
                      <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 border border-white/10 relative">
                        <img src={img} alt={v.name} className="w-full h-full object-cover" />
                        <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1 rounded bg-black/80 text-white">
                          {v.suitability_score}%
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-400 mb-0.5">
                          <Building2 className="w-3 h-3" />
                          <span className="truncate">{v.venue_type}</span>
                        </div>
                        <h4 className="text-base font-bold text-white truncate" title={v.name}>
                          {v.name}
                        </h4>
                        <p className="text-xs text-gray-400 font-mono truncate mb-2">
                          📍 {v.address}
                        </p>

                        <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                          <span className="bg-white/5 px-2 py-0.5 rounded text-[11px]">
                            {v.capacity} Pax
                          </span>
                          <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[11px]">
                            ₹{v.hourly_rate || 250}/hr
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Reasons & Selection */}
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-gray-400 truncate flex-1">
                        {v.match_reasons?.[0] || `Suitable layout for ${v.capacity} guests`}
                      </div>

                      <button
                        onClick={() => handleLockVenue(v)}
                        disabled={lockingVenueId === v.id || isLocked}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                          isLocked 
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                            : 'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10'
                        }`}
                      >
                        {isLocked ? "✓ Selected" : "Select Space"}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
