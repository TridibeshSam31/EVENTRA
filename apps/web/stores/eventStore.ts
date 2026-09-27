"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EventResponse } from "../types/api";

interface EventStoreState {
  activeEventId: string;
  activeEvent: EventResponse | null;
  eventsList: EventResponse[];
  setActiveEventId: (id: string) => void;
  setActiveEvent: (event: EventResponse | null) => void;
  setEventsList: (events: EventResponse[]) => void;
}

export const useEventStore = create<EventStoreState>()(
  persist(
    (set) => ({
      activeEventId: "conference_demo",
      activeEvent: null,
      eventsList: [],
      setActiveEventId: (id: string) => {
        if (typeof window !== "undefined" && id) {
          localStorage.setItem("eventra_active_event_id", id);
          window.dispatchEvent(new CustomEvent("eventra_event_changed", { detail: { eventId: id } }));
        }
        set({ activeEventId: id });
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
    }
  )
);

export function getActiveEventId(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("eventra_active_event_id");
    if (stored) return stored;
  }
  return useEventStore.getState().activeEventId || "conference_demo";
}

export function setActiveEventId(id: string) {
  useEventStore.getState().setActiveEventId(id);
}
