"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  ArrowRight,
  ArrowLeft,
  Calendar,
  Users,
  MapPin,
  AlignLeft,
  DollarSign,
  ShieldCheck,
  PlusCircle,
  Loader2,
  AlertCircle,
  Sparkles,
  Mic,
} from "lucide-react";
import { createEvent } from "@/lib/api/events";
import { setActiveEventId } from "@/stores/eventStore";
import { VoiceIntakePanel } from "@/features/event-creation/VoiceIntakePanel";

export default function NewEventPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isDeploying, setIsDeploying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    start_datetime: "",
    end_datetime: "",
    location: "",
    guest_count: "",
    event_type: "conference",
    total_budget: "",
    currency: "INR",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    setErrorMsg("");

    try {
      const created = await createEvent({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        event_type: formData.event_type.toUpperCase(),
        location: formData.location.trim() || undefined,
        start_datetime: formData.start_datetime ? new Date(formData.start_datetime).toISOString() : null,
        end_datetime: formData.end_datetime ? new Date(formData.end_datetime).toISOString() : null,
        guest_count: parseInt(formData.guest_count || "0", 10),
        state: "NORMAL",
        total_budget: parseFloat(formData.total_budget || "0"),
        currency: formData.currency,
        owner_id: "default-operator",
      });

      if (created?.id) {
        setActiveEventId(created.id);
        router.push(`/events/${created.id}`);
      } else {
        router.push("/events");
      }
    } catch (err: any) {
      console.error("Failed to create event:", err);
      setErrorMsg(err.message || "Failed to initialize event. Please check inputs.");
      setIsDeploying(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {isVoiceMode ? (
        <VoiceIntakePanel
          onCancel={() => setIsVoiceMode(false)}
          onFillFormWithValues={(prefilled) => {
            setFormData((prev) => ({
              ...prev,
              name: prefilled.name !== undefined ? prefilled.name : prev.name,
              description: prefilled.description !== undefined ? prefilled.description : prev.description,
              start_datetime: prefilled.start_datetime !== undefined ? prefilled.start_datetime : prev.start_datetime,
              end_datetime: prefilled.end_datetime !== undefined ? prefilled.end_datetime : prev.end_datetime,
              location: prefilled.location !== undefined ? prefilled.location : prev.location,
              guest_count: prefilled.guest_count !== undefined ? prefilled.guest_count : prev.guest_count,
              event_type: prefilled.event_type !== undefined ? prefilled.event_type : prev.event_type,
              total_budget: prefilled.total_budget !== undefined ? prefilled.total_budget : prev.total_budget,
              currency: prefilled.currency !== undefined ? prefilled.currency : prev.currency,
            }));
            setIsVoiceMode(false);
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-8">
          {/* Wizard Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-5 gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Protocol Initialization
              </span>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
                Initialize New Event Operation
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Step {step} of 3 • {step === 1 ? "Core Details" : step === 2 ? "Logistics & Capacity" : "Budget & Currency"}
              </p>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-center">
              <button
                id="btn-voice-mode-trigger"
                type="button"
                onClick={() => setIsVoiceMode(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-[#D6003C] hover:bg-rose-100 text-xs font-bold transition shadow-xs"
              >
                <Mic className="w-4 h-4 text-[#D6003C]" />
                <span>Voice mode</span>
              </button>

              <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center font-bold text-xs text-[#D6003C]">
                {step}/3
              </div>
            </div>
          </div>

        {/* Error Notice */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Wizard Steps Form */}
        <form
          onSubmit={
            step === 3
              ? handleDeploy
              : (e) => {
                  e.preventDefault();
                  setStep((s) => s + 1);
                }
          }
          className="space-y-6"
        >
          {/* STEP 1: Core Details */}
          {step === 1 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Operation Designation / Event Name *
                </label>
                <div className="relative">
                  <Settings className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    required
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. Global Tech Summit 2026"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Operational Scope Narrative
                </label>
                <div className="relative">
                  <AlignLeft className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                    placeholder="Primary objectives, VIP requirements, and scope constraints…"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Target Start Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      name="start_datetime"
                      value={formData.start_datetime}
                      onChange={handleChange}
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Target End Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      name="end_datetime"
                      value={formData.end_datetime}
                      onChange={handleChange}
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Logistics & Capacity */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Target Venue / City Location
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    name="location"
                    value={formData.location}
                    onChange={handleChange}
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. San Francisco, CA or Moscone Center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Projected Headcount / Capacity
                  </label>
                  <div className="relative">
                    <Users className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      name="guest_count"
                      value={formData.guest_count}
                      onChange={handleChange}
                      type="number"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                      placeholder="e.g. 1500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Event Classification
                  </label>
                  <select
                    name="event_type"
                    value={formData.event_type}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="conference">Conference / Summit</option>
                    <option value="hackathon">Hackathon / Tech Sprint</option>
                    <option value="wedding">Wedding / Social Gala</option>
                    <option value="college_fest">College Fest / Campus Event</option>
                    <option value="corporate">Corporate Offsite</option>
                    <option value="exhibition">Exhibition / Expo</option>
                  </select>

                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Budget & Financials */}
          {step === 3 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Total Allocated Event Budget
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      name="total_budget"
                      value={formData.total_budget}
                      onChange={handleChange}
                      type="number"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                      placeholder="e.g. 500000"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Currency
                  </label>
                  <select
                    name="currency"
                    value={formData.currency}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-1">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Autonomous Materialization Notice
                </span>
                <p>
                  Upon deployment, the EVENTRA specification engine will formulate task dependencies, CPM milestones, and category sourcing constraints.
                </p>
              </div>
            </div>
          )}

          {/* Form Actions Footer */}
          <div className="pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
            <div>
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={isDeploying}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition disabled:opacity-50"
            >
              {isDeploying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Deploying Event…</span>
                </>
              ) : step === 3 ? (
                <>
                  <span>Deploy Protocol</span>
                  <PlusCircle className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Next Step</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    )}
  </div>
  );
}

