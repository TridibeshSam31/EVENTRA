"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { RecoveryCommand } from "@/components/v2/RecoveryCommand";
import { IncidentResponseView } from "@/components/v2/IncidentResponseView";

/**
 * Recovery renders the same single Problems flow as /incidents, so every older link
 * (/recovery?incidentId=…) lands in one place. The detailed recovery workspace
 * (backup-vendor search, decision trace) is only shown when explicitly asked for
 * with ?view=advanced from the problem's "Advanced view" link.
 */
function RecoveryContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params?.eventId as string;
  const initialIncidentId = searchParams?.get("incidentId");
  const advanced = searchParams?.get("view") === "advanced";

  return (
    <EventShell eventId={eventId} currentStage="RECOVER">
      {advanced ? (
        <div className="space-y-4">
          <Link
            href={initialIncidentId ? `/events/${eventId}/incidents?incidentId=${initialIncidentId}` : `/events/${eventId}/incidents`}
            className="btn-ghost h-8 px-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the problem
          </Link>
          <RecoveryCommand eventId={eventId} initialIncidentId={initialIncidentId} />
        </div>
      ) : (
        <IncidentResponseView key={initialIncidentId || "list"} eventId={eventId} incidentId={initialIncidentId} />
      )}
    </EventShell>
  );
}

export default function RecoveryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-cue-600" />
        </div>
      }
    >
      <RecoveryContent />
    </Suspense>
  );
}
