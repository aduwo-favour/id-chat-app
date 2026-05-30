import { auth, db, watchBanStatus } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  doc, getDoc, collection, addDoc, query, orderBy, onSnapshot,
  updateDoc, where, getDocs, deleteDoc, arrayUnion, arrayRemove,
  writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// SECURITY: Escape HTML to prevent XSS when inserting dynamic content into innerHTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

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

  // Immediately kick user if banned while in community chat
  watchBanStatus(user.uid, async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    document.getElementById('communityName').textContent = communityName || 'Community';
    await checkUserRole();
    await loadMyLanguage();
    listenForMessages();
    listenForCommunityDoc();
    updateOnlineStatus();
    startOnlineStatusUpdates();
    listenForMemberUpdates();
  }
});

async function checkUserRole() {
  const memberRef = doc(db, "communities", communityId, "members", currentUid);
  const memberSnap = await getDoc(memberRef);
  if (memberSnap.exists()) {
    const memberData = memberSnap.data();
    userRole = memberData.role || 'member';
    isMuted = memberData.muted === true;
    enableChat();
    if (userRole === 'creator' || userRole === 'admin') showAdminOptions();
    updateUIForRole();

    // Apply community color and show welcome message if newly joined
    try {
      const commSnap = await getDoc(doc(db, "communities", communityId));
      if (commSnap.exists()) {
        const commData = commSnap.data();
        // Apply avatar color to header
        const color = commData.color || '#667eea';
        const headerAvatar = document.querySelector('.community-avatar-header');
        if (headerAvatar) headerAvatar.style.background = color;

        // Show welcome message to members who joined within the last 60s
        const joinedAt = memberData.joinedAt ? new Date(memberData.joinedAt) : null;
        const justJoined = joinedAt && (Date.now() - joinedAt.getTime()) < 60000;
        if (justJoined && commData.welcomeMessage) {
          setTimeout(() => {
            const banner = document.createElement('div');
            banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:var(--primary);color:white;padding:12px 20px;border-radius:12px;z-index:9999;max-width:320px;text-align:center;font-size:0.9rem;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
            banner.textContent = commData.welcomeMessage;
            document.body.appendChild(banner);
            setTimeout(() => banner.remove(), 5000);
          }, 1000);
        }
      }
    } catch (e) {}
  } else {
    window.location.href = 'community.html';
  }
}

function enableChat() {
  if (isMuted) {
    const input = document.getElementById('messageInput');
    if (input) { input.disabled = true; input.placeholder = 'You are muted'; }
    document.getElementById('sendBtn').disabled = true;
  } else {
    document.getElementById('messageInput').disabled = false;
    document.getElementById('sendBtn').disabled = false;
  }
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
    const now = new Date().toISOString();
    await updateDoc(doc(db, "communities", communityId, "members", currentUid), {
      online: true,
      lastSeen: now
    });
  } catch (error) {
    console.error("Failed to update online status:", error);
  }
}

function startOnlineStatusUpdates() {
  if (onlineInterval) clearInterval(onlineInterval);
  
  onlineInterval = setInterval(updateOnlineStatus, 30000);
  
  window.addEventListener('beforeunload', () => {
    if (currentUid && communityId) {
      const data = JSON.stringify({
        fields: {
          online: { booleanValue: false },
          lastSeen: { timestampValue: new Date().toISOString() }
        }
      });
      
      navigator.sendBeacon?.(
        `https://firestore.googleapis.com/v1/projects/chat-messaging-abaa9/databases/(default)/documents/communities/${communityId}/members/${currentUid}`,
        data
      );
      
      updateDoc(doc(db, "communities", communityId, "members", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    }
  });
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (currentUid && communityId) {
        updateDoc(doc(db, "communities", communityId, "members", currentUid), {
          online: false,
          lastSeen: new Date().toISOString()
        }).catch(() => {});
      }
    } else {
      updateOnlineStatus();
    }
  });
}

// Real-time listener on the community document itself —
// so name/description changes from edit show immediately for everyone
function listenForCommunityDoc() {
  onSnapshot(doc(db, "communities", communityId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    // Update header name live for all members
    if (data.name) {
      document.getElementById('communityName').textContent = data.name;
      communityName = data.name;
    }
  });
}

let isMuted = false;

function listenForMemberUpdates() {
  // Watch the whole members collection for counts
  onSnapshot(collection(db, "communities", communityId, "members"), (snap) => {
    let total = 0, online = 0;
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120000);

    snap.forEach(d => {
      const data = d.data();
      if (['creator', 'admin', 'member'].includes(data.role)) {
        total++;
        if (data.online === true && data.lastSeen) {
          const timeDiff = now.getTime() - new Date(data.lastSeen).getTime();
          if (timeDiff < 120000) online++;
          else updateDoc(d.ref, { online: false }).catch(() => {});
        }
      }
    });

    document.getElementById('onlineCount').textContent = online;
    document.getElementById('totalMembers').textContent = total;
  });

  // Watch the CURRENT USER's own member doc for real-time changes:
  // approval, ban, mute — all take effect instantly without a refresh
  const myMemberRef = doc(db, "communities", communityId, "members", currentUid);
  onSnapshot(myMemberRef, async (snap) => {
    if (!snap.exists()) {
      // Removed from community (banned or kicked) — check banned list
      const bannedSnap = await getDoc(doc(db, "communities", communityId, "banned", currentUid));
      if (bannedSnap.exists()) {
        alert('You have been banned from this community.');
      } else {
        alert('You have been removed from this community.');
      }
      window.location.href = 'community.html';
      return;
    }

    const data = snap.data();
    const newRole = data.role || 'member';
    const newMuted = data.muted === true;

    // Role changed (e.g. promoted to admin)
    if (newRole !== userRole) {
      userRole = newRole;
      updateUIForRole();
      if (userRole === 'admin') {
        showAdminOptions();
      }
    }

    // Mute state changed
    isMuted = newMuted;
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    if (isMuted) {
      if (input) { input.disabled = true; input.placeholder = 'You are muted'; }
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (input) { input.disabled = false; input.placeholder = 'Type a message...'; }
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  // Watch the banned subcollection for the current user
  const myBannedRef = doc(db, "communities", communityId, "banned", currentUid);
  onSnapshot(myBannedRef, (snap) => {
    if (snap.exists()) {
      alert('You have been banned from this community.');
      window.location.href = 'community.html';
    }
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
  
  // Create verified badge if user is verified
  const verifiedBadge = data.senderVerified ? '<span class="verified-badge" title="Verified Account">✓</span>' : '';
  
  const replyHTML = data.replyTo ? `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>` : '';
  let reactionsHTML = '';
  if (data.reactions && Object.keys(data.reactions).length) {
    const uniq = [...new Set(Object.values(data.reactions))];
    reactionsHTML = `<div class="message-reactions">${uniq.map(e => `<span class="reaction-badge">${e}</span>`).join('')}</div>`;
  }
  
  if (data.deletedForEveryone) {
    div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
  } else {
    // For other people's messages, show sender name with verified badge
    if (!isMine) {
      div.innerHTML = `
        <div class="message-sender">${escapeHtml(data.sender || 'Unknown')} ${verifiedBadge}</div>
        ${replyHTML}
        <div class="message-text">${escapeHtml(data.text)}</div>
        ${reactionsHTML}
        <div class="message-footer">
          <span class="message-time">${time}</span>
        </div>
      `;
      // Translate incoming message if user has a language set
      if (data.text && !data.deletedForEveryone) {
        applyTranslation(div.querySelector('.message-text'), data.text);
      }
    } else {
      // For your own messages, don't show sender name
      div.innerHTML = `
        ${replyHTML}
        <div class="message-text">${escapeHtml(data.text)}</div>
        ${reactionsHTML}
        <div class="message-footer">
          <span class="message-time">${time}</span>
        </div>
      `;
    }
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

  // Own messages: long-press or right-click to delete
  // Admin/creator: same options on ANY message
  if (!data.deletedForEveryone) {
    const canDelete = isMine || userRole === 'admin' || userRole === 'creator';
    if (canDelete) {
      const showMenu = (e) => {
        e.preventDefault();
        // Remove any existing menus
        document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'msg-context-menu';

        if (isMine) {
          const delBtn = document.createElement('button');
          delBtn.textContent = '🗑️ Delete for everyone';
          delBtn.onclick = () => { menu.remove(); if (confirm('Delete this message?')) deleteMessage(msgId); };
          menu.appendChild(delBtn);
        } else {
          // Admin deleting someone else's message
          const delBtn = document.createElement('button');
          delBtn.textContent = `🗑️ Delete message`;
          delBtn.style.color = '#e53e3e';
          delBtn.onclick = () => { menu.remove(); if (confirm(`Delete this message from ${data.sender}?`)) deleteMessage(msgId); };
          menu.appendChild(delBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✕ Cancel';
        cancelBtn.onclick = () => menu.remove();
        menu.appendChild(cancelBtn);

        document.body.appendChild(menu);

        // Position near tap/click
        const rect = div.getBoundingClientRect();
        const menuH = 100;
        const top = rect.top - menuH > 0 ? rect.top - menuH : rect.bottom + 8;
        menu.style.cssText = `position:fixed;top:${top}px;left:50%;transform:translateX(-50%);z-index:10000`;

        // Close on outside click
        setTimeout(() => {
          document.addEventListener('click', function close() {
            menu.remove();
            document.removeEventListener('click', close);
          });
        }, 100);
      };

      div.addEventListener('contextmenu', showMenu);

      // Long press for mobile
      let pressTimer;
      div.addEventListener('touchstart', () => { pressTimer = setTimeout(() => showMenu({ preventDefault: () => {} }), 600); }, { passive: true });
      div.addEventListener('touchend', () => clearTimeout(pressTimer));
      div.addEventListener('touchmove', () => clearTimeout(pressTimer));
    }
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
  if (!['member', 'admin', 'creator'].includes(userRole)) {
    alert('You cannot send messages');
    return;
  }
  if (isMuted) {
    alert('You are muted and cannot send messages');
    return;
  }
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  
  // Get user's verified status
  const userDoc = await getDoc(doc(db, "users", currentUid));
  const isVerified = userDoc.data().verified || false;
  
  await addDoc(collection(db, "communities", communityId, "messages"), {
    sender: currentUsername, senderId: currentUid,
    senderVerified: isVerified,
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
  const now = new Date();
  const twoMinAgo = new Date(now.getTime() - 120000);
  const members = [];
  snap.forEach(d => {
    const data = d.data();
    if (!['creator','admin','member'].includes(data.role)) return;
    const lastSeen = data.lastSeen ? new Date(data.lastSeen) : null;
    const online = data.online === true && lastSeen && lastSeen > twoMinAgo;
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
        <div class="member-avatar">${escapeHtml(m.username[0].toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(m.username)} ${roleBadge ? `<span class="role-badge">${roleBadge}</span>` : ''}</div>
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
            <div class="request-from">${escapeHtml(data.username || 'Unknown')}</div>
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
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading requests</div>'; console.error('Requests load error:', error);
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
      online: true
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
  switchManageTab('members');
  document.getElementById('manageMembersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

window.switchManageTab = function(tab) {
  document.getElementById('manageMembersPanel').style.display = tab === 'members' ? 'block' : 'none';
  document.getElementById('manageBannedPanel').style.display = tab === 'banned' ? 'block' : 'none';
  document.getElementById('manageTabMembers').classList.toggle('active', tab === 'members');
  document.getElementById('manageTabBanned').classList.toggle('active', tab === 'banned');
  if (tab === 'banned') loadBannedList();
};

async function loadBannedList() {
  const list = document.getElementById('manageBannedList');
  list.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const snap = await getDocs(collection(db, "communities", communityId, "banned"));
    if (snap.empty) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">No banned members</div>';
      return;
    }
    list.innerHTML = '';
    snap.forEach(d => {
      const data = d.data();
      const bannedAt = data.bannedAt ? new Date(data.bannedAt).toLocaleDateString() : '';
      const item = document.createElement('div');
      item.className = 'manage-member-item';
      item.innerHTML = `
        <div class="member-info">
          <div class="member-avatar" style="background:#e53e3e">${(data.username || '?')[0].toUpperCase()}</div>
          <div class="member-details">
            <div class="member-name">${escapeHtml(data.username)} <span class="role-badge" style="background:rgba(239,68,68,0.15);color:#e53e3e">Banned</span></div>
            <div class="member-status offline">${bannedAt ? 'Banned ' + bannedAt : ''}${data.bannedBy ? ' by ' + escapeHtml(data.bannedBy) : ''}</div>
          </div>
        </div>
        <div class="member-actions">
          <button onclick="unbanMember('${d.id}','${escapeHtml(data.username)}')" class="action-btn unmute">✅ Unban</button>
        </div>
      `;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<div class="error-message">Failed to load</div>';
    console.error(e);
  }
}

window.unbanMember = async function(uid, username) {
  if (!confirm(`Unban ${username}? They can request to join again.`)) return;
  try {
    await deleteDoc(doc(db, "communities", communityId, "banned", uid));
    loadBannedList();
  } catch (e) {
    alert('Failed to unban');
    console.error(e);
  }
};

async function loadManageMembersList(search = '') {
  const snap = await getDocs(collection(db, "communities", communityId, "members"));
  const list = document.getElementById('manageMembersList');
  let html = '';
  const members = [];
  snap.forEach(d => {
    const data = d.data();
    members.push({ id: d.id, username: data.username, role: data.role || 'member', online: data.online, lastSeen: data.lastSeen, muted: data.muted === true });
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
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120000);
    const isOnline = m.online === true && m.lastSeen && new Date(m.lastSeen) > twoMinAgo;
    const statusClass = isOnline ? 'online' : 'offline';
    const statusText = isOnline ? 'Online' : (m.lastSeen ? `Last seen ${formatLastSeen(new Date(m.lastSeen))}` : 'Offline');
    let actions = '';
    if (m.role !== 'creator' && m.id !== currentUid) {
      // Creator can manage everyone; admin can only manage regular members
      if (userRole === 'creator' || (userRole === 'admin' && m.role === 'member')) {
        const promoteBtn = m.role === 'admin'
          ? `<button onclick="demoteAdmin('${m.id}','${m.username}')" class="action-btn mute">⬇️ Demote</button>`
          : `<button onclick="makeAdmin('${m.id}')" class="action-btn promote">⭐ Make Admin</button>`;
        const muteBtn = m.muted
          ? `<button onclick="unmuteMember('${m.id}','${m.username}')" class="action-btn unmute">🔊 Unmute</button>`
          : `<button onclick="muteMember('${m.id}','${m.username}')" class="action-btn mute">🔇 Mute</button>`;
        actions = `
          <div class="member-actions">
            ${promoteBtn}
            ${muteBtn}
            <button onclick="banMember('${m.id}','${m.username}')" class="action-btn ban">🚫 Ban</button>
          </div>
        `;
      }
    }
    html += `
      <div class="manage-member-item">
        <div class="member-info">
          <div class="member-avatar">${escapeHtml(m.username[0].toUpperCase())}</div>
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
    loadManageMembersList();
  } catch (error) { alert('Failed to promote'); }
};

window.demoteAdmin = async function(uid, username) {
  if (!confirm(`Demote ${username} from admin to member?`)) return;
  try {
    await updateDoc(doc(db, "communities", communityId, "members", uid), { role: 'member' });
    loadManageMembersList();
  } catch (error) { alert('Failed to demote'); }
};

window.muteMember = async function(uid, username) {
  if (!confirm(`Mute ${username}? They will not be able to send messages.`)) return;
  try {
    await updateDoc(doc(db, "communities", communityId, "members", uid), { muted: true, mutedBy: currentUsername, mutedAt: new Date().toISOString() });
    loadManageMembersList();
  } catch (error) { alert('Failed to mute user'); }
};

window.unmuteMember = async function(uid, username) {
  if (!confirm(`Unmute ${username}?`)) return;
  try {
    await updateDoc(doc(db, "communities", communityId, "members", uid), { muted: false, mutedBy: null, mutedAt: null });
    loadManageMembersList();
  } catch (error) { alert('Failed to unmute user'); }
};

window.banMember = async function(uid, username) {
  if (!confirm(`Ban ${username}? They will be removed and cannot rejoin without being unbanned.`)) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "communities", communityId, "banned", uid), {
      username, bannedAt: new Date().toISOString(), bannedBy: currentUsername
    });
    batch.delete(doc(db, "communities", communityId, "members", uid));
    await batch.commit();
    loadManageMembersList();
  } catch (error) { alert('Failed to ban member'); }
};

window.editCommunity = async function() {
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');

  // Load current community data into the form
  try {
    const commSnap = await getDoc(doc(db, "communities", communityId));
    if (!commSnap.exists()) return;
    const data = commSnap.data();

    document.getElementById('editName').value = data.name || '';
    document.getElementById('editDescription').value = data.description || '';
    document.getElementById('editType').value = data.type || 'public';
    document.getElementById('editWelcome').value = data.welcomeMessage || '';

    // Set selected color swatch
    const savedColor = data.color || '#667eea';
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === savedColor);
      sw.onclick = () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
      };
    });

    document.getElementById('editCommunityModal').classList.remove('hidden');
  } catch (e) {
    alert('Failed to load community data');
  }
};

window.saveEditCommunity = async function() {
  const name = document.getElementById('editName').value.trim();
  const description = document.getElementById('editDescription').value.trim();
  const type = document.getElementById('editType').value;
  const welcome = document.getElementById('editWelcome').value.trim();
  const selectedSwatch = document.querySelector('.color-swatch.selected');
  const color = selectedSwatch ? selectedSwatch.dataset.color : '#667eea';

  if (!name) { alert('Name cannot be empty'); return; }

  const saveBtn = document.querySelector('.save-edit-btn');
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  try {
    await updateDoc(doc(db, "communities", communityId), {
      name, description, type, color,
      welcomeMessage: welcome,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUsername
    });

    // Update header name live
    document.getElementById('communityName').textContent = name;

    hideModal('editCommunityModal');
  } catch (e) {
    alert('Failed to save changes');
    console.error(e);
  } finally {
    saveBtn.textContent = 'Save Changes';
    saveBtn.disabled = false;
  }
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
// ---- Translation (same system as private chat) ----
let myLanguage = '';
const translateCache = new Map();

async function loadMyLanguage() {
  if (!currentUid) return;
  try {
    const userDoc = await getDoc(doc(db, "users", currentUid));
    myLanguage = userDoc.data()?.language || '';
    const sel = document.getElementById('commLangSelect');
    if (sel) sel.value = myLanguage;
  } catch (e) { myLanguage = ''; }
}

async function translateText(text, targetLang) {
  if (!targetLang || !text) return null;
  const key = text + '||' + targetLang;
  if (translateCache.has(key)) return translateCache.get(key);
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated || translated === text ||
        translated.toUpperCase().includes('PLEASE SELECT TWO DISTINCT') ||
        translated.toUpperCase().includes('MYMEMORY') ||
        translated.toUpperCase().includes('QUERY LIMIT')) return null;
    translateCache.set(key, translated);
    return translated;
  } catch (e) { return null; }
}

window.changeChatLanguage = async function(lang) {
  myLanguage = lang;
  if (currentUid) {
    try { await updateDoc(doc(db, "users", currentUid), { language: lang }); } catch (e) {}
  }
  translateCache.clear();
  const container = document.getElementById('messagesContainer');
  if (container) {
    container.querySelectorAll('.translated-text').forEach(el => el.remove());
    if (lang) {
      container.querySelectorAll('.other-message .message-text').forEach(textEl => {
        const originalText = textEl.childNodes[0]?.textContent;
        if (!originalText) return;
        translateText(originalText, lang).then(translated => {
          if (translated) {
            const el = document.createElement('div');
            el.className = 'translated-text';
            el.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px solid rgba(0,0,0,0.1);font-style:italic;opacity:0.85;font-size:0.9em';
            el.textContent = translated;
            const flag = document.createElement('span');
            flag.style.cssText = 'font-size:0.65rem;color:#aaa;display:block;margin-top:2px';
            flag.textContent = '🌐 Translated';
            el.appendChild(flag);
            textEl.appendChild(el);
          }
        });
      });
    }
  }
};

// Apply translation to incoming messages in community chat
function applyTranslation(textEl, originalText) {
  if (!myLanguage || !originalText) return;
  const indicator = document.createElement('span');
  indicator.className = 'translate-loading';
  indicator.textContent = ' 🌐';
  indicator.style.cssText = 'font-size:0.7rem;opacity:0.4';
  textEl.appendChild(indicator);
  translateText(originalText, myLanguage).then(translated => {
    indicator.remove();
    if (translated) {
      const el = document.createElement('div');
      el.className = 'translated-text';
      el.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px solid rgba(0,0,0,0.1);font-style:italic;opacity:0.85;font-size:0.9em';
      el.textContent = translated;
      const flag = document.createElement('span');
      flag.style.cssText = 'font-size:0.65rem;color:#aaa;display:block;margin-top:2px';
      flag.textContent = '🌐 Translated';
      el.appendChild(flag);
      textEl.appendChild(el);
    }
  });
}
