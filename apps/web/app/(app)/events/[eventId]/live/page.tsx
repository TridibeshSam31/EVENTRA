"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { LiveOperationsCommand } from "@/components/v2/LiveOperationsCommand";
import { LiveOperationsOverview } from "@/components/v2/LiveOperationsOverview";
import { useAdvancedMode } from "@/hooks/useAdvancedMode";

export default function LiveOpsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;
  const [advanced] = useAdvancedMode();

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <LiveOperationsOverview eventId={eventId} />
      {/* Engine diagnostics, raw agent state and operator controls stay available for advanced users. */}
      {advanced && (
        <details className="surface group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-[13px] font-semibold text-ink-700 hover:text-ink-900">
            <span className="flex items-center gap-2.5">
              <span className="eyebrow">Advanced</span>
              Detailed diagnostics
            </span>
            <span className="font-mono text-[11px] text-ink-400 group-open:hidden">show</span>
            <span className="hidden font-mono text-[11px] text-ink-400 group-open:inline">hide</span>
          </summary>
          <div className="border-t border-ink-200 p-5">
            <LiveOperationsCommand eventId={eventId} />
          </div>
        </details>
      )}
    </EventShell>
  );
}
