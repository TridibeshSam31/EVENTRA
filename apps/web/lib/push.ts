"use client";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getVapidPublicKey(): Promise<string> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
  try {
    const res = await fetch(`${apiUrl}/notifications/push/vapid-public-key`);
    if (!res.ok) throw new Error("Failed to fetch VAPID public key");
    const data = await res.json();
    return data.public_key;
  } catch {
    return "MOCK_VAPID_KEY";
  }
}

export async function registerPushSubscription(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { success: false, error: "Web Push is not supported by this browser." };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, error: "Notification permission was denied." };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const publicKey = await getVapidPublicKey();
      const convertedKey = urlBase64ToUint8Array(
        publicKey.length > 20
          ? publicKey
          : "BEl4w-sK6Qo1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef"
      );

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as any,
      });
    }

    const subJson = subscription.toJSON();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
    const xUserId = localStorage.getItem("eventra_user_id") || "test_organizer";

    const payload = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh || "",
        auth: subJson.keys?.auth || "",
      },
      user_agent: navigator.userAgent,
    };

    const res = await fetch(`${apiUrl}/notifications/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": xUserId,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Backend registration failed: ${err}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to subscribe to Web Push." };
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
