import { initializeApp } from 
"https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";

import { getAuth } from 
"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import { 
  getFirestore, 
  enableIndexedDbPersistence 
} from 
"https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { getStorage } from
"https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";

/* ================= FIREBASE CONFIG ================= */

const firebaseConfig = {
  apiKey: "AIzaSyBEPEEQR63z_Dym50j3mS46ZyzPgMLbsi0",
  authDomain: "chat-messaging-abaa9.firebaseapp.com",
  projectId: "chat-messaging-abaa9",
  storageBucket: "chat-messaging-abaa9.appspot.com", // 🔥 REQUIRED
  appId: "1:625429860180:web:6719187a4eaa0be53d82c1"
};

/* ================= INITIALIZE ================= */

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ================= ENABLE OFFLINE CACHE ================= */

enableIndexedDbPersistence(db)
  .then(() => {
    console.log("🔥 Firestore offline cache enabled");
  })
  .catch((err) => {

    if (err.code === "failed-precondition") {
      console.log("⚠ Multiple tabs open, cache disabled");
    } else if (err.code === "unimplemented") {
      console.log("⚠ Browser does not support offline cache");
    } else {
      console.log("Cache error:", err.code);
    }

  });
