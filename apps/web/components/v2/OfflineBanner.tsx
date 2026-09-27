"use client";

import React from "react";
import { WifiOff, AlertTriangle, RefreshCw } from "lucide-react";
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
      className={`bg-amber-50 border-y sm:border sm:rounded-xl border-amber-300 p-3 sm:p-4 text-amber-900 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}
    >
      <div className="flex items-start sm:items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-200/80 text-amber-900 shrink-0 mt-0.5 sm:mt-0">
          <WifiOff className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
              OFFLINE
            </span>
            <h4 className="text-xs sm:text-sm font-bold text-amber-950">
              Live Connection Disconnected
            </h4>
          </div>
          <p className="text-xs text-amber-800 mt-0.5">
            Operational mutations, approvals, and dispatches are paused to prevent state desynchronization.
            {formattedTime && (
              <span className="ml-1 font-mono text-[11px] text-amber-900 font-semibold">
                (Last authoritative data received: {formattedTime})
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        <span className="text-[11px] text-amber-700 italic hidden md:inline">
          Read-only mode active
        </span>
        <button
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.reload();
            }
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect
        </button>
      </div>
    </div>
  );
}
