"use client";

import React from "react";
import {
  Clock,
  Check,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Send,
} from "lucide-react";

export type WhatsAppStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "UNKNOWN";

interface WhatsAppDeliveryStatusProps {
  status?: string | null;
  timestamp?: string | null;
  showLabel?: boolean;
  className?: string;
}

export function normalizeWhatsAppStatus(rawStatus?: string | null): WhatsAppStatus {
  if (!rawStatus) return "UNKNOWN";
  const s = rawStatus.toUpperCase().trim();
  if (s === "QUEUED" || s === "PENDING") return "QUEUED";
  if (s === "SENT") return "SENT";
  if (s === "DELIVERED") return "DELIVERED";
  if (s === "READ" || s === "SEEN") return "READ";
  if (s === "FAILED" || s === "UNDELIVERED" || s === "ERROR") return "FAILED";
  return "UNKNOWN";
}

export function WhatsAppDeliveryStatus({
  status,
  timestamp,
  showLabel = true,
  className = "",
}: WhatsAppDeliveryStatusProps) {
  const normStatus = normalizeWhatsAppStatus(status);

  const config = {
    QUEUED: {
      label: "Queued",
      icon: Clock,
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200/80",
      iconClass: "text-amber-600",
    },
    SENT: {
      label: "Sent",
      icon: Send,
      badgeClass: "bg-blue-50 text-blue-700 border-blue-200/80",
      iconClass: "text-blue-600",
    },
    DELIVERED: {
      label: "Delivered",
      icon: Check,
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
      iconClass: "text-emerald-600",
    },
    READ: {
      label: "Read",
      icon: CheckCircle2,
      badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
      iconClass: "text-emerald-700",
    },
    FAILED: {
      label: "Failed",
      icon: AlertCircle,
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200/80",
      iconClass: "text-rose-600",
    },
    UNKNOWN: {
      label: "Delivery status unavailable",
      icon: HelpCircle,
      badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
      iconClass: "text-slate-400",
    },
  }[normStatus];

  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.badgeClass} ${className}`}
      title={timestamp ? `Status updated at ${new Date(timestamp).toLocaleTimeString()}` : undefined}
    >
      <Icon className={`w-3 h-3 ${config.iconClass}`} />
      {showLabel && <span>{config.label}</span>}
      {timestamp && (
        <span className="text-[9px] text-slate-400 font-mono ml-0.5">
          {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </span>
  );
}
