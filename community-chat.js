import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, getDoc, collection, addDoc, query, orderBy, onSnapshot,
  updateDoc, where, getDocs, deleteDoc, arrayUnion, arrayRemove,
  writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername, currentUid, communityId, communityName, replyingTo = null;
let userRole = null, onlineInterval = null;

const urlParams = new URLSearchParams(window.location.search);
communityId = urlParams.get('communityId');
communityName = urlParams.get('name');
if (!communityId) window.location.href = 'community.html';

window.goBack = function() { window.location.href = 'community.html'; };

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    document.getElementById('communityName').textContent = communityName || 'Community';
    await checkUserRole();
    listenForMessages();
    updateOnlineStatus();
    startOnlineStatusUpdates();
    listenForMemberUpdates();
  }
});

async function checkUserRole() {
  const memberRef = doc(db, "communities", communityId, "members", currentUid);
  const memberSnap = await getDoc(memberRef);
  if (memberSnap.exists()) {
    userRole = memberSnap.data().role || 'member';
    enableChat();
    if (userRole === 'creator' || userRole === 'admin') showAdminOptions();
    updateUIForRole();
  } else {
    window.location.href = 'community.html';
  }
}

function enableChat() {
  document.getElementById('messageInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('chatInputArea').classList.remove('hidden');
}

function showAdminOptions() {
  document.getElementById('adminOptions').classList.remove('hidden');
}

function updateUIForRole() {
  const btn = document.getElementById('leaveBtn');
  btn.textContent = userRole === 'creator' ? 'Delete Community' : 'Leave Community';
}

async function updateOnlineStatus() {
  if (!currentUid || !communityId || !['member','admin','creator'].includes(userRole)) return;
  try {
    await updateDoc(doc(db, "communities", communityId, "members", currentUid), {
      online: true, lastSeen: new Date().toISOString()
    });
  } catch (error) {}
}

function startOnlineStatusUpdates() {
  if (onlineInterval) clearInterval(onlineInterval);
  onlineInterval = setInterval(updateOnlineStatus, 30000);
  window.addEventListener('beforeunload', () => {
    if (currentUid && communityId) {
      updateDoc(doc(db, "communities", communityId, "members", currentUid), {
        online: false, lastSeen: new Date().toISOString()
      }).catch(() => {});
    }
  });
}

function listenForMemberUpdates() {
  onSnapshot(collection(db, "communities", communityId, "members"), (snap) => {
    let total = 0, online = 0;
    const fiveMinAgo = new Date(Date.now() - 300000);
    snap.forEach(d => {
      const data = d.data();
      if (['creator','admin','member'].includes(data.role)) {
        total++;
        if (data.lastSeen && new Date(data.lastSeen) > fiveMinAgo) online++;
      }
    });
    document.getElementById('onlineCount').textContent = online;
    document.getElementById('totalMembers').textContent = total;
  });
}

function listenForMessages() {
  const q = query(collection(db, "communities", communityId, "messages"), orderBy("timestamp"));
  onSnapshot(q, (snap) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    let lastDate = null;
    snap.forEach(d => {
      const data = d.data();
      const msgDate = data.timestamp ? new Date(data.timestamp) : null;
      const isMine = data.sender === currentUsername;
      if (msgDate) {
        const ds = msgDate.toDateString();
        if (lastDate !== ds) {
          lastDate = ds;
          container.appendChild(createDateDivider(msgDate));
        }
      }
      container.appendChild(createMessageElement(data, d.id, isMine));
    });
    container.scrollTop = container.scrollHeight;
  });
}

function createMessageElement(data, msgId, isMine) {
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
  div.dataset.messageId = msgId;
  let time = '';
  if (data.timestamp) {
    time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const senderHTML = !isMine ? `<div class="message-sender">${data.sender || 'Unknown'}</div>` : '';
  const replyHTML = data.replyTo ? `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>` : '';
  let reactionsHTML = '';
  if (data.reactions && Object.keys(data.reactions).length) {
    const uniq = [...new Set(Object.values(data.reactions))];
    reactionsHTML = `<div class="message-reactions">${uniq.map(e => `<span class="reaction-badge">${e}</span>`).join('')}</div>`;
  }
  if (data.deletedForEveryone) {
  div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
} else {
  // Add verified badge if sender is verified
  const verifiedBadge = data.senderVerified ? '<span class="verified-badge" title="Verified Account">✓</span>' : '';
  
  // Modify senderHTML to include verified badge
  const modifiedSenderHTML = !isMine ? `<div class="message-sender">${data.sender || 'Unknown'} ${verifiedBadge}</div>` : '';
  
  div.innerHTML = `${modifiedSenderHTML}${replyHTML}<div class="message-text">${data.text}</div>${reactionsHTML}<div class="message-footer"><span class="message-time">${time}</span></div>`;
}

  let touchStartX = 0, touchStartY = 0, swiped = false;
  div.addEventListener('touchstart', e => {
    if (!['member','admin','creator'].includes(userRole)) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiped = false;
  }, { passive: true });
  
  div.addEventListener('touchmove', e => {
    if (!touchStartX || !['member','admin','creator'].includes(userRole)) return;
    const endX = e.touches[0].clientX;
    const endY = e.touches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = Math.abs(endY - touchStartY);
    if (diffX > 50 && diffY < 30 && !swiped && !data.deletedForEveryone) {
      swiped = true;
      e.preventDefault();
      div.style.transform = 'translateX(10px)';
      setTimeout(() => div.style.transform = '', 200);
      replyToMessage(data.text);
    }
  }, { passive: false });
  
  div.addEventListener('touchend', () => { touchStartX = 0; });

  div.addEventListener('dblclick', e => {
    if (!['member','admin','creator'].includes(userRole)) return;
    e.preventDefault();
    if (!data.deletedForEveryone) showReactionMenu(e, msgId, div);
  });

  let pressTimer;
  div.addEventListener('touchstart', e => {
    if (!['member','admin','creator'].includes(userRole)) return;
    pressTimer = setTimeout(() => {
      if (!data.deletedForEveryone) showReactionMenu(e, msgId, div);
    }, 500);
  }, { passive: true });
  div.addEventListener('touchend', () => clearTimeout(pressTimer));
  div.addEventListener('touchcancel', () => clearTimeout(pressTimer));

  if ((userRole === 'admin' || userRole === 'creator' || isMine) && !data.deletedForEveryone) {
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (confirm('Delete this message?')) deleteMessage(msgId);
    });
  }
  return div;
}

function createDateDivider(date) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) div.textContent = 'Today';
  else if (date.toDateString() === yesterday.toDateString()) div.textContent = 'Yesterday';
  else div.textContent = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  return div;
}

function showReactionMenu(e, msgId, el) {
  document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'reaction-menu';
  ['❤️','😂','🔥','👍','😮','😢','🎉','🤔'].forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    btn.textContent = emoji;
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      await addReaction(msgId, emoji);
      menu.remove();
    };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect = el.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.top - 50}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '10000';
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 100);
}

async function addReaction(msgId, emoji) {
  try {
    await updateDoc(doc(db, "communities", communityId, "messages", msgId), {
      [`reactions.${currentUsername}`]: emoji
    });
  } catch (error) {}
}

window.sendMessage = async function() {
  if (!['member','admin','creator'].includes(userRole)) {
    alert('You cannot send messages');
    return;
  }
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  await addDoc(collection(db, "communities", communityId, "messages"), {
    sender: currentUsername, senderId: currentUid,
    text, timestamp: new Date().toISOString(),
    deletedForEveryone: false, replyTo: replyingTo,
    reactions: {}
  });
  input.value = '';
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

window.replyToMessage = function(text) {
  replyingTo = text;
  const preview = document.getElementById('replyPreview');
  document.getElementById('replyText').textContent = text.length > 50 ? text.slice(0,50)+'...' : text;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
};

window.cancelReply = function() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

async function deleteMessage(msgId) {
  await updateDoc(doc(db, "communities", communityId, "messages", msgId), {
    deletedForEveryone: true, text: ''
  });
}

window.toggleCommunityOptions = function() {
  const options = document.getElementById('communityOptions');
  const adminOptions = document.getElementById('adminOptions');
  if (!options.classList.contains('hidden') || !adminOptions.classList.contains('hidden')) {
    options.classList.add('hidden');
    adminOptions.classList.add('hidden');
  } else {
    options.classList.remove('hidden');
    if (userRole === 'creator' || userRole === 'admin') adminOptions.classList.remove('hidden');
  }
};

window.viewMembers = function() {
  loadMembersList();
  document.getElementById('membersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadMembersList(filter = 'all') {
  const snap = await getDocs(collection(db, "communities", communityId, "members"));
  const list = document.getElementById('membersList');
  let html = '';
  const fiveMinAgo = new Date(Date.now() - 300000);
  const members = [];
  snap.forEach(d => {
    const data = d.data();
    if (!['creator','admin','member'].includes(data.role)) return;
    const lastSeen = data.lastSeen ? new Date(data.lastSeen) : null;
    const online = lastSeen && lastSeen > fiveMinAgo;
    members.push({ id: d.id, username: data.username, role: data.role, online, lastSeen: data.lastSeen });
  });
  let filtered = members;
  if (filter === 'online') filtered = members.filter(m => m.online);
  else if (filter === 'admins') filtered = members.filter(m => m.role === 'admin' || m.role === 'creator');
  filtered.sort((a,b) => {
    if (a.role === 'creator') return -1;
    if (b.role === 'creator') return 1;
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  filtered.forEach(m => {
    const roleBadge = m.role === 'creator' ? '👑 Creator' : (m.role === 'admin' ? '⚡ Admin' : '');
    const statusClass = m.online ? 'online' : 'offline';
    const statusText = m.online ? 'Online' : (m.lastSeen ? formatLastSeen(new Date(m.lastSeen)) : 'Offline');
    html += `
      <div class="member-item">
        <div class="member-avatar">${m.username[0].toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">${m.username} ${roleBadge ? `<span class="role-badge">${roleBadge}</span>` : ''}</div>
          <div class="member-status ${statusClass}">${statusText}</div>
        </div>
      </div>
    `;
  });
  list.innerHTML = html || '<div class="no-members">No members found</div>';
}

window.switchMembersTab = function(tab) {
  ['all','online','admins'].forEach(t => document.getElementById(t+'Tab').classList.remove('active'));
  document.getElementById(tab+'Tab').classList.add('active');
  loadMembersList(tab);
};

window.viewMyRequests = async function() {
  try {
    const q = query(
      collection(db, "communities", communityId, "requests"),
      where("userId", "==", currentUid),
      where("status", "==", "pending")
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      alert('No pending requests');
    } else {
      let msg = 'Your pending requests:\n';
      snap.forEach(d => msg += `- Requested: ${formatTime(d.data().requestedAt)}\n`);
      alert(msg);
    }
  } catch (error) {}
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

window.leaveCommunity = async function() {
  if (userRole === 'creator') {
    if (!confirm('Delete this community? This cannot be undone.')) return;
    try {
      const batch = writeBatch(db);
      const msgs = await getDocs(collection(db, "communities", communityId, "messages"));
      msgs.forEach(d => batch.delete(d.ref));
      const members = await getDocs(collection(db, "communities", communityId, "members"));
      members.forEach(d => batch.delete(d.ref));
      const reqs = await getDocs(collection(db, "communities", communityId, "requests"));
      reqs.forEach(d => batch.delete(d.ref));
      const banned = await getDocs(collection(db, "communities", communityId, "banned"));
      banned.forEach(d => batch.delete(d.ref));
      batch.delete(doc(db, "communities", communityId));
      await batch.commit();
      alert('Community deleted');
      window.location.href = 'community.html';
    } catch (error) { alert('Failed'); }
  } else {
    if (!confirm('Leave this community?')) return;
    try {
      await deleteDoc(doc(db, "communities", communityId, "members", currentUid));
      alert('Left community');
      window.location.href = 'community.html';
    } catch (error) {}
  }
};

window.manageRequests = function() {
  loadRequestsList();
  document.getElementById('requestsModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadRequestsList() {
  try {
    const q = query(collection(db, "communities", communityId, "requests"), where("status", "==", "pending"));
    const snap = await getDocs(q);
    const list = document.getElementById('requestsList');
    if (snap.empty) {
      list.innerHTML = '<div class="no-requests">No pending requests</div>';
      return;
    }
    let html = '';
    snap.forEach(d => {
      const data = d.data();
      html += `
        <div class="request-item" data-id="${d.id}">
          <div class="request-avatar">${data.username ? data.username[0].toUpperCase() : '?'}</div>
          <div class="request-details">
            <div class="request-from">${data.username || 'Unknown'}</div>
            <div class="request-time">${formatTime(data.requestedAt)}</div>
          </div>
          <div class="request-actions">
            <button onclick="approveRequest('${d.id}','${data.userId}','${data.username}')" class="accept-btn">✓ Approve</button>
            <button onclick="declineRequest('${d.id}')" class="decline-btn">✕ Decline</button>
          </div>
        </div>
      `;
    });
    list.innerHTML = html;
  } catch (error) {
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading</div>';
  }
}

window.approveRequest = async function(reqId, userId, username) {
  try {
    const memberRef = doc(db, "communities", communityId, "members", userId);
    if ((await getDoc(memberRef)).exists()) {
      alert('Already a member');
      await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
      loadRequestsList();
      return;
    }
    await setDoc(memberRef, {
      username, role: 'member', status: 'member',
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      online: false
    });
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    alert(`Approved! ${username} is now a member`);
    loadRequestsList();
  } catch (error) { alert('Failed'); }
};

window.declineRequest = async function(reqId) {
  if (!confirm('Decline?')) return;
  try {
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    alert('Declined');
    loadRequestsList();
  } catch (error) {}
};

window.manageMembers = function() {
  loadManageMembersList();
  document.getElementById('manageMembersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadManageMembersList(search = '') {
  const snap = await getDocs(collection(db, "communities", communityId, "members"));
  const list = document.getElementById('manageMembersList');
  let html = '';
  const members = [];
  snap.forEach(d => {
    const data = d.data();
    members.push({ id: d.id, username: data.username, role: data.role || 'member', online: data.online, lastSeen: data.lastSeen });
  });
  let filtered = members.filter(m => m.username.toLowerCase().includes(search.toLowerCase()));
  filtered.sort((a,b) => {
    if (a.role === 'creator') return -1;
    if (b.role === 'creator') return 1;
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  filtered.forEach(m => {
    const roleBadge = m.role === 'creator' ? '👑 Creator' : (m.role === 'admin' ? '⚡ Admin' : 'Member');
    const statusClass = m.online ? 'online' : 'offline';
    const statusText = m.online ? 'Online' : (m.lastSeen ? `Last seen ${formatLastSeen(new Date(m.lastSeen))}` : 'Offline');
    let actions = '';
    if (m.role !== 'creator' && m.id !== currentUid) {
      if (userRole === 'creator' || (userRole === 'admin' && m.role !== 'admin')) {
        actions = `
          <div class="member-actions">
            ${m.role !== 'admin' ? `<button onclick="makeAdmin('${m.id}')" class="action-btn promote">⭐ Make Admin</button>` : ''}
            <button onclick="banMember('${m.id}','${m.username}')" class="action-btn ban">🚫 Ban</button>
          </div>
        `;
      }
    }
    html += `
      <div class="manage-member-item">
        <div class="member-info">
          <div class="member-avatar">${m.username[0].toUpperCase()}</div>
          <div class="member-details">
            <div class="member-name">${m.username} <span class="role-badge">${roleBadge}</span></div>
            <div class="member-status ${statusClass}">${statusText}</div>
          </div>
        </div>
        ${actions}
      </div>
    `;
  });
  list.innerHTML = html || '<div class="no-members">No members found</div>';
  document.getElementById('searchMember').oninput = (e) => loadManageMembersList(e.target.value);
}

window.makeAdmin = async function(uid) {
  if (!confirm('Make admin?')) return;
  try {
    await updateDoc(doc(db, "communities", communityId, "members", uid), { role: 'admin' });
    alert('User is now admin');
    loadManageMembersList();
  } catch (error) {}
};

window.banMember = async function(uid, username) {
  if (!confirm(`Ban ${username}?`)) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "communities", communityId, "banned", uid), {
      username, bannedAt: new Date().toISOString(), bannedBy: currentUsername
    });
    batch.delete(doc(db, "communities", communityId, "members", uid));
    await batch.commit();
    alert('User banned');
    loadManageMembersList();
  } catch (error) {}
};

window.editCommunity = function() {
  alert('Edit coming soon');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

window.hideModal = function(id) {
  document.getElementById(id).classList.add('hidden');
};

function formatTime(ts) {
  if (!ts) return 'Recently';
  const date = new Date(ts);
  const diff = Math.floor((Date.now() - date) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} minutes ago`;
  if (diff < 1440) return `${Math.floor(diff/60)} hours ago`;
  return date.toLocaleDateString();
}

function formatLastSeen(date) {
  const diff = Math.floor((Date.now() - date) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} minutes ago`;
  if (diff < 1440) return `${Math.floor(diff/60)} hours ago`;
  return date.toLocaleDateString();
}
