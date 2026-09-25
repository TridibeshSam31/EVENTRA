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
  Loader2,
  Check,
  Layers,
  ArrowRight,
} from "lucide-react";
import {
  recordVendorOutcome,
  getVendorOutcomes,
  validateVendorOutcome,
  getVendorOutcomeValidation,
  bindVendorToTask,
  VendorOutcomeItem,
  VendorOutcomePayload,
  VendorOutcomeValidation,
  VendorTaskBindingResponse,
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

  // Validation State (Task 7)
  const [validations, setValidations] = useState<Record<string, VendorOutcomeValidation>>({});
  const [validatingId, setValidatingId] = useState<string | null>(null);

  // Binding State (Task 8)
  const [bindingResponses, setBindingResponses] = useState<Record<string, VendorTaskBindingResponse>>({});
  const [bindingLoadingId, setBindingLoadingId] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<Record<string, string>>({});

  const loadOutcomes = async () => {
    try {
      setLoading(true);
      const data = await getVendorOutcomes(eventId);
      setOutcomes(data || []);

      // Load existing validation records
      if (data && data.length > 0) {
        for (const item of data) {
          if (item.verification_status && item.verification_status !== "UNVERIFIED") {
            try {
              const val = await getVendorOutcomeValidation(eventId, item.id);
              if (val) {
                setValidations((prev) => ({ ...prev, [item.id]: val }));
              }
            } catch {
              // Silently ignore if not yet available
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to load vendor outcomes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async (outcomeId: string) => {
    try {
      setValidatingId(outcomeId);
      setErrorMsg(null);
      const val = await validateVendorOutcome(eventId, outcomeId);
      setValidations((prev) => ({ ...prev, [outcomeId]: val }));
      setSuccessMsg(`Outcome successfully evaluated. Overall: ${val.overall_status}`);
      await loadOutcomes();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to validate vendor outcome.");
    } finally {
      setValidatingId(null);
    }
  };

  const handleBindVendor = async (item: VendorOutcomeItem) => {
    if (!item.task_id) {
      setErrorMsg("Cannot bind vendor: no associated task ID found on this outcome.");
      return;
    }

    try {
      setBindingLoadingId(item.id);
      setBindingError((prev) => ({ ...prev, [item.id]: "" }));
      setErrorMsg(null);

      const valRecord = validations[item.id];
      const res = await bindVendorToTask(eventId, item.task_id, {
        event_id: eventId,
        task_id: item.task_id,
        provider_id: item.provider_id,
        validation_id: valRecord ? valRecord.id : undefined,
      });

      setBindingResponses((prev) => ({ ...prev, [item.id]: res }));

      if (res.binding_status === "BOUND" || res.binding_status === "ALREADY_BOUND") {
        setSuccessMsg(
          `Vendor bound to task! Plan recalculated to v${res.plan_version_after || 2}. CPM critical path duration: ${res.plan_recalculation?.total_duration_minutes || 0}m.`
        );
      } else {
        setBindingError((prev) => ({
          ...prev,
          [item.id]: res.decision?.reason || "Binding was blocked by deterministic feasibility check.",
        }));
      }
      await loadOutcomes();
    } catch (err: any) {
      setBindingError((prev) => ({
        ...prev,
        [item.id]: err.message || "Failed to bind vendor to task.",
      }));
    } finally {
      setBindingLoadingId(null);
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

              {/* Task 7: Deterministic Claims & Validation Results */}
              {validations[item.id] ? (
                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-3 mt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-slate-300">Deterministic Evaluation:</span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                          validations[item.id].overall_status === "VALIDATED"
                            ? "bg-emerald-950/70 border-emerald-700 text-emerald-300"
                            : validations[item.id].overall_status === "PARTIALLY_VALIDATED"
                            ? "bg-blue-950/70 border-blue-700 text-blue-300"
                            : validations[item.id].overall_status === "CONFLICT"
                            ? "bg-amber-950/70 border-amber-700 text-amber-300"
                            : "bg-red-950/70 border-red-700 text-red-300"
                        }`}
                      >
                        {validations[item.id].overall_status}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleValidate(item.id)}
                      disabled={validatingId === item.id}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
                    >
                      {validatingId === item.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Re-evaluating...</span>
                        </>
                      ) : (
                        <span>Re-evaluate</span>
                      )}
                    </button>
                  </div>

                  {validations[item.id].summary && (
                    <p className="text-[11px] text-slate-400">
                      {validations[item.id].summary}
                    </p>
                  )}

                  {/* Individual Claims Breakdown */}
                  {validations[item.id].claim_results && validations[item.id].claim_results.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                      {validations[item.id].claim_results.map((claim, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded-md border text-[11px] space-y-1 ${
                            claim.status === "PASS"
                              ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-200"
                              : claim.status === "FAIL"
                              ? "bg-red-950/20 border-red-800/40 text-red-200"
                              : claim.status === "CONFLICT"
                              ? "bg-amber-950/20 border-amber-800/40 text-amber-200"
                              : "bg-slate-900 border-slate-800 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400">
                              {claim.field || claim.claim_type}
                            </span>
                            <span
                              className={`flex items-center space-x-1 text-[10px] font-bold ${
                                claim.status === "PASS"
                                  ? "text-emerald-400"
                                  : claim.status === "FAIL"
                                  ? "text-red-400"
                                  : claim.status === "CONFLICT"
                                  ? "text-amber-400"
                                  : "text-slate-400"
                              }`}
                            >
                              {claim.status === "PASS" && <CheckCircle2 className="w-3 h-3" />}
                              {claim.status === "FAIL" && <XCircle className="w-3 h-3" />}
                              {claim.status === "CONFLICT" && <AlertCircle className="w-3 h-3" />}
                              {claim.status === "UNKNOWN" && <HelpCircle className="w-3 h-3" />}
                              <span>{claim.status}</span>
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 leading-tight">
                            {claim.explanation}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Task 8: Vendor -> Task Binding & Recalculation Card */}
                  {bindingResponses[item.id]?.binding_status === "BOUND" || bindingResponses[item.id]?.binding_status === "ALREADY_BOUND" ? (
                    <div className="bg-emerald-950/40 border border-emerald-700/60 rounded-lg p-3 space-y-2 mt-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 font-bold text-[10px] rounded uppercase tracking-wider">
                            ASSIGNED (TASK 8)
                          </span>
                          <span className="text-xs font-semibold text-emerald-200">
                            Vendor Bound to Task
                          </span>
                        </div>
                        <span className="text-[11px] font-mono font-bold text-cyan-300">
                          Plan v{bindingResponses[item.id]?.plan_version_after || "2"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300 pt-1 border-t border-emerald-900/50">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Critical Path:</span>
                          <span className="font-semibold text-slate-200">
                            {bindingResponses[item.id]?.plan_recalculation?.task_is_critical_path ? "YES (Critical)" : "Standard"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Total CPM Duration:</span>
                          <span className="font-semibold text-slate-200">
                            {bindingResponses[item.id]?.plan_recalculation?.total_duration_minutes || 0} mins
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">DAG Status:</span>
                          <span className="font-semibold text-emerald-400">Strictly Acyclic</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Budget Committed:</span>
                          <span className="font-semibold text-cyan-300">
                            {bindingResponses[item.id]?.plan_recalculation?.budget_committed_amount
                              ? `₹${bindingResponses[item.id]?.plan_recalculation?.budget_committed_amount?.toLocaleString()}`
                              : "Committed"}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 italic">
                        {bindingResponses[item.id]?.message}
                      </p>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-slate-900 flex flex-col space-y-2 mt-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-slate-400">
                          {item.task_id ? (
                            <span>
                              Assign to task: <strong className="text-slate-200">{item.task_name || item.task_id}</strong>
                            </span>
                          ) : (
                            <span className="text-amber-400 text-[10px]">
                              No task selected for this outcome
                            </span>
                          )}
                        </div>
                        {item.task_id && (
                          <button
                            type="button"
                            onClick={() => handleBindVendor(item)}
                            disabled={bindingLoadingId === item.id}
                            className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition disabled:opacity-50"
                          >
                            {bindingLoadingId === item.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Evaluating & Binding...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Assign Vendor to Task</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      {bindingError[item.id] && (
                        <div className="bg-red-950/40 border border-red-800/60 p-2 rounded text-red-200 text-[11px] space-y-1">
                          <div className="font-semibold flex items-center space-x-1 text-red-400">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Binding Blocked:</span>
                          </div>
                          <p className="text-[10px] text-red-300">{bindingError[item.id]}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                  <span className="text-[11px] text-slate-400">
                    Awaiting deterministic claims parsing & validation.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleValidate(item.id)}
                    disabled={validatingId === item.id}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50"
                  >
                    {validatingId === item.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Validating...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Validate Claims</span>
                      </>
                    )}
                  </button>
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
