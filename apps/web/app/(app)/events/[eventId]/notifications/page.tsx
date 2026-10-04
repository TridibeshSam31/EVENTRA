"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Bell, Smartphone, ShieldCheck } from "lucide-react";
import { PushNotificationBanner } from "@/components/notifications";
import { EventShell } from "@/components/v2/EventShell";

export default function NotificationsPage() {
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              Notification Preferences
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-600" />
            Remote Approval & Alert Settings
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure how you receive urgent operational requests, remote sign-offs, and critical incident alerts.
          </p>
        </div>

        {/* Remote Push Notification Banner */}
        <PushNotificationBanner />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">WhatsApp Inbound Webhook</h3>
                <p className="text-xs text-slate-500">Reply YES &lt;CODE&gt; or NO &lt;CODE&gt; via WhatsApp</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              When critical decisions require approval, EVENTRA dispatches WhatsApp messages with a 6-character reply code.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Mobile Web Push (PWA)</h3>
                <p className="text-xs text-slate-500">Direct notifications on mobile devices</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              Enable Web Push to receive background notifications with single-tap deep links directly to approval decisions.
            </p>
          </div>
        </div>
      </div>
    </EventShell>
  );
}
