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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Windows Browser Companion</h3>
              <p className="text-xs text-slate-400">Option A: Genuine Visible Chromium / Edge on Desktop</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {status?.is_connected ? (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                <div>
                  <h4 className="text-xs font-bold text-emerald-300">Desktop Companion Connected</h4>
                  <p className="text-[11px] text-emerald-400/80">
                    Device: {status.device_name || "Windows PC"} • Ready for visible browser tasks
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  To view the genuine browser window opening on your physical Windows screen, start the local
                  companion in PowerShell using the pairing code below:
                </p>
              </div>

              {/* Pairing Code Box */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Your 6-Digit Pairing Code
                  </span>
                  <div className="text-2xl font-mono font-extrabold text-indigo-400 tracking-widest mt-1">
                    {loading ? "..." : pairingData?.pairing_code || "------"}
                  </div>
                </div>
                <button
                  onClick={handleRefreshCode}
                  disabled={loading}
                  title="Generate new code"
                  className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-850 rounded-lg transition"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Terminal Command Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-slate-400">
                    Run in your Windows terminal:
                  </label>
                  <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-medium">
                    <button
                      type="button"
                      onClick={() => setTerminalType("cmd")}
                      className={`px-2 py-0.5 rounded transition ${
                        terminalType === "cmd"
                          ? "bg-indigo-600 text-white font-semibold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Command Prompt (cmd)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTerminalType("powershell")}
                      className={`px-2 py-0.5 rounded transition ${
                        terminalType === "powershell"
                          ? "bg-indigo-600 text-white font-semibold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      PowerShell
                    </button>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 flex items-center justify-between gap-3">
                  <span className="truncate select-all text-indigo-300">{activeCommand}</span>
                  <button
                    onClick={handleCopy}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1 transition flex-shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>

              {/* Waiting Indicator */}
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span>Waiting for companion to connect...</span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
          <span>Option A: Visible Playwright Desktop</span>
          <button onClick={onClose} className="hover:text-slate-300 font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
