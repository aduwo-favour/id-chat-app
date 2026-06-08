// app-settings.js
// Reads the admin "globalSettings" doc so feature toggles in the Admin Panel
// actually take effect across the app. Cached after first read.

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let cached = null;

export async function getGlobalSettings() {
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, "settings", "globalSettings"));
    cached = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.warn("[settings] could not load global settings:", e);
    cached = {};
  }
  return cached;
}
