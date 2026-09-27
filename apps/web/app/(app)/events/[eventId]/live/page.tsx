"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { LiveOperationsCommand } from "@/components/v2/LiveOperationsCommand";

export default function LiveOpsPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <LiveOperationsCommand eventId={eventId} />
    </EventShell>
  );
}
