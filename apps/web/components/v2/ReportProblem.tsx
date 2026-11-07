"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { createIncident } from "@/lib/api/incidents";

const KINDS = [
  { value: "VENDOR_CANCELLATION", label: "A vendor cancelled" },
  { value: "VENDOR_DELAY", label: "A vendor is running late" },
  { value: "VENDOR_NO_SHOW", label: "A vendor did not show up" },
  { value: "EQUIPMENT_FAILURE", label: "Equipment stopped working" },
  { value: "VENUE_ISSUE", label: "Problem at the venue" },
  { value: "RESOURCE_SHORTAGE", label: "Something ran short" },
];

/** Lets the organizer report an emergency; it goes through the same incident pipeline as detected ones. */
export function ReportProblem({ eventId, vendors }: { eventId: string; vendors: { vendor_id: string; name: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0].value);
  const [vendorId, setVendorId] = useState("");
  const [details, setDetails] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const label = KINDS.find((k) => k.value === kind)?.label || "Problem";
      const vendorName = vendors.find((v) => v.vendor_id === vendorId)?.name;
      const incident = await createIncident(eventId, {
        incident_type: kind,
        title: vendorName ? `${label}: ${vendorName}` : label,
        description: details.trim() || null,
        severity: urgent ? "CRITICAL" : "HIGH",
        source: "MANUAL",
        related_vendor_id: vendorId || null,
      });
      router.push(`/events/${eventId}/incidents?incidentId=${incident.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not report the problem.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn h-9 border border-cue-200 bg-[#FDFCFA] text-cue-700 shadow-sm hover:border-cue-300 hover:bg-cue-50"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Report a problem
      </button>
    );
  }

  const field =
    "w-full rounded-lg border border-ink-200 bg-[#FDFCFA] px-3 py-2 text-[13px] text-ink-900 shadow-inner outline-none transition focus:border-ink-400 focus:ring-2 focus:ring-cue-600/15";

  return (
    <section className="surface relative animate-rise-in space-y-4 overflow-hidden p-5">
      <span className="absolute inset-y-0 left-0 w-1 bg-cue-600" aria-hidden />
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow text-cue-600">Hold the show</div>
          <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Report a problem</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-500">EVENTRA will check the impact and line up recovery options.</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-[12px] font-medium text-ink-600">
          <span>What happened?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12px] font-medium text-ink-600">
          <span>Which vendor? (optional)</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={field}>
            <option value="">Not about a vendor</option>
            {vendors.map((v) => (
              <option key={v.vendor_id} value={v.vendor_id}>{v.name || v.vendor_id}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-[12px] font-medium text-ink-600">
        <span>Details</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="e.g. Caterer called to say their van broke down" className={field} />
      </label>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-[12.5px] font-medium text-ink-800 has-[:checked]:border-cue-300 has-[:checked]:bg-cue-50 has-[:checked]:text-cue-800">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="accent-cue-600" /> This is urgent
      </label>
      {error && <p role="alert" className="text-[12.5px] text-cue-700">{error}</p>}
      <div className="flex items-center gap-2 border-t border-ink-200 pt-4">
        <button onClick={submit} disabled={busy} className="btn-cue">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Report and see options
        </button>
        <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </section>
  );
}
