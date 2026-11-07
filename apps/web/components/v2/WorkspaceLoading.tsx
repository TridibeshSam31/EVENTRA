"use client";

import { RotateCcw, ServerOff } from "lucide-react";

/** Placeholder shaped like the workspace, shown until the event's first fetch finishes. */
export function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading workspace" className="workspace-loading space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="workspace-ping absolute inline-flex h-full w-full rounded-full bg-cue-600" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cue-600" />
        </span>
        <p className="font-mono text-[11px] uppercase tracking-label text-ink-500">Loading workspace…</p>
      </div>

      <div className="space-y-3">
        <div className="workspace-shimmer h-3 w-24 rounded" />
        <div className="workspace-shimmer h-8 w-2/5 rounded-lg" />
        <div className="grid grid-cols-6 gap-1 pt-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="workspace-shimmer h-[62px] rounded-lg" />
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="workspace-shimmer h-[92px] rounded-xl" />
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="workspace-shimmer h-64 rounded-xl md:col-span-2" />
        <div className="workspace-shimmer h-64 rounded-xl" />
      </div>
      <span className="sr-only">Loading workspace</span>
    </div>
  );
}

/** Shown when the first fetch finished but the event could not be loaded. */
export function WorkspaceLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="workspace-loading flex min-h-[420px] items-center justify-center">
      <div className="surface flex max-w-sm flex-col items-center gap-2 px-8 py-10 text-center">
        <span className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-standby-50 text-standby-600 ring-1 ring-standby-200">
          <ServerOff className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-semibold text-ink-900">Couldn&apos;t load this event</p>
        <p className="text-[13px] leading-relaxed text-ink-500">
          EVENTRA couldn&apos;t reach its server. Check that the API is running, then try again.
        </p>
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    </div>
  );
}
