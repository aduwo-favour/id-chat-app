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
  } catch (error) {}
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
      pending.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
      if (pending.length === 0) {
        list.innerHTML = '<div class="no-requests">No pending requests</div>';
        return;
      }
      let html = '';
      pending.forEach(r => {
        html += `
          <div class="request-item" data-id="${r.id}">
            <div class="request-avatar">${r.from ? r.from[0].toUpperCase() : '?'}</div>
            <div class="request-details">
              <div class="request-from">${r.from || 'Unknown'}</div>
              <div class="request-message">Wants to chat with you</div>
              <div class="request-time">${formatTime(r.createdAt)}</div>
            </div>
            <div class="request-actions">
              <button onclick="acceptRequest('${r.id}','${r.from}')" class="accept-btn">✓ Accept</button>
              <button onclick="declineRequest('${r.id}')" class="decline-btn">✕ Decline</button>
            </div>
          </div>
        `;
      });
      list.innerHTML = html;
    }, (error) => {
      document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading</div>';
    });
  } catch (error) {}
}

function formatTime(ts) {
  if (!ts) return 'Recently';
  try {
    const d = new Date(ts);
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} minutes ago`;
    if (diff < 1440) return `${Math.floor(diff/60)} hours ago`;
    return d.toLocaleDateString();
  } catch (e) { return 'Recently'; }
}

window.acceptRequest = async function(reqId, fromUser) {
  try {
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
    alert('Request accepted!');
    window.location.href = `chat.html?chatId=${chatId}&user=${fromUser}`;
  } catch (error) { alert('Failed'); }
};

window.declineRequest = async function(reqId) {
  if (!confirm('Decline?')) return;
  try {
    await deleteDoc(doc(db, "requests", reqId));
    alert('Request declined');
  } catch (error) {}
};
