"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { ActivityCommand } from "@/components/v2/ActivityCommand";

export default function ActivityPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <ActivityCommand eventId={eventId} />
    </EventShell>
  );
}
