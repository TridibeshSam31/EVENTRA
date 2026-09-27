"use client";

import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { RecoveryCommand } from "@/components/v2/RecoveryCommand";
import { Loader2 } from "lucide-react";

function RecoveryContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params?.eventId as string;
  const initialIncidentId = searchParams?.get("incidentId");

  return (
    <EventShell eventId={eventId} currentStage="RECOVER">
      <RecoveryCommand eventId={eventId} initialIncidentId={initialIncidentId} />
    </EventShell>
  );
}

export default function RecoveryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-50">
          <Loader2 className="h-6 w-6 animate-spin text-[#D6003C]" />
        </div>
      }
    >
      <RecoveryContent />
    </Suspense>
  );
}
