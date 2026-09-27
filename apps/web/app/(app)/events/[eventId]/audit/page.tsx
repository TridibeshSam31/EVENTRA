"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { AuditCommand } from "@/components/v2/AuditCommand";

export default function AuditPage() {
  const params = useParams();
  const eventId = params?.eventId as string;

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <AuditCommand eventId={eventId} />
    </EventShell>
  );
}
