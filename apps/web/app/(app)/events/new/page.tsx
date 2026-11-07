"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Calendar,
  Users,
  MapPin,
  Wallet,
  Plus,
  Loader2,
  AlertCircle,
  Sparkles,
  Mic,
  Check,
  Type,
} from "lucide-react";
import { createEvent } from "@/lib/api/events";
import type { EventCreate, EventResponse } from "@/types/api";
import { setActiveEventId } from "@/stores/eventStore";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { VoiceIntakePanel } from "@/features/event-creation/VoiceIntakePanel";

const STEPS = [
  { n: 1, label: "The basics", hint: "Name and dates" },
  { n: 2, label: "Where & who", hint: "Location and guests" },
  { n: 3, label: "Budget", hint: "How much to spend" },
];

// The backend has plan templates for exactly these three event types (app/domains). Anything
// else is planned from the conference template — we say so instead of pretending otherwise.
const EVENT_TYPES = [
  { value: "wedding", label: "Wedding", hint: "Ceremony, reception, catering, décor" },
  { value: "college_fest", label: "College fest", hint: "Stages, crowds, sponsors, security" },
  { value: "conference", label: "Conference / corporate", hint: "Sessions, AV, registration, catering" },
  { value: "other", label: "Something else", hint: "Starts from the conference plan — you can adjust it" },
];

const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

const inputCls =
  "w-full rounded-xl border border-ink-200 bg-[#FDFCFA] py-3 pr-4 text-[14px] text-ink-900 shadow-inner outline-none transition placeholder:text-ink-400 focus:border-ink-400 focus:ring-4 focus:ring-cue-600/10";
const labelCls = "mb-1.5 block text-[12.5px] font-semibold text-ink-700";
const iconCls = "pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400";

function fmtDate(v: string) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

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

  const [created, setCreated] = useState<EventResponse | null>(null);
  const startRun = useAgentRunStore((s) => s.startRun);
  const startingRun = useAgentRunStore((s) => s.starting);
  const startError = useAgentRunStore((s) => s.startError);
  const [startRequested, setStartRequested] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setErrorMsg("");
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Dates: the end can't be before the start.
  const dateError =
    formData.start_datetime && formData.end_datetime && formData.end_datetime < formData.start_datetime
      ? "The end date is before the start date."
      : "";

  // Numbers: blank stays blank (null) — never silently 0.
  const parseOptionalInt = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  };
  const parseOptionalFloat = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  const goNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1 && dateError) {
      setErrorMsg(dateError);
      return;
    }
    // Enter on the last step must not create the event — creation is an explicit click.
    if (step < 3) setStep((s) => s + 1);
  };

  const handleDeploy = async () => {
    if (!formData.name.trim()) {
      setStep(1);
      setErrorMsg("Give the event a name first.");
      return;
    }
    if (dateError) {
      setStep(1);
      setErrorMsg(dateError);
      return;
    }
    const guests = parseOptionalInt(formData.guest_count);
    const budget = parseOptionalFloat(formData.total_budget);
    if ((guests !== null && guests < 0) || (budget !== null && budget < 0)) {
      setErrorMsg("Guests and budget can't be negative.");
      return;
    }

    setIsDeploying(true);
    setErrorMsg("");

    try {
      // The API accepts null for unknown guests/budget (EventCreate: Optional); the shared TS
      // type is stricter than the backend, hence the cast.
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        event_type: formData.event_type.toUpperCase(),
        location: formData.location.trim() || undefined,
        start_datetime: formData.start_datetime ? new Date(formData.start_datetime).toISOString() : null,
        end_datetime: formData.end_datetime ? new Date(formData.end_datetime).toISOString() : null,
        guest_count: guests,
        state: "NORMAL",
        total_budget: budget,
        currency: formData.currency,
        owner_id: "default-operator",
      } as unknown as EventCreate;
      const ev = await createEvent(payload);

      if (ev?.id) {
        setActiveEventId(ev.id);
        // Don't start anything silently: show what EVENTRA will do and let the organizer choose.
        setCreated(ev);
        setIsDeploying(false);
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      console.error("Failed to create event:", err);
      setErrorMsg(err.message || "Failed to create the event. Please check the details.");
      setIsDeploying(false);
    }
  };

  const handleStartPlanning = async () => {
    if (!created?.id) return;
    setStartRequested(true);
    await startRun(created.id);
    // startRun records its own error; only navigate when it didn't fail.
    if (!useAgentRunStore.getState().startError) {
      router.push(`/events/${created.id}`);
    }
  };

  const typeLabel = EVENT_TYPES.find((t) => t.value === formData.event_type)?.label || "Event";
  const sym = CURRENCY_SYMBOLS[formData.currency] || "";
  const start = fmtDate(formData.start_datetime);
  const end = fmtDate(formData.end_datetime);

  const summary: Array<{ label: string; value: string | null }> = [
    { label: "Type", value: typeLabel },
    { label: "Dates", value: start ? (end && end !== start ? `${start} → ${end}` : start) : null },
    { label: "Where", value: formData.location.trim() || null },
    { label: "Guests", value: formData.guest_count ? Number(formData.guest_count).toLocaleString() : null },
    {
      label: "Budget",
      value: formData.total_budget ? `${sym}${Number(formData.total_budget).toLocaleString()}` : null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      {created ? (
        <section className="mx-auto max-w-2xl animate-rise-in" aria-labelledby="created-title">
          <div className="surface overflow-hidden">
            <div className="border-b border-ink-200 bg-go-50/60 px-6 py-5 sm:px-8">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-go-700">
                <Check className="h-4 w-4" strokeWidth={3} /> Event created
              </div>
              <h1
                id="created-title"
                className="mt-1.5 font-display text-[30px] font-extrabold leading-[1.02] tracking-[-0.02em] text-ink-900"
                style={{ fontStretch: "86%" }}
              >
                {created.name}
              </h1>
            </div>
            <div className="space-y-5 px-6 py-6 sm:px-8">
              <div>
                <h2 className="text-[15px] font-semibold text-ink-900">Ready for EVENTRA to start?</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">Here&apos;s exactly what happens when you press start:</p>
              </div>
              <ol className="space-y-3">
                {[
                  { t: "Build your plan", d: "Tasks, dependencies and a schedule for this kind of event." },
                  { t: "Search for venues and vendors", d: "Real businesses near your location, checked against your guest count and budget." },
                  { t: "Ask you before contacting anyone", d: "You pick who to approach. No message or call goes out without your OK." },
                ].map((s, i) => (
                  <li key={s.t} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900 font-mono text-[11px] font-bold text-ink-50">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink-900">{s.t}</span>
                      <span className="block text-[12.5px] text-ink-600">{s.d}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="rounded-lg bg-ink-100/70 px-3 py-2.5 text-[12.5px] text-ink-700">
                It runs in the background and takes a few minutes. You can leave this page — progress shows on the event overview.
              </p>
              {startRequested && startError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-cue-200 bg-cue-50 px-3 py-2.5 text-[12.5px] text-cue-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Couldn&apos;t start: {startError}. Your event is saved — you can start from its overview later.
                  </span>
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 border-t border-ink-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
                <button type="button" onClick={() => router.push(`/events/${created.id}`)} className="btn-ghost">
                  Not now — open the event
                </button>
                <button
                  type="button"
                  onClick={handleStartPlanning}
                  disabled={startingRun}
                  className="btn-cue h-10 px-5 text-[13.5px]"
                  data-guide-step="start_discovery"
                >
                  {startingRun ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                    </>
                  ) : (
                    <>
                      Start planning &amp; finding vendors <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : isVoiceMode ? (
        <div className="mx-auto max-w-3xl">
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
                event_type:
                  prefilled.event_type !== undefined
                    ? EVENT_TYPES.some((t) => t.value === String(prefilled.event_type).toLowerCase())
                      ? String(prefilled.event_type).toLowerCase()
                      : "other"
                    : prev.event_type,
                total_budget: prefilled.total_budget !== undefined ? prefilled.total_budget : prev.total_budget,
                currency: prefilled.currency !== undefined ? prefilled.currency : prev.currency,
              }));
              setIsVoiceMode(false);
            }}
          />
        </div>
      ) : (
        <>
          {/* Intro */}
          <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="eyebrow">New event</div>
              <h1
                className="mt-2 font-display text-[34px] font-extrabold leading-[0.98] tracking-[-0.02em] text-ink-900 sm:text-[44px]"
                style={{ fontStretch: "84%" }}
              >
                What are we putting on?
              </h1>
              <p className="mt-2 max-w-[56ch] text-[14.5px] leading-relaxed text-ink-600">
                A few details are enough. Once the event exists you choose when EVENTRA starts planning and finding
                vendors — and you can refine everything later.
              </p>
            </div>

            <button
              id="btn-voice-mode-trigger"
              type="button"
              onClick={() => setIsVoiceMode(true)}
              className="group flex items-center gap-3 self-start rounded-2xl border border-ink-200 bg-[#FDFCFA] p-2 pr-4 text-left shadow-sm transition hover:border-cue-300 hover:shadow-md lg:self-auto"
            >
              <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-cue-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <span className="absolute inset-0 rounded-xl bg-cue-600 opacity-0 transition group-hover:animate-ping group-hover:opacity-30" />
                <Mic className="relative h-5 w-5" />
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold text-ink-900">Voice mode</span>
                <span className="block text-[12px] text-ink-500">Just describe it out loud</span>
              </span>
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            {/* Form card */}
            <div className="surface overflow-hidden">
              {/* Step rail */}
              <ol className="grid grid-cols-3 border-b border-ink-200 bg-ink-100/40">
                {STEPS.map((s, i) => {
                  const done = s.n < step;
                  const current = s.n === step;
                  return (
                    <li key={s.n} className={`relative px-4 py-3 sm:px-5 ${i > 0 ? "border-l border-ink-200" : ""}`}>
                      <button
                        type="button"
                        disabled={!done}
                        onClick={() => done && setStep(s.n)}
                        className="flex w-full items-center gap-2.5 text-left disabled:cursor-default"
                        aria-current={current ? "step" : undefined}
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-bold transition ${
                            current
                              ? "bg-ink-900 text-ink-50"
                              : done
                              ? "bg-go-500 text-white"
                              : "border border-dashed border-ink-300 text-ink-400"
                          }`}
                        >
                          {done ? <Check className="h-3 w-3" strokeWidth={3} /> : s.n}
                        </span>
                        <span className="min-w-0">
                          <span className={`block truncate text-[12.5px] font-semibold ${current || done ? "text-ink-900" : "text-ink-400"}`}>
                            {s.label}
                          </span>
                          <span className="hidden truncate text-[11px] text-ink-500 sm:block">{s.hint}</span>
                        </span>
                      </button>
                      <span
                        className={`absolute inset-x-0 bottom-0 h-[2px] ${current ? "bg-cue-600" : done ? "bg-go-500" : "bg-transparent"}`}
                        aria-hidden
                      />
                    </li>
                  );
                })}
              </ol>

              <div className="p-5 sm:p-8">
                {errorMsg && (
                  <div role="alert" className="mb-6 flex items-center gap-2.5 rounded-xl border border-cue-200 bg-cue-50 p-3.5 text-[13px] text-cue-800">
                    <AlertCircle className="h-4 w-4 shrink-0 text-cue-600" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <form onSubmit={goNext} className="space-y-6" noValidate={false}>
                  {step === 1 && (
                    <div key="s1" className="animate-rise-in space-y-5">
                      <div>
                        <label htmlFor="ev-name" className={labelCls}>
                          Event name <span className="text-cue-600">*</span>
                        </label>
                        <div className="relative">
                          <Type className={iconCls} />
                          <input
                            id="ev-name"
                            required
                            autoFocus
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            type="text"
                            className={`${inputCls} pl-11 text-[16px] font-semibold`}
                            placeholder="e.g. Global Tech Summit 2026"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="ev-desc" className={labelCls}>
                          What&apos;s it about? <span className="font-normal text-ink-400">(optional)</span>
                        </label>
                        <textarea
                          id="ev-desc"
                          name="description"
                          value={formData.description}
                          onChange={handleChange}
                          rows={3}
                          className={`${inputCls} resize-none pl-4`}
                          placeholder="Goals, must-haves, VIPs, anything EVENTRA should keep in mind…"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="ev-start" className={labelCls}>Starts</label>
                          <div className="relative">
                            <Calendar className={iconCls} />
                            <input
                              id="ev-start"
                              name="start_datetime"
                              value={formData.start_datetime}
                              onChange={handleChange}
                              type="date"
                              className={`${inputCls} pl-11 font-mono`}
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor="ev-end" className={labelCls}>Ends</label>
                          <div className="relative">
                            <Calendar className={iconCls} />
                            <input
                              id="ev-end"
                              name="end_datetime"
                              value={formData.end_datetime}
                              onChange={handleChange}
                              type="date"
                              min={formData.start_datetime || undefined}
                              aria-invalid={!!dateError}
                              aria-describedby={dateError ? "ev-date-error" : undefined}
                              className={`${inputCls} pl-11 font-mono ${dateError ? "border-cue-400" : ""}`}
                            />
                          </div>
                        </div>
                      </div>
                      {dateError && (
                        <p id="ev-date-error" role="alert" className="-mt-2 text-[12.5px] font-medium text-cue-700">
                          {dateError}
                        </p>
                      )}
                    </div>
                  )}

                  {step === 2 && (
                    <div key="s2" className="animate-rise-in space-y-5">
                      <div>
                        <label htmlFor="ev-loc" className={labelCls}>City or venue</label>
                        <div className="relative">
                          <MapPin className={iconCls} />
                          <input
                            id="ev-loc"
                            autoFocus
                            name="location"
                            value={formData.location}
                            onChange={handleChange}
                            type="text"
                            className={`${inputCls} pl-11`}
                            placeholder="e.g. New Delhi, or a specific venue"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="ev-guests" className={labelCls}>How many guests?</label>
                        <div className="relative">
                          <Users className={iconCls} />
                          <input
                            id="ev-guests"
                            name="guest_count"
                            value={formData.guest_count}
                            onChange={handleChange}
                            type="number"
                            min={0}
                            className={`${inputCls} pl-11 font-mono`}
                            placeholder="e.g. 500"
                          />
                        </div>
                      </div>

                      <fieldset>
                        <legend className={labelCls}>What kind of event?</legend>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {EVENT_TYPES.map((t) => {
                            const active = formData.event_type === t.value;
                            return (
                              <label
                                key={t.value}
                                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] transition ${
                                  active
                                    ? "border-ink-900 bg-ink-900 font-semibold text-ink-50 shadow-md"
                                    : "border-ink-200 bg-[#FDFCFA] text-ink-700 hover:border-ink-300"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="event_type"
                                  value={t.value}
                                  checked={active}
                                  onChange={handleChange}
                                  className="sr-only"
                                />
                                <span className={`cue-light mt-1 self-start ${active ? "bg-cue-500" : "bg-ink-300"}`} />
                                <span className="min-w-0">
                                  <span className="block">{t.label}</span>
                                  <span className={`block text-[11.5px] font-normal ${active ? "text-ink-300" : "text-ink-600"}`}>
                                    {t.hint}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </div>
                  )}

                  {step === 3 && (
                    <div key="s3" className="animate-rise-in space-y-5">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label htmlFor="ev-budget" className={labelCls}>Total budget</label>
                          <div className="relative">
                            <Wallet className={iconCls} />
                            <input
                              id="ev-budget"
                              autoFocus
                              name="total_budget"
                              value={formData.total_budget}
                              onChange={handleChange}
                              type="number"
                              min={0}
                              className={`${inputCls} pl-11 font-mono text-[16px]`}
                              placeholder="e.g. 500000"
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor="ev-cur" className={labelCls}>Currency</label>
                          <select
                            id="ev-cur"
                            name="currency"
                            value={formData.currency}
                            onChange={handleChange}
                            className={`${inputCls} pl-4 font-mono`}
                          >
                            <option value="INR">INR (₹)</option>
                            <option value="USD">USD ($)</option>
                            <option value="EUR">EUR (€)</option>
                            <option value="GBP">GBP (£)</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-3 rounded-xl border border-agent-200 bg-agent-50/70 p-4">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-agent-600" />
                        <div className="text-[13px] leading-relaxed text-ink-700">
                          <span className="font-semibold text-ink-900">What happens next.</span> EVENTRA works out the tasks
                          and their dependencies, builds a schedule, and figures out which vendors you&apos;ll need — then
                          asks before contacting anyone.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 border-t border-ink-200 pt-6">
                    <div>
                      {step > 1 ? (
                        <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-ghost">
                          <ArrowLeft className="h-3.5 w-3.5" /> Back
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-ink-400">Step {step} of 3</span>
                      )}
                    </div>

                    <button
                      type={step === 3 ? "button" : "submit"}
                      onClick={step === 3 ? handleDeploy : undefined}
                      disabled={isDeploying || (step === 1 && !!dateError)}
                      data-guide-step={step === 3 ? "complete_details" : undefined}
                      className={`${step === 3 ? "btn-cue" : "btn-primary"} h-10 px-5 text-[13.5px]`}
                    >
                      {isDeploying ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating event…
                        </>
                      ) : step === 3 ? (
                        <>
                          Create event
                          <Plus className="h-4 w-4" />
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Live preview — the event's run-sheet header, filling in as you type */}
            <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Event preview">
              <div className="surface-ink relative overflow-hidden rounded-2xl">
                <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
                <div
                  className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-50 blur-3xl"
                  style={{ background: "radial-gradient(circle, rgba(214,0,60,0.5), transparent 70%)" }}
                  aria-hidden
                />
                <div className="relative p-6">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-ink-500">
                    <span>Run sheet</span>
                    <span className="flex items-center gap-1.5 text-standby-400">
                      <span className="cue-light bg-standby-500 animate-cue-blink" />
                      Draft
                    </span>
                  </div>
                  <h2
                    className={`mt-5 font-display text-[28px] font-extrabold leading-[1] tracking-[-0.025em] ${
                      formData.name ? "text-ink-50" : "text-ink-600"
                    }`}
                    style={{ fontStretch: "84%" }}
                  >
                    {formData.name || "Untitled event"}
                  </h2>
                  {formData.description && (
                    <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-ink-400">{formData.description}</p>
                  )}
                </div>
                <dl className="relative border-t border-dashed border-white/10 px-6 py-4">
                  {summary.map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4 py-1.5">
                      <dt className="font-mono text-[10.5px] uppercase tracking-label text-ink-500">{row.label}</dt>
                      <dd className={`truncate text-right text-[13px] ${row.value ? "font-semibold text-ink-100" : "text-ink-600"}`}>
                        {row.value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="relative flex items-center gap-1 border-t border-white/[0.06] px-6 py-3">
                  {["Define", "Discover", "Plan", "Ready", "Live"].map((s, i) => (
                    <span
                      key={s}
                      className={`h-1 flex-1 rounded-full ${i === 0 ? "bg-cue-500" : "bg-white/10"}`}
                      title={s}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-3 px-1 text-[12px] leading-relaxed text-ink-500">
                Only the name is required. Anything you leave blank stays blank — EVENTRA won&apos;t guess it.
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
