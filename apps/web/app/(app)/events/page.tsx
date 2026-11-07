"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Calendar, MapPin, Users, Plus, ArrowRight, CalendarPlus } from "lucide-react";
import { listEvents } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";
import { PageHeader, CueChip, EmptyState } from "@/components/ds";

const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNED: "Planning",
  PLANNING: "Planning",
  READY: "Ready",
  LIVE: "Happening now",
  COMPLETED: "Finished",
  CONCLUDED: "Finished",
  CANCELLED: "Cancelled",
};

export default function EventsListPage() {
  const [events, setEvents] = useState<EventResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await listEvents();
        setEvents(data || []);
      } catch (err) {
        console.error("Failed to load events:", err);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={loading ? "Events" : `Events · ${events.length}`}
        title="All events"
        description="Every event EVENTRA is planning or running for you."
        actions={
          <Link href="/events/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Create New Event
          </Link>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="workspace-shimmer h-[210px] rounded-xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="h-5 w-5" />}
          title="No events yet"
          description="Describe your first event and EVENTRA will build the plan, find vendors and help you run the day."
          action={
            <Link href="/events/new" className="btn-cue">
              <Plus className="h-4 w-4" />
              Plan an event
            </Link>
          }
        />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((ev) => {
            const curr = ev.currency === "INR" || !ev.currency ? "₹" : `${ev.currency} `;
            const isLive = ev.lifecycle_state === "LIVE";
            const lifecycle = LIFECYCLE_LABELS[(ev.lifecycle_state || "").toUpperCase()] || "Planning";

            return (
              <Link
                key={ev.id}
                href={`/events/${ev.id}`}
                className="group flex flex-col justify-between rounded-xl border border-ink-200 bg-[#FDFCFA] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lg"
              >
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <CueChip tone={isLive ? "cue" : "idle"} pulse={isLive}>
                      {lifecycle}
                    </CueChip>
                    <span className="font-mono text-[10px] text-ink-400">{ev.id.slice(0, 8)}</span>
                  </div>

                  <h3
                    className="font-display text-[20px] font-bold leading-[1.1] tracking-[-0.015em] text-ink-900"
                    style={{ fontStretch: "90%" }}
                  >
                    {ev.name}
                  </h3>

                  {ev.description && (
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-500">{ev.description}</p>
                  )}

                  <div className="mt-4 space-y-1.5 border-t border-dashed border-ink-200 pt-3 text-[12px] text-ink-600">
                    <div className="flex items-center gap-2 truncate">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      {ev.start_datetime ? (
                        new Date(ev.start_datetime).toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      ) : (
                        <span className="text-ink-400">Date not scheduled</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      {ev.location ? <span className="truncate">{ev.location}</span> : <span className="text-ink-400">Location unset</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      {ev.guest_count ? `${ev.guest_count.toLocaleString()} guests` : <span className="text-ink-400">Capacity unset</span>}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-ink-200 pt-3">
                  <span className="font-mono text-[12px] font-semibold text-ink-800">
                    {ev.total_budget != null ? `${curr}${Number(ev.total_budget).toLocaleString()}` : <span className="text-ink-400">Budget unset</span>}
                  </span>
                  <span className="flex items-center gap-1 text-[12.5px] font-semibold text-ink-700 transition group-hover:translate-x-0.5 group-hover:text-ink-900">
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
