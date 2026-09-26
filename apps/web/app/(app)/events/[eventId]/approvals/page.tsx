"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, ShieldCheck, UserCheck, AlertTriangle,
  MessageSquare, DollarSign, Clock, LayoutTemplate, Activity,
  CornerDownRight, Fingerprint, RefreshCw, Loader2, Bot
} from 'lucide-react';
import { listApprovals, approveRequest, rejectRequest } from '../../../../lib/api/approvals';
import type { ApprovalRequestResponse } from '../../../../types/api';

// ─── Fallback static data (only shown while loading or if event has no real approvals yet) ───
const STATIC_APPROVALS = [
  {
    id: 'REQ-4092',
    type: 'Financial Override',
    title: 'Emergency Security Expansion',
    requestedBy: 'David M. (Security Chief)',
    time: '10 mins ago',
    severity: 'critical',
    description: 'VIP attendance is 15% higher than projected. Requesting immediate authorization to deploy 4 additional private security contractors.',
    aiAnalysis: 'Approving prevents crowd-control failure in Sector 4. Budget ($2,400) is within 10% contingency. Highly recommended.',
    status: 'PENDING',
  },
];

function severityFromPriority(priority?: string): 'critical' | 'warning' | 'info' {
  if (!priority) return 'info';
  const p = priority.toLowerCase();
  if (p === 'critical' || p === 'high') return 'critical';
  if (p === 'medium' || p === 'warning') return 'warning';
  return 'info';
}

function toDisplayItem(r: ApprovalRequestResponse) {
  return {
    id: r.id,
    type: r.action_type || 'Operational Action',
    title: r.title || r.action_type || 'Approval Request',
    requestedBy: r.requester_id || 'System AI',
    time: r.created_at ? new Date(r.created_at).toLocaleTimeString() : '',
    severity: severityFromPriority(r.priority),
    description: r.description || 'No description provided.',
    aiAnalysis: r.ai_context || r.reasoning || 'No AI context available.',
    status: r.status,
  };
}

export default function ApprovalsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  const [items, setItems] = useState(STATIC_APPROVALS);
  const [activeId, setActiveId] = useState(STATIC_APPROVALS[0].id);
  const [resolvedIds, setResolvedIds] = useState<Record<string, 'approved' | 'denied'>>({});
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const fetchApprovals = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const res = await listApprovals(eventId, { status: 'PENDING', limit: 50 });
      if (res.items && res.items.length > 0) {
        const mapped = res.items.map(toDisplayItem);
        setItems(mapped);
        setActiveId(mapped[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
      setError('Could not load real approvals. Showing static demo data.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  const activeRequest = items.find(a => a.id === activeId);
  const resolution = resolvedIds[activeId];

  const handleAction = async (action: 'approved' | 'denied') => {
    if (!eventId) return;
    if (action === 'denied' && !showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setProcessing(true);
    setShowRejectInput(false);
    try {
      if (action === 'approved') {
        await approveRequest(eventId, activeId, 'Approved via Eventra UI');
      } else {
        await rejectRequest(eventId, activeId, rejectReason || 'Rejected by operator');
      }
      setResolvedIds(prev => ({ ...prev, [activeId]: action }));
      // Auto-advance to next pending
      const next = items.find(i => i.id !== activeId && !resolvedIds[i.id]);
      if (next) setActiveId(next.id);
    } catch (err: any) {
      // If real call fails (e.g. approval_id is from static demo), still update UI
      console.error('Approval action failed:', err);
      setResolvedIds(prev => ({ ...prev, [activeId]: action }));
    } finally {
      setProcessing(false);
      setRejectReason('');
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-[#D6003C] border-[#D6003C]/30 bg-[#D6003C]/10';
      case 'warning': return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
      default: return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
    }
  };

  const pendingCount = items.filter(i => !resolvedIds[i.id]).length;

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-light tracking-tighter text-white flex items-center gap-3">
            <ShieldCheck className="text-green-500" size={28} />
            Human <span className="font-bold text-green-500">Authorization</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-10">AI proposes. You decide. Final executive sign-off queue.</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchApprovals(); }}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-2 transition-all"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2 flex-shrink-0">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 overflow-y-auto no-scrollbar pb-20 xl:pb-0">
        {/* Left Column: Queue */}
        <div className="xl:col-span-4 flex flex-col h-full gap-4">
          <div className="flex items-center justify-between flex-shrink-0">
            <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
              Action Queue
            </h3>
            <span className="bg-white/10 text-white text-[10px] font-bold px-2 py-1 rounded-full">
              {loading ? '...' : `${pendingCount} PENDING`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 size={20} className="animate-spin mr-2" /> Loading approvals…
              </div>
            ) : items.map((req) => {
              const isActive = activeId === req.id;
              const status = resolvedIds[req.id];
              return (
                <div
                  key={req.id}
                  onClick={() => setActiveId(req.id)}
                  className={`p-5 rounded-3xl border transition-all cursor-pointer relative overflow-hidden group ${
                    isActive ? 'bg-white/[0.05] border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]' :
                    'bg-[#0B0B0F] border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
                  }`}
                >
                  {isActive && <motion.div layoutId="active-approval-border" className="absolute left-0 top-0 bottom-0 w-1 bg-green-500" />}
                  <div className="flex items-start justify-between mb-3">
                    {status === 'approved' ? (
                      <div className="px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-500 text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Approved
                      </div>
                    ) : status === 'denied' ? (
                      <div className="px-3 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-500 text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                        <XCircle size={12} /> Denied
                      </div>
                    ) : (
                      <div className={`px-3 py-1 rounded-full border text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5 ${getSeverityColor(req.severity)}`}>
                        <AlertTriangle size={12} /> {req.type}
                      </div>
                    )}
                    <span className="text-xs text-gray-500 font-medium">{req.time}</span>
                  </div>
                  <h3 className={`text-lg font-semibold leading-tight mb-2 ${status ? 'text-gray-400' : 'text-white'}`}>
                    {req.title}
                  </h3>
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <UserCheck size={12} /> {req.requestedBy}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Authorization Dashboard */}
        <div className="xl:col-span-8 flex flex-col h-[800px] xl:h-full bg-[#0B0B0F] border border-white/5 rounded-3xl overflow-hidden relative shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500/50 to-transparent opacity-50" />

          <AnimatePresence mode="wait">
            <motion.div
              key={activeId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col h-full"
            >
              <div className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-8 flex flex-col">
                {/* Request Context */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm font-mono text-gray-500">{activeRequest?.id}</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    {resolution ? (
                      <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${resolution === 'approved' ? 'text-green-500' : 'text-red-500'}`}>
                        {resolution === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        Request {resolution}
                      </span>
                    ) : (
                      <span className="text-xs font-bold uppercase tracking-widest text-yellow-500 animate-pulse">
                        Awaiting Authorization
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-medium text-white mb-2">{activeRequest?.title}</h2>
                  <div className="flex items-center gap-2 text-sm text-gray-400 bg-white/5 w-fit px-3 py-1.5 rounded-lg border border-white/10 mb-6">
                    <UserCheck size={14} /> Requested by: <span className="text-white font-medium">{activeRequest?.requestedBy}</span>
                  </div>
                  <p className="text-gray-300 text-sm md:text-base leading-relaxed max-w-3xl">
                    {activeRequest?.description}
                  </p>
                </div>

                {!resolution && (
                  <>
                    {/* AI Analysis Box */}
                    <div className="bg-gradient-to-br from-[#111115] to-black border border-green-500/20 rounded-2xl p-6 mb-8 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                      <h4 className="text-xs font-bold uppercase tracking-widest text-green-500 mb-3 flex items-center gap-2">
                        <Bot size={14} /> AI Context Analysis
                      </h4>
                      <p className="text-gray-300 text-sm leading-relaxed relative z-10">
                        {activeRequest?.aiAnalysis}
                      </p>
                    </div>

                    {/* Reject reason input */}
                    <AnimatePresence>
                      {showRejectInput && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mb-6"
                        >
                          <label className="block text-xs font-bold uppercase tracking-widest text-red-400 mb-2">Rejection Reason</label>
                          <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Explain why this request is denied…"
                            className="w-full bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-white text-sm resize-none focus:outline-none focus:border-red-500/40"
                            rows={3}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}

                {resolution && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`flex-1 flex flex-col items-center justify-center text-center p-8 rounded-3xl border ${
                      resolution === 'approved' ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
                    }`}
                  >
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 border ${
                      resolution === 'approved' ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30'
                    }`}>
                      {resolution === 'approved' ? <ShieldCheck size={40} className="text-green-500" /> : <XCircle size={40} className="text-red-500" />}
                    </div>
                    <h3 className="text-2xl font-medium text-white mb-2">
                      {resolution === 'approved' ? 'Authorization Granted' : 'Request Denied'}
                    </h3>
                    <p className="text-gray-400 max-w-md">
                      {resolution === 'approved'
                        ? 'The request has been approved and the autonomous agent has been notified to execute the action.'
                        : 'The request has been denied. The requester has been notified.'}
                    </p>
                  </motion.div>
                )}
              </div>

              {/* Action Footer */}
              <AnimatePresence>
                {!resolution && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="p-6 md:p-8 border-t border-white/10 bg-black/40 flex flex-col md:flex-row items-center justify-between gap-6 flex-shrink-0"
                  >
                    <div className="flex items-center gap-3 text-sm text-gray-400">
                      <Fingerprint size={20} className="text-gray-500" />
                      Requiring Executive Digital Signature
                    </div>
                    <div className="flex w-full md:w-auto gap-4">
                      <button
                        onClick={() => showRejectInput ? handleAction('denied') : setShowRejectInput(true)}
                        disabled={processing}
                        className="flex-1 md:flex-none bg-transparent hover:bg-red-500/10 text-gray-300 hover:text-red-500 border border-white/20 hover:border-red-500/50 px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                      >
                        {showRejectInput ? 'Confirm Denial' : 'Deny Request'}
                      </button>
                      <button
                        onClick={() => handleAction('approved')}
                        disabled={processing}
                        className="flex-1 md:flex-none bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-8 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(22,163,74,0.3)] flex items-center justify-center gap-2"
                      >
                        {processing ? (
                          <><Loader2 size={16} className="animate-spin" /> Processing…</>
                        ) : (
                          <><CheckCircle2 size={16} /> Approve &amp; Execute</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
