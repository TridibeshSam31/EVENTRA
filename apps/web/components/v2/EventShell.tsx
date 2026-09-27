"use client";

import React, { useEffect, useState } from "react";
import { EventHeader } from "./EventHeader";
import { LifecycleStage } from "./LifecycleStepper";
import { OfflineBanner } from "./OfflineBanner";
import { getEvent } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";

interface EventShellProps {
  eventId: string;
  currentStage: LifecycleStage;
  children: React.ReactNode;
  event?: EventResponse | null;
  className?: string;
}

export function EventShell({
  eventId,
  currentStage,
  children,
  event: initialEvent,
  className = "",
}: EventShellProps) {
  const [event, setEvent] = useState<EventResponse | null>(initialEvent || null);

  useEffect(() => {
    if (initialEvent) {
      setEvent(initialEvent);
      return;
    }

    let isMounted = true;
    async function fetchEventDetails() {
      try {
        const data = await getEvent(eventId);
        if (isMounted && data) {
          setEvent(data);
        }
      } catch (err) {
        // Fallback or let caller render
        console.warn(`Could not load event ${eventId} in EventShell:`, err);
      }
    }

    if (eventId) {
      fetchEventDetails();
    }

    return () => {
      isMounted = false;
    };
  }, [eventId, initialEvent]);

  return (
    <div className={`min-h-full flex flex-col bg-slate-50 ${className}`}>
      <EventHeader
        eventId={eventId}
        name={event?.name}
        startDate={event?.start_datetime || undefined}
        location={event?.location || undefined}
        guestCount={event?.guest_count}
        totalBudget={typeof event?.total_budget === "number" ? event.total_budget : Number(event?.total_budget) || undefined}
        currency={event?.currency}
        lifecycleState={event?.lifecycle_state || event?.state}
        state={event?.state || "NORMAL"}
        currentStage={currentStage}
      />

      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <OfflineBanner lastDataTimestamp={event?.updated_at || event?.created_at || null} />
        {children}
      </div>
    </div>
  );
}
