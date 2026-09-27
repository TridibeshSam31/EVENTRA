"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { IncidentCommand } from "@/components/v2/IncidentCommand";

export default function IncidentsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <IncidentCommand eventId={eventId} />
    </EventShell>
  );
}
