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
  appId: "1:625429860180:web:6719187a4eaa0be53d82c1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

export const requestNotificationPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, { vapidKey: 'BCdXGHDstKoy4Zgvbmiaw8Cx8eSOE0Y9rQT8D_h3nbxLtg3xhtP-d5pOyTSimNac3J_lW3PL2uj7e4jX8R1YvqM' }); // Get VAPID key from Firebase Console
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
  onMessage(messaging, (payload) => {
    callback(payload);
  });
};

