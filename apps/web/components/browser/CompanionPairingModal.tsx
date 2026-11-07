"use client";

import React, { useState, useEffect } from "react";
import {
  browserCompanionApi,
  CompanionStatusResponse,
  PairingCodeResponse,
} from "@/lib/api/browserCompanion";
import { Check, Copy, ExternalLink, Laptop, RefreshCw, X } from "lucide-react";

interface CompanionPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

export function CompanionPairingModal({
  isOpen,
  onClose,
  onConnected,
}: CompanionPairingModalProps) {
  const [pairingData, setPairingData] = useState<PairingCodeResponse | null>(null);
  const [status, setStatus] = useState<CompanionStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch status on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function loadData() {
      setLoading(true);
      try {
        const [stat, code] = await Promise.all([
          browserCompanionApi.getStatus(),
          browserCompanionApi.getPairingCode(),
        ]);
        if (isMounted) {
          setStatus(stat);
          setPairingData(code);
        }
      } catch (err) {
        console.error("Failed to load pairing data:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    // Poll for companion connection every 2.5s
    const interval = setInterval(async () => {
      try {
        const latest = await browserCompanionApi.getStatus();
        if (isMounted) {
          setStatus(latest);
          if (latest.is_connected && onConnected) {
            onConnected();
          }
        }
      } catch {}
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOpen, onConnected]);

  const [terminalType, setTerminalType] = useState<"powershell" | "cmd">("cmd");

  if (!isOpen) return null;

  const activeCommand = pairingData
    ? terminalType === "powershell"
      ? `cd tools\\windows-companion; .\\run-companion.ps1 -Code "${pairingData.pairing_code}"`
      : `cd tools\\windows-companion && run-companion.bat ${pairingData.pairing_code}`
    : terminalType === "powershell"
      ? `cd tools\\windows-companion; .\\run-companion.ps1`
      : `cd tools\\windows-companion && run-companion.bat`;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefreshCode = async () => {
    setLoading(true);
    try {
      const code = await browserCompanionApi.getPairingCode();
      setPairingData(code);
    } catch {}
    setLoading(false);
  };

  const code = pairingData?.pairing_code;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Pair the Windows browser companion"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex w-full max-w-lg animate-rise-in flex-col overflow-hidden rounded-2xl bg-paper text-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-900 text-ink-50">
              <Laptop className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-ink-900">Windows browser companion</h3>
              <p className="text-[12.5px] text-ink-500">Lets the agent drive a real, visible browser on your PC.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-800"
            aria-label="Close"
            autoFocus
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 pb-6">
          {status?.is_connected ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-go-200 bg-go-50 p-4">
              <div className="flex items-center gap-3">
                <span className="cue-light h-2.5 w-2.5 bg-go-500 animate-cue-blink" />
                <div>
                  <h4 className="text-[13.5px] font-semibold text-go-900">Companion connected</h4>
                  <p className="text-[12px] text-go-700">
                    {status.device_name || "Windows PC"} · ready for visible browser tasks
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="btn h-8 bg-go-600 px-3 text-[12px] text-white hover:bg-go-700">
                Done
              </button>
            </div>
          ) : (
            <>
              <ol className="space-y-1 text-[13px] text-ink-700">
                <li className="flex gap-2">
                  <span className="font-mono text-[11px] text-ink-400">01</span> Open a terminal in the EVENTRA folder on your PC.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-[11px] text-ink-400">02</span> Run the command below — it includes your code.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-[11px] text-ink-400">03</span> This window updates as soon as it connects.
                </li>
              </ol>

              {/* Pairing code */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-[#FDFCFA] px-4 py-3.5 shadow-sm">
                <div>
                  <span className="eyebrow">Pairing code</span>
                  <div className="mt-1.5 flex gap-1.5" aria-label={code ? `Pairing code ${code}` : "No pairing code yet"}>
                    {(loading ? "······" : code || "------").split("").map((ch, i) => (
                      <span
                        key={i}
                        className="grid h-10 w-8 place-items-center rounded-md bg-ink-100 font-mono text-[20px] font-bold text-ink-900"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleRefreshCode}
                  disabled={loading}
                  title="Generate a new code"
                  aria-label="Generate a new code"
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Command */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="eyebrow">Run in your terminal</span>
                  <div className="inline-flex rounded-lg border border-ink-200 bg-ink-100/70 p-0.5 text-[11.5px] font-semibold">
                    {(
                      [
                        { id: "cmd", label: "Command Prompt" },
                        { id: "powershell", label: "PowerShell" },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTerminalType(t.id)}
                        className={`rounded-md px-2.5 py-1 transition ${
                          terminalType === t.id ? "bg-[#FDFCFA] text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-950 px-4 py-3 font-mono text-[12px]">
                  <span className="min-w-0 select-all truncate text-ink-100">
                    <span className="text-ink-500">&gt; </span>
                    {activeCommand}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="btn h-7 shrink-0 bg-white/10 px-2.5 text-[11.5px] text-ink-100 hover:bg-white/15"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-go-300" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-500" aria-live="polite">
                <span className="cue-light bg-standby-500 animate-cue-blink" />
                Waiting for the companion to connect…
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-ink-200 bg-[#FDFCFA] px-6 py-3 text-[12px] text-ink-500">
          <span className="font-mono text-[11px]">Visible Playwright browser</span>
          <button onClick={onClose} className="font-semibold text-ink-700 hover:text-ink-900">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
