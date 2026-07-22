// enable-notifications.js
// Drop-in helper that reliably asks the user to allow notifications.
//
// Why this exists: browsers IGNORE Notification.requestPermission() when it's
// called automatically on page load (no user gesture), which is why the prompt
// wasn't showing. This shows a small banner with an "Enable" button, and fires
// the real permission request from the button TAP — which browsers honor.
//
// Usage on any page, after you know the signed-in user's uid:
//   import { initNotifications } from "./enable-notifications.js";
//   initNotifications(user.uid);

import { auth, db, requestNotificationPermission } from "./firebase.js";
import {
  doc,
  updateDoc,
  setDoc,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const BANNER_ID = "enable-notif-banner";

function supported() {
  return "Notification" in window && "serviceWorker" in navigator;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// Gets a token (prompting only if called from a user gesture) and saves it.
async function saveToken(uid) {
  const token = await requestNotificationPermission();
  if (token && uid) {
    await setDoc(doc(db, "users", uid, "private", "meta"), { fcmTokens: arrayUnion(token) }, { merge: true });
  }
  return token;
}

function removeBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

function showBanner({ text, actionLabel, onAction }) {
  removeBanner();

  const bar = document.createElement("div");
  bar.id = BANNER_ID;
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;gap:12px;" +
    "align-items:center;justify-content:center;padding:12px 16px;flex-wrap:wrap;" +
    "background:#1f2233;color:#fff;font:14px/1.4 system-ui,-apple-system,sans-serif;" +
    "box-shadow:0 -2px 12px rgba(0,0,0,.35)";

  const span = document.createElement("span");
  span.textContent = text;
  span.style.cssText = "max-width:520px;text-align:center";
  bar.appendChild(span);

  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.textContent = actionLabel;
    btn.style.cssText =
      "background:#6c5ce7;color:#fff;border:0;border-radius:8px;padding:8px 16px;" +
      "font-weight:600;cursor:pointer";
    btn.addEventListener("click", onAction);
    bar.appendChild(btn);
  }

  const close = document.createElement("button");
  close.textContent = "✕";
  close.setAttribute("aria-label", "Dismiss");
  close.style.cssText =
    "background:transparent;color:#aab;border:0;font-size:16px;cursor:pointer;line-height:1";
  close.addEventListener("click", removeBanner);
  bar.appendChild(close);

  document.body.appendChild(bar);
}

export async function initNotifications(uid) {
  if (!supported() || !uid) return;

  const perm = Notification.permission;

  // Already allowed: just (re)register the token. getToken does NOT prompt.
  if (perm === "granted") {
    try {
      await saveToken(uid);
    } catch (e) {
      console.warn("[notif] token save failed:", e);
    }
    return;
  }

  // iOS Safari only delivers web push from an installed Home-Screen PWA.
  if (isIOS() && !isStandalone()) {
    showBanner({
      text:
        "To get notifications on iPhone: tap Share → Add to Home Screen, " +
        "then open the app from that icon and allow notifications.",
    });
    return;
  }

  // Previously blocked: the browser won't let us re-prompt. Guide to settings.
  if (perm === "denied") {
    showBanner({
      text:
        "Notifications are blocked. Tap the lock icon next to the address bar → " +
        "Notifications → Allow, then reload the page.",
    });
    return;
  }

  // Not asked yet ("default"): show a button. The TAP fires the real prompt.
  showBanner({
    text: "Turn on notifications so you don't miss new messages.",
    actionLabel: "Enable",
    onAction: async () => {
      try {
        const token = await saveToken(uid);
        if (token) {
          removeBanner();
        } else if (Notification.permission === "denied") {
          showBanner({
            text:
              "You blocked notifications. Enable them in your browser's site " +
              "settings, then reload.",
          });
        }
      } catch (e) {
        console.warn("[notif] enable failed:", e);
      }
    },
  });
}
