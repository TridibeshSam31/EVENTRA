"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EventResponse } from "../types/api";

/**
 * The event the user is working on. There is no default event: a first-time
 * user has none, and we never point them at a phantom demo event.
 */

// Ids of the old built-in demo events. They don't exist in the backend, so a
// stored value equal to one of these is treated as "no active event".
const PHANTOM_DEMO_IDS = new Set(["conference_demo", "wedding_demo", "college_fest_demo"]);

export function isRealEventId(id: string | null | undefined): id is string {
  return !!id && !PHANTOM_DEMO_IDS.has(id);
}

interface EventStoreState {
  activeEventId: string | null;
  activeEvent: EventResponse | null;
  eventsList: EventResponse[];
  setActiveEventId: (id: string) => void;
  setActiveEvent: (event: EventResponse | null) => void;
  setEventsList: (events: EventResponse[]) => void;
}

export const useEventStore = create<EventStoreState>()(
  persist(
    (set) => ({
      activeEventId: null,
      activeEvent: null,
      eventsList: [],
      setActiveEventId: (id: string) => {
        if (typeof window !== "undefined" && id) {
          localStorage.setItem("eventra_active_event_id", id);
          window.dispatchEvent(new CustomEvent("eventra_event_changed", { detail: { eventId: id } }));
        }
        set({ activeEventId: isRealEventId(id) ? id : null });
      },
      setActiveEvent: (event: EventResponse | null) =>
        set((state) => {
          if (event && typeof window !== "undefined") {
            localStorage.setItem("eventra_active_event_id", event.id);
            window.dispatchEvent(new CustomEvent("eventra_event_changed", { detail: { eventId: event.id } }));
          }
          return {
            activeEvent: event,
            activeEventId: event ? event.id : state.activeEventId,
          };
        }),
      setEventsList: (events: EventResponse[]) => set({ eventsList: events }),
    }),
    {
      name: "eventra_active_event_storage",
      version: 1,
      // v0 persisted "conference_demo" as the default — drop phantom ids.
      migrate: (persisted: any) => {
        if (persisted && !isRealEventId(persisted.activeEventId)) persisted.activeEventId = null;
        return persisted;
      },
    }
  )
);

/** The active event id, or "" when the user has no (real) active event. */
export function getActiveEventId(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("eventra_active_event_id");
    if (isRealEventId(stored)) return stored;
  }
  const id = useEventStore.getState().activeEventId;
  return isRealEventId(id) ? id : "";
}

export function setActiveEventId(id: string) {
  useEventStore.getState().setActiveEventId(id);
}
