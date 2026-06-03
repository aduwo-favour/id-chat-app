// push-notify.js
// Fires a push notification by calling your free Vercel notifier endpoint.
// Fire-and-forget: never blocks the UI and never throws.

import { auth } from "./firebase.js";

// ⬇️ After you deploy the notifier to Vercel, paste its URL here:
const NOTIFY_ENDPOINT = "https://YOUR-NOTIFIER.vercel.app/api/notify";

export async function notifyPush(payload) {
  try {
    if (!NOTIFY_ENDPOINT || NOTIFY_ENDPOINT.includes("YOUR-NOTIFIER")) return; // not configured yet
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    // Don't await the response in a way that blocks the caller's flow.
    await fetch(NOTIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, ...payload })
    });
  } catch (e) {
    console.warn("Push notify failed:", e);
  }
}
