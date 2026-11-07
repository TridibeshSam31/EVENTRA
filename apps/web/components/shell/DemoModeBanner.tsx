"use client";

/**
 * Demo-mode banner.
 *
 * Reads GET /integrations/status (app/integrations/registry.py → get_status) and, when vendor
 * communication, AI or maps run in MOCK mode — or vendor search may fall back to simulated
 * results — shows a slim, persistent banner so organizers never believe a vendor was really
 * contacted when it wasn't. Hidden when everything is real or the status can't be read
 * (we never block the UI or guess). The result is cached for the browser session.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { getIntegrationsStatus } from "@/lib/api/integrations";

type Mode = "REAL" | "MOCK" | string;

interface IntegrationStatus {
  communication?: { mode?: Mode; provider?: string };
  llm?: { mode?: Mode; provider?: string };
  maps?: { mode?: Mode; provider?: string };
  google_maps_scraper?: { is_available?: boolean; fallback_to_mock?: boolean };
}

interface DemoFinding {
  key: string;
  title: string;
  detail: string;
  critical: boolean;
}

const CACHE_KEY = "eventra_integration_status_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(): IntegrationStatus | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: IntegrationStatus };
    if (!parsed?.at || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: IntegrationStatus) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage unavailable — fine, we'll just refetch next time */
  }
}

export function findDemoModes(status: IntegrationStatus | null): DemoFinding[] {
  if (!status) return [];
  const out: DemoFinding[] = [];
  const isMock = (m?: Mode) => typeof m === "string" && m.toUpperCase() === "MOCK";

  if (isMock(status.communication?.mode)) {
    out.push({
      key: "communication",
      title: "Vendor messages & calls are simulated",
      detail: "WhatsApp messages and AI phone calls are not actually sent. Replies you see are test data.",
      critical: true,
    });
  }
  if (isMock(status.llm?.mode)) {
    out.push({
      key: "llm",
      title: "AI understanding is in test mode",
      detail: "Requests and replies are read with simple rules instead of the AI model, so results may be less accurate.",
      critical: false,
    });
  }
  if (isMock(status.maps?.mode)) {
    out.push({
      key: "maps",
      title: "Distances & travel times are estimates",
      detail: "The maps service isn't connected, so distances and ETAs are approximate.",
      critical: false,
    });
  }
  const scraper = status.google_maps_scraper;
  if (scraper && scraper.is_available === false && scraper.fallback_to_mock) {
    out.push({
      key: "scraper",
      title: "Vendor search may include sample businesses",
      detail: "Live map search is unavailable, so some results may come from OpenStreetMap or simulated samples. Check each vendor's source tag.",
      critical: false,
    });
  }
  return out;
}

export function DemoModeBanner() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setStatus(cached);
      return;
    }
    let alive = true;
    getIntegrationsStatus()
      .then((data) => {
        if (!alive) return;
        const s = (data || {}) as IntegrationStatus;
        writeCache(s);
        setStatus(s);
      })
      .catch(() => {
        /* can't read status — say nothing rather than guess */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const findings = findDemoModes(status);
  if (findings.length === 0) return null;

  const commMock = findings.some((f) => f.key === "communication");
  const headline = commMock
    ? "Demo mode — vendors are not really contacted (messages & calls are simulated)"
    : "Demo mode — some services are running on test data";

  return (
    <div ref={rootRef} className="relative z-30 border-b border-standby-200 bg-standby-50 text-standby-900" role="status">
      <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-4 py-1.5 text-[12.5px] sm:px-6">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-standby-700" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-semibold">{headline}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold text-standby-800 underline-offset-2 hover:bg-standby-100 hover:underline"
        >
          What this means
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="absolute right-4 top-full mt-1 w-[min(92vw,420px)] animate-rise-in rounded-xl border border-ink-200 bg-[#FDFCFA] p-4 text-ink-800 shadow-xl sm:right-6">
          <p className="mb-3 text-[13px] text-ink-700">
            This workspace isn&apos;t connected to every real service yet. Here&apos;s what&apos;s simulated:
          </p>
          <ul className="space-y-2.5">
            {findings.map((f) => (
              <li key={f.key} className="flex gap-2.5">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.critical ? "bg-cue-600" : "bg-standby-500"}`}
                  aria-hidden
                />
                <span>
                  <span className="block text-[13px] font-semibold text-ink-900">{f.title}</span>
                  <span className="block text-[12.5px] leading-snug text-ink-600">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-ink-200 pt-2.5 text-[12px] text-ink-600">
            Your plan, budget and approvals still work normally. Connect the services in the server settings to go live.
          </p>
        </div>
      )}
    </div>
  );
}
