// Resolves a username to its current display name (falls back to the username).
// Render code keys on the immutable @username for identity; this only changes
// what's SHOWN, and stays current because it resolves at render time.
import { db } from "./firebase.js";
import {
  collection, query, where, getDocs, limit
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const _cache = new Map();   // lowercased username -> displayName
const _pending = new Map();

export async function resolveDisplayName(username) {
  if (!username) return username;
  const key = String(username).toLowerCase();
  if (_cache.has(key)) return _cache.get(key);
  if (_pending.has(key)) return _pending.get(key);

  const p = (async () => {
    let dn = username;
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("username", "==", username), limit(1))
      );
      if (!snap.empty) {
        const d = snap.docs[0].data();
        dn = d.displayName || d.username || username;
      }
    } catch (e) { /* fall back to username */ }
    _cache.set(key, dn);
    _pending.delete(key);
    return dn;
  })();

  _pending.set(key, p);
  return p;
}

// Show the username immediately, then swap to the display name once resolved.
export function applyDisplayName(el, username) {
  if (!el || !username) return;
  el.textContent = username;
  resolveDisplayName(username).then(dn => { if (dn && dn !== username) el.textContent = dn; });
}

// Resolve every element carrying a data-uname attribute inside `root`.
export function hydrateNames(root) {
  if (!root) return;
  root.querySelectorAll('[data-uname]').forEach(el =>
    applyDisplayName(el, el.getAttribute('data-uname'))
  );
}

export function clearDisplayNameCache() { _cache.clear(); }
