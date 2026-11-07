"use client";

import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { EventShell } from "@/components/v2/EventShell";
import { IncidentResponseView } from "@/components/v2/IncidentResponseView";

/**
 * Problems — the single place to see and fix what's going wrong.
 * /incidents lists problems; /incidents?incidentId=… opens one (what happened → impact →
 * ways to fix it → approval → result). /recovery renders the same flow.
 */
function ProblemsContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params?.eventId as string;
  const incidentId = searchParams?.get("incidentId");

  return (
    <EventShell eventId={eventId} currentStage="RECOVER">
      <IncidentResponseView key={incidentId || "list"} eventId={eventId} incidentId={incidentId} />
    </EventShell>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-cue-600" />
        </div>
      }
    >
      <ProblemsContent />
    </Suspense>
  );
}
