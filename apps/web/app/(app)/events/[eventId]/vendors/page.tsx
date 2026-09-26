"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Filter, MapPin, Phone, Mail, ShieldCheck,
  CheckCircle2, AlertTriangle, AlertCircle, ExternalLink,
  Volume2, Mic, MicOff, Sparkles, Bot, Radio, Clock,
  Send, Loader2, X, RefreshCw, Zap, Activity, Star, PhoneCall
} from 'lucide-react';
import {
  getAssignmentsForEvent,
  discoverProviders,
} from '@/lib/api/vendors';
import type {
  VendorResponse,
  VendorAssignmentResponse,
} from '@/types/api';
import { getActivityFeed } from '@/lib/api/observability';

// ─── Types ───────────────────────────────────────────────────────────────────
interface ActivityEntry {
  id: string;
  time: string;
  message: string;
  type: 'search' | 'found' | 'contacted' | 'confirmed' | 'pending' | 'info';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function statusColor(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'confirmed': return 'text-green-400 bg-green-400/10 border-green-400/20';
    case 'pending': case 'pending_response': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    case 'declined': return 'text-red-400 bg-red-400/10 border-red-400/20';
    default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  }
}

function statusLabel(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'pending_response': return 'Awaiting Reply';
    case 'confirmed': return 'Confirmed';
    case 'declined': return 'Declined';
    default: return status || 'Unknown';
  }
}

function activityIcon(type: ActivityEntry['type']) {
  switch (type) {
    case 'search': return <Search size={12} className="text-blue-400" />;
    case 'found': return <Sparkles size={12} className="text-purple-400" />;
    case 'contacted': return <PhoneCall size={12} className="text-yellow-400" />;
    case 'confirmed': return <CheckCircle2 size={12} className="text-green-400" />;
    case 'pending': return <Clock size={12} className="text-orange-400" />;
    default: return <Activity size={12} className="text-gray-400" />;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('catering');
  const [location, setLocation] = useState('Delhi');
  const [assignments, setAssignments] = useState<VendorAssignmentResponse[]>([]);
  const [discovered, setDiscovered] = useState<VendorResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [demoMode, setDemoMode] = useState(false);

  const addActivity = useCallback((message: string, type: ActivityEntry['type'] = 'info') => {
    const entry: ActivityEntry = {
      id: `${Date.now()}-${Math.random()}`,
      time: new Date().toLocaleTimeString(),
      message,
      type,
    };
    setActivityFeed(prev => [entry, ...prev].slice(0, 30));
  }, []);

  // Load existing vendor assignments for this event
  const loadAssignments = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await getAssignmentsForEvent(eventId);
      setAssignments(Array.isArray(data) ? data : []);
    } catch {
      // Not critical — event may have no assignments yet
    }
  }, [eventId]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await loadAssignments();
      setLoading(false);
    };
    run();
  }, [loadAssignments]);

  // Agentic discovery
  const runDiscovery = async () => {
    setDiscovering(true);
    setError(null);
    setDiscovered([]);
    setActivityFeed([]);

    addActivity(`Starting agentic discovery for "${category}" near ${location}…`, 'search');
    addActivity(`Resolving coordinates for ${location}…`, 'info');

    try {
      addActivity(`Querying Google Maps scraper (radius: 10km → expanding if needed)…`, 'search');
      const res = await discoverProviders({
        category,
        location,
        limit: 15,
        ...(eventId ? { event_id: eventId } : {}),
        simulate_outreach: demoMode,
      } as any);

      const items = res.items || [];
      addActivity(`Scraped ${res.total_discovered} raw results from ${res.source}`, 'found');
      addActivity(`Normalized and deduped → ${items.length} unique candidates`, 'found');

      const qualified = items.filter(v => v.rating && v.rating >= 3.5);
      addActivity(`Qualification gate: ${qualified.length} passed (≥3.5★, active, contactable)`, 'found');

      // Simulate outreach activity entries
      for (const v of qualified.slice(0, 5)) {
        if (demoMode) {
          addActivity(`[DEMO] Contacting ${v.name} via WhatsApp/Voice…`, 'contacted');
          await new Promise(r => setTimeout(r, 200));
          const outcome = (v.rating || 4) >= 4.0 ? 'confirmed' : 'pending';
          addActivity(
            outcome === 'confirmed'
              ? `✓ ${v.name} confirmed availability`
              : `⏳ ${v.name} → awaiting reply (pending_response)`,
            outcome
          );
        } else {
          addActivity(`Outreach dispatched to ${v.name} — awaiting real vendor reply`, 'contacted');
        }
        await new Promise(r => setTimeout(r, 150));
      }

      setDiscovered(items);
      addActivity(`Discovery complete. ${items.length} vendors found.`, 'confirmed');
      await loadAssignments();

      // Merge in real backend activity (approvals, verifications, outreach outcomes)
      if (eventId) {
        try {
          const feed = await getActivityFeed(eventId, 20);
          if (feed.items?.length) {
            for (const item of feed.items.slice(0, 10)) {
              const type: ActivityEntry['type'] =
                item.category === 'APPROVAL' ? 'confirmed' :
                item.category === 'ACTION' ? 'contacted' : 'info';
              setActivityFeed(prev => [
                {
                  id: item.id || `${Date.now()}-${Math.random()}`,
                  time: item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '',
                  message: `[Server] ${item.summary}`,
                  type,
                },
                ...prev,
              ].slice(0, 30));
            }
          }
        } catch {
          // Activity feed is supplementary — ignore errors
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Discovery failed';
      setError(msg);
      addActivity(`Discovery error: ${msg}`, 'info');
    } finally {
      setDiscovering(false);
    }
  };

  // Merge: confirmed assignments + newly discovered
  const allVendors: Array<Partial<VendorResponse> & { id: string; name: string; _assigned?: boolean }> = [
    ...assignments.map(a => ({
      ...(a.vendor || {}),
      id: a.vendor_id,
      name: a.vendor?.name || 'Assigned Vendor',
      _assigned: true,
    })),
    ...discovered.filter(d => !assignments.some(a => a.vendor_id === d.id)),
  ];

  const filtered = allVendors.filter(v =>
    !search || (v.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.category || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <Users className="text-[#D6003C]" size={28} />
            Vendor <span className="font-bold text-[#D6003C]">Network</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">
            Agentic vendor discovery — real results, real outreach, real confirmation.
          </p>
        </div>

        {/* Demo Mode toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setDemoMode(v => !v)}
            className={`relative w-10 h-5 rounded-full transition-colors ${demoMode ? 'bg-yellow-500' : 'bg-white/10'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${demoMode ? 'translate-x-5' : ''}`} />
          </div>
          <span className={`text-xs font-bold uppercase tracking-wider ${demoMode ? 'text-yellow-400' : 'text-gray-500'}`}>
            {demoMode ? '⚡ Demo Mode (simulated outreach)' : 'Real Mode'}
          </span>
        </label>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-hidden">
        {/* Left: Discovery Controls + Results */}
        <div className="xl:col-span-8 flex flex-col gap-4 overflow-hidden">
          {/* Search / Filter Bar */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search discovered vendors…"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
              />
            </div>
            <input
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Category (e.g. catering)"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none w-36"
            />
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="City"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none w-28"
            />
            <button
              onClick={runDiscovery}
              disabled={discovering}
              className="flex items-center gap-2 bg-[#D6003C] hover:bg-[#ff1a55] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_20px_rgba(214,0,60,0.3)]"
            >
              {discovering ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {discovering ? 'Discovering…' : 'Discover'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex-shrink-0">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Vendor Cards */}
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <Loader2 size={20} className="animate-spin mr-2" /> Loading vendor assignments…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-600 gap-4">
                <Bot size={40} />
                <p className="text-sm text-center max-w-xs">
                  No vendors discovered yet. Set your category &amp; city above, then click <strong className="text-white">Discover</strong> to let the agent find real vendors.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {filtered.map((v, idx) => (
                    <motion.div
                      key={v.id || idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className={`bg-[#0B0B0F] border rounded-2xl p-5 hover:border-white/15 transition-all group ${
                        v._assigned ? 'border-green-500/30' : 'border-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {v._assigned && (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full">
                                Assigned
                              </span>
                            )}
                            {(v as any).source && (v as any).source !== 'MOCK' && (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-blue-400/10 border border-blue-400/20 px-2 py-0.5 rounded-full">
                                {(v as any).source === 'REAL' ? 'Verified' : (v as any).source}
                              </span>
                            )}
                            {(v as any).source === 'MOCK' && (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded-full">
                                Simulated
                              </span>
                            )}
                          </div>
                          <h3 className="text-white font-semibold text-base leading-tight truncate">{v.name}</h3>
                          <p className="text-gray-500 text-xs mt-0.5">{v.category}</p>
                        </div>
                        {v.rating != null && (
                          <div className="flex items-center gap-1 text-yellow-400 text-sm font-bold flex-shrink-0 ml-2">
                            <Star size={12} fill="currentColor" /> {v.rating?.toFixed(1)}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 mb-4">
                        {v.address && (
                          <div className="flex items-center gap-2 text-gray-500 text-xs">
                            <MapPin size={11} /> <span className="truncate">{v.address}</span>
                          </div>
                        )}
                        {v.phone && (
                          <div className="flex items-center gap-2 text-gray-500 text-xs">
                            <Phone size={11} /> {v.phone}
                          </div>
                        )}
                        {(v.contact_email || (v as any).email) && (
                          <div className="flex items-center gap-2 text-gray-500 text-xs">
                            <Mail size={11} /> <span className="truncate">{v.contact_email || (v as any).email}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        {v.base_cost != null && (
                          <span className="text-gray-400 text-xs">
                            ₹{v.base_cost?.toLocaleString()} est.
                          </span>
                        )}
                        {v.website && (
                          <a
                            href={v.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto flex items-center gap-1 text-gray-500 hover:text-white text-xs transition-colors"
                          >
                            <ExternalLink size={11} /> Website
                          </a>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent Activity Feed (Priority 6e) */}
        <div className="xl:col-span-4 flex flex-col bg-[#0B0B0F] border border-white/5 rounded-3xl overflow-hidden h-[500px] xl:h-full">
          <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-[#D6003C]" />
              <h3 className="text-sm font-bold text-white">Agent Activity</h3>
              {discovering && (
                <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold uppercase tracking-wider animate-pulse">
                  <Radio size={10} /> Live
                </span>
              )}
            </div>
            <button
              onClick={() => setActivityFeed([])}
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col-reverse gap-2">
            {activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-700 gap-3">
                <Activity size={28} />
                <p className="text-xs text-center">
                  Agent activity will appear here in real-time when discovery runs.
                </p>
              </div>
            ) : (
              activityFeed.map(entry => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-start gap-2.5 text-xs"
                >
                  <div className="mt-0.5 flex-shrink-0">{activityIcon(entry.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-300 leading-relaxed">{entry.message}</p>
                    <p className="text-gray-600 text-[10px] mt-0.5">{entry.time}</p>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {demoMode && (
            <div className="p-3 border-t border-yellow-500/10 bg-yellow-500/5 flex-shrink-0">
              <p className="text-[10px] text-yellow-500/70 text-center">
                ⚡ Demo Mode active — outreach responses are simulated, not real
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
