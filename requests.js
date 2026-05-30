import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  collection, query, where, onSnapshot,
  doc, deleteDoc, getDoc, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

window.goBack = function() { window.location.href = 'dashboard.html'; };

let currentUsername = null, currentUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentUsername = userDoc.data().username;
      document.getElementById('requestsList').innerHTML = '<div class="loading">Loading...</div>';
      loadRequests();
    }
  } catch (error) { console.error('Auth error:', error); }
});

function loadRequests() {
  if (!currentUsername) { setTimeout(loadRequests, 1000); return; }
  try {
    const q = query(collection(db, "requests"), where("to", "==", currentUsername));
    onSnapshot(q, (snap) => {
      const list = document.getElementById('requestsList');
      const pending = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.status === 'pending') pending.push({ id: d.id, ...data });
      });
      pending.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      list.innerHTML = '';

      if (pending.length === 0) {
        list.innerHTML = '<div class="no-requests">No pending requests</div>';
        return;
      }

      // SECURITY: Build DOM nodes instead of innerHTML with user-controlled `r.from`
      // A malicious username like <img src=x onerror=alert(1)> would execute if we used innerHTML
      pending.forEach(r => {
        const item = document.createElement('div');
        item.className = 'request-item';
        item.dataset.id = r.id;

        const avatar = document.createElement('div');
        avatar.className = 'request-avatar';
        avatar.textContent = r.from ? r.from[0].toUpperCase() : '?';   // textContent — safe

        const details = document.createElement('div');
        details.className = 'request-details';

        const fromEl = document.createElement('div');
        fromEl.className = 'request-from';
        fromEl.textContent = r.from || 'Unknown';                        // textContent — safe

        const msgEl = document.createElement('div');
        msgEl.className = 'request-message';
        msgEl.textContent = 'Wants to chat with you';

        const timeEl = document.createElement('div');
        timeEl.className = 'request-time';
        timeEl.textContent = formatTime(r.createdAt);

        details.appendChild(fromEl);
        details.appendChild(msgEl);
        details.appendChild(timeEl);

        const actions = document.createElement('div');
        actions.className = 'request-actions';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'accept-btn';
        acceptBtn.textContent = '✓ Accept';
        acceptBtn.addEventListener('click', () => acceptRequest(r.id, r.from));

        const declineBtn = document.createElement('button');
        declineBtn.className = 'decline-btn';
        declineBtn.textContent = '✕ Decline';
        declineBtn.addEventListener('click', () => declineRequest(r.id));

        actions.appendChild(acceptBtn);
        actions.appendChild(declineBtn);

        item.appendChild(avatar);
        item.appendChild(details);
        item.appendChild(actions);
        list.appendChild(item);
      });
    }, (error) => {
      document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading requests</div>';
      console.error('Requests listener error:', error);
    });
  } catch (error) {
    console.error('loadRequests error:', error);
  }
}

function formatTime(ts) {
  if (!ts) return 'Recently';
  try {
    const d = new Date(ts);
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} minutes ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
    return d.toLocaleDateString();
  } catch (e) { return 'Recently'; }
}

window.acceptRequest = async function(reqId, fromUser) {
  try {
    // SECURITY: Validate that the sender's username only contains safe characters
    if (!fromUser || !/^[a-zA-Z0-9_]{3,30}$/.test(fromUser)) {
      alert('Invalid request');
      return;
    }

    const chatId = [currentUsername, fromUser].sort().join('_');
    const q = query(collection(db, "users"), where("username", "==", fromUser));
    const userSnap = await getDocs(q);
    if (!userSnap.empty && userSnap.docs[0].data().blockedUsers?.includes(currentUsername)) {
      alert('You are blocked by this user');
      return;
    }
    await setDoc(doc(db, "chats", chatId), {
      participants: [currentUsername, fromUser],
      createdAt: new Date().toISOString(),
      unread: {}, status: "accepted", isBlocked: false
    });
    await deleteDoc(doc(db, "requests", reqId));
    window.location.href = `chat.html?chatId=${encodeURIComponent(chatId)}&user=${encodeURIComponent(fromUser)}`;
  } catch (error) {
    alert('Failed to accept request');
    console.error('acceptRequest error:', error);
  }
};

window.declineRequest = async function(reqId) {
  if (!confirm('Decline?')) return;
  try {
    await deleteDoc(doc(db, "requests", reqId));
  } catch (error) {
    console.error('declineRequest error:', error);
  }
};
