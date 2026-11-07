"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronsUpDown, Plus, Check } from "lucide-react";
import { listEvents } from "../../lib/api/events";
import type { EventResponse } from "../../types/api";

import { useEventStore, getActiveEventId, isRealEventId } from "@/stores/eventStore";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function prettyType(t?: string) {
  return (t || "Event").replace(/_/g, " ").toLowerCase();
}

export function EventSwitcher({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const router = useRouter();
  const params = useParams();
  const { activeEventId, setActiveEventId } = useEventStore();
  const [currentEventId, setCurrentEventId] = useState<string>(activeEventId || "");

  // Only real events from the backend — never built-in demo events.
  const [events, setEvents] = useState<Array<{ id: string; name: string; event_type?: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (params?.eventId && typeof params.eventId === "string" && isRealEventId(params.eventId)) {
      setActiveEventId(params.eventId);
      setCurrentEventId(params.eventId);
    } else {
      const stored = getActiveEventId();
      if (stored) {
        setCurrentEventId(stored);
      }
    }
  }, [params?.eventId, activeEventId, setActiveEventId]);

  useEffect(() => {
    async function loadEvents() {
      const realEvents: EventResponse[] = await listEvents();
      setEvents((realEvents || []).filter((e) => isRealEventId(e.id)));
      setLoaded(true);
    }
    loadEvents();
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const activeEvent = events.find((e) => e.id === currentEventId) || null;

  const handleSelect = (eventId: string) => {
    setIsOpen(false);
    setActiveEventId(eventId);
    setCurrentEventId(eventId);
    router.push(`/events/${eventId}`);
  };

  const dark = tone === "dark";

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group w-full flex items-center gap-2.5 rounded-lg p-1.5 pr-2 text-left transition ${
          dark
            ? "bg-white/[0.04] hover:bg-white/[0.07] ring-1 ring-white/[0.06]"
            : "bg-[#FDFCFA] ring-1 ring-ink-200 hover:ring-ink-300 shadow-sm"
        }`}
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md font-display text-[12px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ${
            activeEvent ? "bg-cue-600 text-white" : dark ? "bg-white/10 text-ink-300" : "bg-ink-100 text-ink-600"
          }`}
        >
          {activeEvent ? initials(activeEvent.name) : "—"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] font-semibold leading-tight ${dark ? "text-ink-50" : "text-ink-900"}`}>
            {activeEvent ? activeEvent.name : events.length > 0 ? "Choose an event" : loaded ? "No events yet" : "Loading events…"}
          </span>
          <span className={`block truncate text-[11px] ${activeEvent ? "capitalize" : ""} ${dark ? "text-ink-400" : "text-ink-600"}`}>
            {activeEvent ? prettyType(activeEvent.event_type) : events.length > 0 ? `${events.length} events` : "Plan one to get started"}
          </span>
        </span>
        <ChevronsUpDown className={`h-3.5 w-3.5 shrink-0 ${dark ? "text-ink-500 group-hover:text-ink-300" : "text-ink-400"}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 animate-rise-in rounded-xl border border-ink-200 bg-[#FDFCFA] p-1.5 text-ink-800 shadow-xl"
        >
          <div className="eyebrow px-2 pb-1.5 pt-1">Switch event</div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {events.length === 0 && (
              <p className="px-2 py-2 text-[12.5px] text-ink-600">
                {loaded ? "You haven't planned any events yet." : "Loading your events…"}
              </p>
            )}
            {events.map((ev) => {
              const selected = ev.id === currentEventId;
              return (
                <button
                  key={ev.id}
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(ev.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                    selected ? "bg-ink-100" : "hover:bg-ink-50"
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-ink-900 font-display text-[10px] font-bold text-ink-50">
                    {initials(ev.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink-900">{ev.name}</span>
                    <span className="block text-[10.5px] capitalize text-ink-500">{prettyType(ev.event_type)}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 text-cue-600" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-ink-200 pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                router.push("/events/new");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] font-semibold text-ink-700 transition hover:bg-ink-50 hover:text-ink-900"
            >
              <Plus className="h-3.5 w-3.5" />
              Plan a new event
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
