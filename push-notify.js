// push-notify.js
// Fires a push notification by calling your free Vercel notifier endpoint.
// Fire-and-forget: never blocks the UI and never throws.

import { auth } from "./firebase.js";

// ┌─────────────────────────────────────────────────────────────────────┐
// │  SET THIS to your deployed notifier URL (ends in /api/notify).        │
// │  You get it from Vercel after deploying the notifier-vercel project,  │
// │  e.g. "https://chat-notifier-abc123.vercel.app/api/notify".           │
// └─────────────────────────────────────────────────────────────────────┘
const NOTIFY_ENDPOINT = "https://id-notifier.vercel.app/api/notify";

// True until you replace the placeholder above. Keeps the app from
// firing pointless requests before the notifier is configured.
function isConfigured() {
  return NOTIFY_ENDPOINT && !NOTIFY_ENDPOINT.includes("YOUR-NOTIFIER");
}

export async function notifyPush(payload) {
  try {
    if (!isConfigured()) {
      console.warn("[push-notify] NOTIFY_ENDPOINT not set yet — skipping push.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    // Fire-and-forget. We don't block the send flow on the network round-trip.
    await fetch(NOTIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, ...payload }),
      keepalive: true, // let the request finish even if the tab is closing
    });
  } catch (e) {
    console.warn("Push notify failed:", e);
  }
}
