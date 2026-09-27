"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { PlanningCommand } from "@/components/v2/PlanningCommand";

export default function SchedulePage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="PLAN">
      <PlanningCommand eventId={eventId} initialTab="SCHEDULE" />
    </EventShell>
  );
}
