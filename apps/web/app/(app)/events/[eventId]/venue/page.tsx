"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { DiscoveryCommand } from "@/components/v2/DiscoveryCommand";

export default function VenuePage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="DISCOVER">
      <DiscoveryCommand eventId={eventId} discoveryType="VENUE" defaultCategory="VENUE" />
    </EventShell>
  );
}
