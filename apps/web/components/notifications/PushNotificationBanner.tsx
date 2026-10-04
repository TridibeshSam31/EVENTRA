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
    <div className="relative overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-4 shadow-lg backdrop-blur-md transition-all">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
            <BellRing className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-100">
                Remote Approval Notifications
              </h4>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/30">
                Setup Recommended
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-300">
              Get notified on your phone push and WhatsApp when operations require sign-off. Never sit at your laptop to unblock the agent.
            </p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
              <Smartphone className="h-3.5 w-3.5 text-slate-400" />
              <span>
                <strong>iPhone / iOS note:</strong> Web push requires installing EVENTRA to your home screen (Tap <em>Share</em> → <em>Add to Home Screen</em>).
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={handleEnablePush}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 disabled:opacity-50 cursor-pointer"
          >
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
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 text-xs cursor-pointer"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-rose-950/50 px-3 py-1.5 text-xs text-rose-300 border border-rose-800/40">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
