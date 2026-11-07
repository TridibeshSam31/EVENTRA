"use client";

import React, { useState, useEffect } from "react";
import { Bell, BellRing, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { registerPushSubscription, isPushSubscribed } from "@/lib/push";

const DISMISSAL_STORAGE_KEY = "eventra_push_banner_dismissed";

export function PushNotificationBanner() {
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] = useState<string>("default");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = localStorage.getItem(DISMISSAL_STORAGE_KEY);
        if (stored === "true") {
          setDismissed(true);
        }
      }
    } catch {
      // localStorage may fail in restricted/private contexts
    }

    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }

    isPushSubscribed()
      .then((sub) => setSubscribed(sub))
      .catch(() => setSubscribed(false));
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(DISMISSAL_STORAGE_KEY, "true");
      }
    } catch {
      // Ignore storage errors in sandboxed environments
    }
  };

  const handleEnablePush = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await registerPushSubscription();
      setLoading(false);
      if (res.success) {
        setSubscribed(true);
        if (typeof window !== "undefined" && "Notification" in window) {
          setPermission(Notification.permission);
        }
      } else {
        setErrorMessage(res.error || "Could not enable push notifications.");
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err?.message || "Failed to register push notifications.");
    }
  };

  // Only show when mounted, not dismissed, Notification.permission === "default",
  // and user has no active subscription.
  if (!mounted || dismissed || permission !== "default" || subscribed !== false) {
    return null;
  }

  return (
    <div className="surface-ink relative overflow-hidden p-4 shadow-md">
      <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-60" aria-hidden />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-standby-500/15 text-standby-400 ring-1 ring-standby-500/30">
            <BellRing className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-ink-50">Get approvals on your phone</h4>
              <span className="chip border-standby-500/30 bg-standby-500/10 text-standby-300">Recommended</span>
            </div>
            <p className="mt-0.5 max-w-[70ch] text-[12.5px] text-ink-300">
              Push and WhatsApp alerts when something needs your sign-off — so the agent is never stuck waiting for you at a laptop.
            </p>
            <p className="mt-1 flex items-center gap-1 text-[11.5px] text-ink-500">
              <Smartphone className="h-3.5 w-3.5" />
              <span>
                <strong className="text-ink-400">iPhone:</strong> add EVENTRA to your home screen first (Share → Add to Home Screen).
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button onClick={handleEnablePush} disabled={loading} className="btn h-8 bg-ink-50 px-3 text-[12px] text-ink-900 hover:bg-white">
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Enabling...</span>
              </>
            ) : (
              <>
                <Bell className="h-3.5 w-3.5" />
                <span>Enable Push Notifications</span>
              </>
            )}
          </button>
          <button
            onClick={handleDismiss}
            className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-ink-400 hover:bg-white/5 hover:text-ink-100"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" className="relative mt-2.5 flex items-center gap-1.5 rounded-md border border-cue-800/50 bg-cue-950/60 px-3 py-1.5 text-[12px] text-cue-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-cue-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
