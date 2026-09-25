"use client";

import React, { useState, useEffect } from "react";
import {
  FileText,
  Phone,
  Mail,
  MessageSquare,
  Users,
  DollarSign,
  Calendar,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Plus,
  Send,
  ShieldAlert,
} from "lucide-react";
import {
  recordVendorOutcome,
  getVendorOutcomes,
  VendorOutcomeItem,
  VendorOutcomePayload,
} from "../../lib/api/vendors";

interface VendorOutcomeSectionProps {
  eventId: string;
  providers: any[];
  tasks?: any[];
  currency?: string;
}

export function VendorOutcomeSection({
  eventId,
  providers,
  tasks = [],
  currency = "INR",
}: VendorOutcomeSectionProps) {
  const [outcomes, setOutcomes] = useState<VendorOutcomeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [channel, setChannel] = useState("PHONE");
  const [status, setStatus] = useState("QUOTE_RECEIVED");
  const [priceStr, setPriceStr] = useState("");
  const [availability, setAvailability] = useState("AVAILABLE");
  const [notes, setNotes] = useState("");

  const loadOutcomes = async () => {
    try {
      setLoading(true);
      const data = await getVendorOutcomes(eventId);
      setOutcomes(data || []);
    } catch (err: any) {
      console.error("Failed to load vendor outcomes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      loadOutcomes();
    }
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId) {
      setErrorMsg("Please select a vendor.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    let parsedPrice: number | null = null;
    if (priceStr.trim()) {
      const cleaned = priceStr.replace(/,/g, "").trim();
      const num = parseFloat(cleaned);
      if (isNaN(num) || num < 0) {
        setErrorMsg("Quoted price must be a valid non-negative number.");
        setSubmitting(false);
        return;
      }
      parsedPrice = num;
    }

    const payload: VendorOutcomePayload = {
      provider_id: selectedProviderId,
      task_id: selectedTaskId || null,
      communication_channel: channel,
      outcome_status: status,
      quoted_price: parsedPrice,
      currency: currency || "INR",
      reported_availability: availability,
      organizer_notes: notes.trim() || null,
    };

    try {
      await recordVendorOutcome(eventId, payload);
      setSuccessMsg("Outcome recorded successfully. Marked as UNVERIFIED pending Task 7 validation.");
      // Reset form
      setNotes("");
      setPriceStr("");
      setShowForm(false);
      await loadOutcomes();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to record vendor outcome.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Scope Boundary Notification Banner */}
      <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 flex items-start space-x-3 text-amber-200 text-xs">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-300">
            ORGANIZER REPORTED OUTCOMES — PENDING TASK 7 VALIDATION
          </p>
          <p className="text-amber-200/80 leading-relaxed">
            Record the outcome of phone calls, emails, WhatsApp messages, or meetings you conducted outside EVENTRA.
            All submitted facts are strictly stored as <strong className="text-amber-300">UNVERIFIED</strong>.
            Recording an outcome does <em>not</em> confirm a booking, assign a provider to a task, or recalculate the event plan.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-950/60 border border-emerald-700 p-3 rounded-lg text-emerald-300 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-950/60 border border-red-800 p-3 rounded-lg text-red-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Header and Toggle Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            <span>External Vendor Interaction Outcomes</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Historical outcomes reported by organizers after contacting shortlisted vendors.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showForm ? "Cancel" : "Record Vendor Outcome"}</span>
        </button>
      </div>

      {/* Record Outcome Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl"
        >
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 tracking-wide uppercase">
              Submit New Vendor Interaction Outcome
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 border border-amber-800 text-amber-300">
              STATUS: UNVERIFIED
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Vendor Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Vendor / Provider <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="">-- Select Contacted Vendor --</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category || "Vendor"} • {p.city || "Location"})
                  </option>
                ))}
              </select>
            </div>

            {/* Optional Task Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Associated Event Task (Optional)
              </label>
              <select
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="">-- General / No Specific Task --</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.required_provider_category || t.phase || "Task"})
                  </option>
                ))}
              </select>
            </div>

            {/* Communication Channel */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Communication Channel
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="PHONE">Phone Call</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP_EXTERNAL">WhatsApp (External)</option>
                <option value="IN_PERSON">In-Person Meeting</option>
                <option value="OTHER">Other Channel</option>
              </select>
            </div>

            {/* Outcome Status */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reported Outcome Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="QUOTE_RECEIVED">Quote Received</option>
                <option value="AVAILABLE">Reported Available</option>
                <option value="UNAVAILABLE">Reported Unavailable</option>
                <option value="INTERESTED">Interested / In Discussions</option>
                <option value="ACCEPTED">Vendor Accepted (Reported)</option>
                <option value="DECLINED">Vendor Declined</option>
                <option value="NO_RESPONSE">No Response</option>
                <option value="CONTACTED">Contacted (Awaiting Details)</option>
              </select>
            </div>

            {/* Quoted Price */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Quoted Price ({currency || "INR"})
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. 380000 or 3.8 lakh"
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 pl-8"
                />
                <DollarSign className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Leave blank if no price was quoted.</p>
            </div>

            {/* Reported Availability */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reported Availability
              </label>
              <select
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="AVAILABLE">Available on Requested Dates</option>
                <option value="UNAVAILABLE">Unavailable / Booked Out</option>
                <option value="CONDITIONAL">Conditional / Tentative Hold</option>
                <option value="UNKNOWN">Unknown / Not Discussed</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Organizer Notes & Context
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Vendor said they can do 600 guests vegetarian for ₹3.8 lakh. Can hold the date until Friday."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? "Saving..." : "Record Outcome"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Historical List */}
      {loading ? (
        <div className="text-center py-10 text-slate-500 text-xs">
          Loading recorded outcomes...
        </div>
      ) : outcomes.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-8 text-center space-y-2">
          <FileText className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-xs font-semibold text-slate-300">No external outcomes recorded yet.</p>
          <p className="text-[11px] text-slate-500 max-w-md mx-auto">
            When you contact shortlisted vendors by phone, WhatsApp, or email outside EVENTRA,
            record their response here for Task 7 validation.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {outcomes.map((item) => (
            <div
              key={item.id}
              className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-slate-700 transition"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2.5">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-200 text-xs">
                    {item.provider_name || item.provider_id}
                  </span>
                  {item.task_name && (
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded">
                      Task: {item.task_name}
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/80 text-cyan-300">
                    {item.source}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/80 text-amber-300">
                    {item.verification_status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Channel</span>
                  <span className="font-medium text-slate-300">{item.communication_channel}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Outcome Status</span>
                  <span className="font-semibold text-cyan-300">{item.outcome_status}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Reported Availability</span>
                  <span
                    className={`font-semibold ${
                      item.reported_availability === "AVAILABLE"
                        ? "text-emerald-400"
                        : item.reported_availability === "UNAVAILABLE"
                        ? "text-red-400"
                        : "text-amber-400"
                    }`}
                  >
                    {item.reported_availability}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Quoted Price</span>
                  <span className="font-mono font-medium text-slate-200">
                    {item.quoted_price !== null && item.quoted_price !== undefined
                      ? `₹${item.quoted_price.toLocaleString()}`
                      : "UNKNOWN / NOT QUOTED"}
                  </span>
                </div>
              </div>

              {item.organizer_notes && (
                <div className="bg-slate-950/60 rounded-lg p-2.5 text-xs text-slate-300 border border-slate-800/60 italic">
                  "{item.organizer_notes}"
                </div>
              )}

              <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
                <span>Recorded: {new Date(item.created_at).toLocaleString()}</span>
                <span className="text-slate-600 font-mono">ID: {item.id.slice(0, 8)}...</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
