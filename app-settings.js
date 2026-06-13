// app-settings.js
// Reads the admin "globalSettings" doc and provides enforcement helpers so the
// Admin Panel toggles actually take effect across the app. Cached after first read.

import { db, auth } from "./firebase.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

let cached = null;

// Sensible defaults used when a setting hasn't been configured yet.
export const SETTINGS_DEFAULTS = {
  fileUploads: true,
  voiceNotes: true,
  reactions: true,
  communityCreation: true,
  autoFlag: false,
  requireApproval: false,
  signupsEnabled: true,
  maintenanceMode: false,
  maxMessageLength: 2000,
  announcement: "",
  bannedWords: [],
};

const DEFAULT_BANNED_WORDS = ["fuck", "shit", "bitch", "asshole", "bastard"];

export async function getGlobalSettings(force = false) {
  if (cached && !force) return cached;
  try {
    const snap = await getDoc(doc(db, "settings", "globalSettings"));
    cached = { ...SETTINGS_DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
  } catch (e) {
    console.warn("[settings] could not load global settings:", e);
    cached = { ...SETTINGS_DEFAULTS };
  }
  return cached;
}

// LIVE: call `cb(settings)` immediately and again every time an admin changes a
// setting — no page refresh needed. Returns an unsubscribe function.
export function subscribeGlobalSettings(cb) {
  return onSnapshot(
    doc(db, "settings", "globalSettings"),
    snap => {
      cached = { ...SETTINGS_DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
      try { cb(cached); } catch (e) { console.warn("[settings] callback error:", e); }
    },
    err => console.warn("[settings] live listener error:", err)
  );
}

// Replace each banned word (whole word, case-insensitive) with asterisks.
function maskWords(text, words) {
  let out = text;
  for (const raw of words) {
    const w = String(raw).trim();
    if (!w) continue;
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    out = out.replace(re, m => "*".repeat(m.length));
  }
  return out;
}

// Run a message through the active moderation/length rules before sending.
// Returns { ok: true, text } or { ok: false, error }.
export function filterMessage(text, settings = {}) {
  const max = Number(settings.maxMessageLength) || SETTINGS_DEFAULTS.maxMessageLength;
  if (text.length > max) {
    return { ok: false, error: `Message too long (max ${max} characters).` };
  }
  let out = text;
  if (settings.autoFlag) {
    const list = (Array.isArray(settings.bannedWords) && settings.bannedWords.length)
      ? settings.bannedWords
      : DEFAULT_BANNED_WORDS;
    out = maskWords(out, list);
  }
  return { ok: true, text: out };
}


// LIVE maintenance guard for any page: signs out + sends non-admins to login
// the instant maintenance mode is turned on (no refresh). Returns unsubscribe.
export function enforceMaintenance(isAdmin) {
  return subscribeGlobalSettings(s => {
    if (s.maintenanceMode === true && !isAdmin) {
      signOut(auth).catch(() => {});
      window.location.href = 'index.html';
    }
  });
}
