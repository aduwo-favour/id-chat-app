// cache.js — lightweight sessionStorage cache for instant page loads
// Data is cached per-session (cleared when tab closes) so it's always
// reasonably fresh. Firestore listeners update the UI in the background.

const PREFIX = 'chatapp_';
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export const Cache = {
  set(key, value) {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify({
        v: value,
        t: Date.now()
      }));
    } catch (e) {
      // sessionStorage full or unavailable — fail silently
    }
  },

  get(key, maxAgeMs = TTL_MS) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const { v, t } = JSON.parse(raw);
      if (Date.now() - t > maxAgeMs) {
        sessionStorage.removeItem(PREFIX + key);
        return null;
      }
      return v;
    } catch (e) {
      return null;
    }
  },

  del(key) {
    try { sessionStorage.removeItem(PREFIX + key); } catch (e) {}
  },

  clear() {
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(PREFIX))
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) {}
  }
};
