// firebase.js
// SECURITY: Load config from a separate, gitignored config file or environment.
// Never commit real API keys to source control.
// Create a `firebase-config.js` file (gitignored) that exports firebaseConfig,
// OR inject these values at build/deploy time via your CI/CD pipeline.
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

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
  if (!messaging) {
    console.log('Messaging not available');
    return null;
  }

  try {
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return null;
    }

    if (Notification.permission === 'denied') {
      console.log('Notification permission denied');
      return null;
    }

    // SECURITY: VAPID key loaded from config, not hardcoded
    const { vapidKey } = firebaseConfig;

    if (Notification.permission === 'granted') {
      const token = await getToken(messaging, { vapidKey });
      return token;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, { vapidKey });
      return token;
    }
    return null;
  } catch (error) {
    console.error('Error getting notification token:', error);
    return null;
  }
};

// Handle foreground messages
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
