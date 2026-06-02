import { auth, db, watchBanStatus } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, deleteDoc, setDoc, updateDoc,
  collection, query, where, onSnapshot, arrayRemove
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;
let unsubscribeRequests = null;
let unsubscribeSentRequests = null;

window.goBack = function() { window.location.href = 'dashboard.html'; };

// Tab switching
window.switchTab = function(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
    watchBanStatus(user.uid, async () => {
      await signOut(auth);
      window.location.href = 'index.html';
    });

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      await signOut(auth);
      window.location.href = 'index.html';
      return;
    }

    const data = userDoc.data();
    currentUsername = data.username;

    renderProfileCard(data);
    renderInfoTab(data);
    renderAccountTab(data, user);
    loadRequests();
    loadSentRequests();
    loadBlockedUsers(data.blockedUsers || []);
  } catch (error) {
    console.error('Profile load error:', error);
  }
});

function renderProfileCard(data) {
  const avatar = document.getElementById('profileAvatar');
  avatar.textContent = (data.username || '?')[0].toUpperCase();

  const usernameEl = document.getElementById('profileUsername');
  usernameEl.childNodes[0].textContent = data.username || 'Unknown';

  if (data.verified) {
    document.getElementById('profileVerifiedBadge').style.display = 'inline-flex';
  }

  const joined = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown';
  document.getElementById('profileJoined').textContent = 'Joined ' + joined;
}

function renderInfoTab(data) {
  document.getElementById('infoUsername').textContent = data.username || '—';

  const verifiedEl = document.getElementById('infoVerified');
  if (data.verified) {
    verifiedEl.innerHTML = '<span class="status-pill verified">✓ Verified</span>';
  } else {
    verifiedEl.innerHTML = '<span class="status-pill unverified">Not Verified</span>';
  }

  const adminEl = document.getElementById('infoAdmin');
  if (data.isAdmin) {
    adminEl.innerHTML = '<span class="status-pill admin">👑 Admin</span>';
  } else {
    adminEl.textContent = 'Regular User';
  }

  document.getElementById('infoCreated').textContent = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  document.getElementById('infoLastSeen').textContent = data.lastSeen
    ? new Date(data.lastSeen).toLocaleString()
    : '—';

  const blockedCount = (data.blockedUsers || []).length;
  document.getElementById('infoBlockedCount').textContent =
    blockedCount === 0 ? 'None' : `${blockedCount} user${blockedCount !== 1 ? 's' : ''}`;
}

function renderAccountTab(data, user) {
  const statusEl = document.getElementById('infoStatus');
  if (data.banned) {
    statusEl.innerHTML = '<span class="status-pill" style="background:#fff0f0;color:#e53e3e">⛔ Suspended</span>';
  } else if (data.disabled) {
    statusEl.innerHTML = '<span class="status-pill" style="background:#fff0f0;color:#e53e3e">Disabled</span>';
  } else {
    statusEl.innerHTML = '<span class="status-pill" style="background:#e8f8f0;color:#38a169">✓ Good Standing</span>';
  }

  document.getElementById('infoEmail').textContent = data.email || user.email || '—';

  // Load saved language preference
  const langSelect = document.getElementById('languageSelect');
  if (langSelect) langSelect.value = data.language || '';
}

window.saveLanguage = async function(lang) {
  if (!currentUid) return;
  try {
    await updateDoc(doc(db, "users", currentUid), { language: lang });
  } catch (error) {
    console.error('Failed to save language:', error);
    alert('Could not save language preference');
  }
};

// ---- Message Requests ----
function loadRequests() {
  if (!currentUsername) return;

  if (unsubscribeRequests) unsubscribeRequests();

  const q = query(collection(db, "requests"), where("to", "==", currentUsername));

  unsubscribeRequests = onSnapshot(q, (snap) => {
    const pending = [];
    snap.forEach(d => {
      if (d.data().status === 'pending') pending.push({ id: d.id, ...d.data() });
    });
    pending.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Update badge
    const badge = document.getElementById('requestsBadge');
    if (pending.length > 0) {
      badge.textContent = pending.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }

    const list = document.getElementById('requestsList');
    list.innerHTML = '';

    if (pending.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>No pending message requests</p>
        </div>`;
      return;
    }

    pending.forEach(r => {
      const item = document.createElement('div');
      item.className = 'request-item';

      const avatar = document.createElement('div');
      avatar.className = 'request-avatar';
      avatar.textContent = r.from ? r.from[0].toUpperCase() : '?';

      const details = document.createElement('div');
      details.className = 'request-details';

      const fromEl = document.createElement('div');
      fromEl.className = 'request-from';
      fromEl.textContent = r.from || 'Unknown';

      const metaEl = document.createElement('div');
      metaEl.className = 'request-meta';
      metaEl.textContent = 'Wants to chat · ' + formatTime(r.createdAt);

      details.appendChild(fromEl);
      details.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'request-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'accept-btn';
      acceptBtn.textContent = '✓ Accept';
      acceptBtn.addEventListener('click', () => acceptRequest(r.id, r.from));

      const declineBtn = document.createElement('button');
      declineBtn.className = 'decline-btn';
      declineBtn.textContent = '✕';
      declineBtn.addEventListener('click', () => declineRequest(r.id));

      actions.appendChild(acceptBtn);
      actions.appendChild(declineBtn);

      item.appendChild(avatar);
      item.appendChild(details);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }, (error) => {
    console.error('Requests listener error:', error);
    document.getElementById('requestsList').innerHTML =
      '<div class="empty-state"><p>Error loading requests</p></div>';
  });
}

async function acceptRequest(reqId, fromUser) {
  try {
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
    console.error(error);
  }
}

async function declineRequest(reqId) {
  try {
    await deleteDoc(doc(db, "requests", reqId));
  } catch (error) {
    console.error('declineRequest error:', error);
  }
}

// ---- Sent Requests ----
function loadSentRequests() {
  if (!currentUsername) return;

  if (unsubscribeSentRequests) unsubscribeSentRequests();

  const q = query(collection(db, "requests"), where("from", "==", currentUsername));

  unsubscribeSentRequests = onSnapshot(q, (snap) => {
    const pending = [];
    snap.forEach(d => {
      if (d.data().status === 'pending') pending.push({ id: d.id, ...d.data() });
    });
    pending.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const list = document.getElementById('sentList');
    list.innerHTML = '';

    if (pending.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📤</div>
          <p>No pending sent requests</p>
        </div>`;
      return;
    }

    pending.forEach(r => {
      const item = document.createElement('div');
      item.className = 'request-item';

      const avatar = document.createElement('div');
      avatar.className = 'request-avatar';
      avatar.textContent = r.to ? r.to[0].toUpperCase() : '?';

      const details = document.createElement('div');
      details.className = 'request-details';

      const toEl = document.createElement('div');
      toEl.className = 'request-from';
      toEl.textContent = r.to || 'Unknown';

      const metaEl = document.createElement('div');
      metaEl.className = 'request-meta';
      metaEl.textContent = 'Waiting to be accepted · ' + formatTime(r.createdAt);

      details.appendChild(toEl);
      details.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'request-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'decline-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => cancelRequest(r.id));

      actions.appendChild(cancelBtn);

      item.appendChild(avatar);
      item.appendChild(details);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }, (error) => {
    console.error('Sent requests listener error:', error);
    document.getElementById('sentList').innerHTML =
      '<div class="empty-state"><p>Error loading sent requests</p></div>';
  });
}

async function cancelRequest(reqId) {
  if (!confirm('Cancel this request?')) return;
  try {
    await deleteDoc(doc(db, "requests", reqId));
  } catch (error) {
    alert('Failed to cancel request');
    console.error('cancelRequest error:', error);
  }
}

// ---- Block List ----
function loadBlockedUsers(blockedUsers) {
  const list = document.getElementById('blockedList');
  list.innerHTML = '';

  // Update badge
  const badge = document.getElementById('blockedBadge');
  if (blockedUsers.length > 0) {
    badge.textContent = blockedUsers.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  if (blockedUsers.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>You haven't blocked anyone</p>
      </div>`;
    return;
  }

  blockedUsers.forEach(username => {
    const item = document.createElement('div');
    item.className = 'blocked-item';

    const avatar = document.createElement('div');
    avatar.className = 'blocked-avatar';
    avatar.textContent = username[0].toUpperCase();

    const nameEl = document.createElement('div');
    nameEl.className = 'blocked-username';
    nameEl.textContent = username;

    const unblockBtn = document.createElement('button');
    unblockBtn.className = 'unblock-btn';
    unblockBtn.textContent = 'Unblock';
    unblockBtn.addEventListener('click', () => unblockUser(username, item));

    item.appendChild(avatar);
    item.appendChild(nameEl);
    item.appendChild(unblockBtn);
    list.appendChild(item);
  });
}

async function unblockUser(username, itemEl) {
  if (!confirm(`Unblock ${username}?`)) return;
  try {
    // Remove from user's blockedUsers array
    await updateDoc(doc(db, "users", currentUid), {
      blockedUsers: arrayRemove(username)
    });

    // Also clear the block on the chat document so the other user's
    // chat input re-enables immediately (chat uses isBlocked + blockedBy,
    // not blockedUsers, for its real-time listener)
    const chatId = [currentUsername, username].sort().join('_');
    const chatSnap = await getDoc(doc(db, "chats", chatId));
    if (chatSnap.exists() && chatSnap.data().isBlocked && chatSnap.data().blockedBy === currentUsername) {
      await updateDoc(doc(db, "chats", chatId), {
        isBlocked: false,
        blockedBy: null
      });
    }
    // Optimistically remove from UI
    itemEl.remove();

    // Update badge and empty state
    const remaining = document.querySelectorAll('.blocked-item').length;
    const badge = document.getElementById('blockedBadge');
    if (remaining === 0) {
      badge.style.display = 'none';
      document.getElementById('blockedList').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <p>You haven't blocked anyone</p>
        </div>`;
    } else {
      badge.textContent = remaining;
    }

    // Update the info tab count too
    document.getElementById('infoBlockedCount').textContent =
      remaining === 0 ? 'None' : `${remaining} user${remaining !== 1 ? 's' : ''}`;

  } catch (error) {
    alert('Failed to unblock user');
    console.error(error);
  }
}

// ---- Account ----
window.doLogout = async function() {
  if (!confirm('Log out?')) return;
  try {
    if (currentUid) {
      await updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    }
    if (unsubscribeRequests) unsubscribeRequests();
    await signOut(auth);
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
};

function formatTime(ts) {
  if (!ts) return 'Recently';
  try {
    const d = new Date(ts);
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString();
  } catch (e) { return 'Recently'; }
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (unsubscribeRequests) unsubscribeRequests();
});
