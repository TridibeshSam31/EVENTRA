"use client";

import React from "react";
import { useParams } from "next/navigation";
import { MessageCircle, Smartphone } from "lucide-react";
import { PushNotificationBanner } from "@/components/notifications";
import { EventShell } from "@/components/v2/EventShell";
import { PageHeader } from "@/components/ds";

export default function NotificationsPage() {
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  const channels = [
    {
      icon: MessageCircle,
      tone: "bg-go-50 text-go-700 ring-go-200",
      title: "WhatsApp replies",
      sub: "Reply YES <CODE> or NO <CODE>",
      body: "When a decision needs your approval, EVENTRA sends a WhatsApp message with a 6-character reply code. Reply from anywhere to approve or reject.",
    },
    {
      icon: Smartphone,
      tone: "bg-agent-50 text-agent-700 ring-agent-200",
      title: "Mobile web push",
      sub: "Notifications on your phone",
      body: "Turn on web push to get background alerts with a single tap straight into the approval waiting for you.",
    },
  ];

  return (
    <EventShell eventId={eventId} currentStage="LIVE">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Notifications"
          title="How EVENTRA reaches you"
          description="Urgent requests, remote sign-offs and critical incident alerts — choose how they find you when you're away from the dashboard."
        />

        <PushNotificationBanner />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {channels.map((c) => (
            <div key={c.title} className="surface p-5">
              <div className="flex items-center gap-3">
                <span className={`grid h-9 w-9 place-items-center rounded-lg ring-1 ${c.tone}`}>
                  <c.icon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[14px] font-semibold text-ink-900">{c.title}</h3>
                  <p className="font-mono text-[11px] text-ink-500">{c.sub}</p>
                </div>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-600">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </EventShell>
  );
}
