"use client";

import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

interface OfflineBannerProps {
  lastDataTimestamp?: string | null;
  className?: string;
}

export function OfflineBanner({ lastDataTimestamp, className = "" }: OfflineBannerProps) {
  const { isOnline, lastOnlineAt } = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  const formattedTime = lastDataTimestamp
    ? new Date(lastDataTimestamp).toLocaleTimeString()
    : lastOnlineAt
    ? lastOnlineAt.toLocaleTimeString()
    : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-col justify-between gap-3 rounded-xl border border-standby-300 bg-standby-50 p-3.5 text-ink-900 shadow-sm sm:flex-row sm:items-center sm:p-4 ${className}`}
    >
      <div className="flex items-start gap-3 sm:items-center">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-standby-100 text-standby-700">
          <WifiOff className="h-[18px] w-[18px]" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-standby-300 bg-standby-100 text-standby-800">
              <span className="cue-light bg-standby-500 animate-cue-blink" />
              Offline
            </span>
            <h4 className="text-[13.5px] font-semibold">You&apos;re offline — showing the last saved state</h4>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-600">
            Approvals, messages and other changes are paused until you reconnect, so nothing gets out of sync.
            {formattedTime && (
              <span className="ml-1 font-mono text-[11px] font-semibold text-ink-800">Last update {formattedTime}</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
        <span className="hidden font-mono text-[10.5px] uppercase tracking-label text-standby-700 md:inline">Read-only</span>
        <button
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.reload();
            }
          }}
          className="btn-secondary h-8 px-3 text-[12px]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reconnect
        </button>
      </div>
    </div>
  );
}
