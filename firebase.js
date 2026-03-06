// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEPEEQR63z_Dym50j3mS46ZyzPgMLbsi0",
  authDomain: "chat-messaging-abaa9.firebaseapp.com",
  projectId: "chat-messaging-abaa9",
  storageBucket: "chat-messaging-abaa9.appspot.com",
  messagingSenderId: "625429860180", // IMPORTANT: Add this!
  appId: "1:625429860180:web:6719187a4eaa0be53d82c1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize messaging
export let messaging = null;
try {
  messaging = getMessaging(app);
  console.log('Firebase Messaging initialized');
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
    console.log('Requesting notification permission...');
    
    // Check if browser supports notifications
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return null;
    }
    
    // Check current permission
    if (Notification.permission === 'denied') {
      console.log('Notification permission denied');
      return null;
    }
    
    // If already granted, just get token
    if (Notification.permission === 'granted') {
      const token = await getToken(messaging, { 
        vapidKey: 'BCdXGHDstKoy4Zgvbmiaw8Cx8eSOE0Y9rQT8D_h3nbxLtg3xhtP-d5pOyTSimNac3J_lW3PL2uj7e4jX8R1YvqM' // Your VAPID key
      });
      console.log('FCM Token (existing):', token);
      return token;
    }
    
    // Request permission
    const permission = await Notification.requestPermission();
    console.log('Notification permission result:', permission);
    
    if (permission === 'granted') {
      const token = await getToken(messaging, { 
        vapidKey: 'BCdXGHDstKoy4Zgvbmiaw8Cx8eSOE0Y9rQT8D_h3nbxLtg3xhtP-d5pOyTSimNac3J_lW3PL2uj7e4jX8R1YvqM'
      });
      console.log('FCM Token (new):', token);
      return token;
    } else {
      console.log('Notification permission denied');
      return null;
    }
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
      console.log('Foreground message received:', payload);
      callback(payload);
    });
  } catch (error) {
    console.error('Error setting up foreground message handler:', error);
  }
};
