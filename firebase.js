// firebase.js
// ⚠️  SECURITY REMINDER: Do NOT commit this file with real credentials to a public repo.
//     Add firebase.js (or just the apiKey values) to .gitignore,
//     or use environment variable injection at build time.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

// SECURITY: Replace these with your actual values, then keep this file out of source control.
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

// SECURITY: Keep your VAPID key separate too — never commit it publicly
const VAPID_KEY = "REPLACE_WITH_YOUR_VAPID_KEY";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize messaging
export let messaging = null;
try {
  messaging = getMessaging(app);
} catch (error) {
  console.error('Firebase Messaging initialization failed:', error);
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((err) => {
        console.log('Service Worker registration failed:', err);
      });
  });
}

export const requestNotificationPermission = async () => {
  if (!messaging) return null;

  try {
    if (!('Notification' in window)) return null;
    if (Notification.permission === 'denied') return null;

    if (Notification.permission === 'granted') {
      return await getToken(messaging, { vapidKey: VAPID_KEY });
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      return await getToken(messaging, { vapidKey: VAPID_KEY });
    }
    return null;
  } catch (error) {
    console.error('Error getting notification token:', error);
    return null;
  }
};

export const onForegroundMessage = (callback) => {
  if (!messaging) return;
  try {
    onMessage(messaging, (payload) => {
      callback(payload);
    });
  } catch (error) {
    console.error('Error setting up foreground message handler:', error);
  }
};
