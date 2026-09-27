"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Calendar,
  MapPin,
  Users,
  PlusCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  Radio,
} from "lucide-react";
import { listEvents } from "@/lib/api/events";
import type { EventResponse } from "@/types/api";

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
            Fleet Operations
          </span>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
            Registered Event Workspaces
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Active and configured event operations running on the EVENTRA adaptive runtime.
          </p>
        </div>

        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          Create New Event
        </Link>
      </div>

      {/* Events Grid */}
      {loading ? (
        <div className="p-16 text-center text-slate-400 bg-white rounded-xl border border-slate-200 shadow-sm">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#D6003C]" />
          <p className="text-xs font-medium text-slate-600">Loading operational events…</p>
        </div>
      ) : events.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">No Events Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              No events are currently registered. Initialize a new event protocol to start autonomous planning and live operations.
            </p>
          </div>
          <Link
            href="/events/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Initialize Event
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {events.map((ev) => {
            const curr = ev.currency === "INR" || !ev.currency ? "₹" : `${ev.currency} `;
            const isLive = ev.lifecycle_state === "LIVE" || ev.state === "NORMAL";

            return (
              <Link
                key={ev.id}
                href={`/events/${ev.id}`}
                className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                      {ev.id.slice(0, 12)}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        ev.lifecycle_state === "LIVE"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {ev.lifecycle_state || "PLANNED"}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 group-hover:text-[#D6003C] transition leading-snug">
                    {ev.name}
                  </h3>

                  {ev.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      {ev.description}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-600">
                    <div className="flex items-center gap-1.5 truncate">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{ev.location || "Location unset"}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{ev.guest_count ? `${ev.guest_count.toLocaleString()} guests` : "Capacity unset"}</span>
                    </div>

                    <div className="flex items-center gap-1.5 truncate col-span-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        {ev.start_datetime
                          ? new Date(ev.start_datetime).toLocaleDateString()
                          : "Date not scheduled"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-slate-800">
                    {ev.total_budget != null ? `${curr}${Number(ev.total_budget).toLocaleString()}` : "Budget Unset"}
                  </span>
                  <span className="text-[#D6003C] font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Enter Workspace <ArrowRight className="w-3.5 h-3.5" />
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
