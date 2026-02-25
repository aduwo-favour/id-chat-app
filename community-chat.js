import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  updateDoc,
  where,
  getDocs,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  writeBatch,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;
let communityId = null;
let communityName = null;
let replyingTo = null;
let userRole = null;
let onlineInterval = null;

const urlParams = new URLSearchParams(window.location.search);
communityId = urlParams.get('communityId');
communityName = urlParams.get('name');

if (!communityId) {
  window.location.href = 'community.html';
}

window.goBack = function() {
  window.location.href = 'community.html';
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

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
  try {
    console.log("Checking role for user:", currentUid);
    
    const memberRef = doc(db, "communities", communityId, "members", currentUid);
    const memberSnap = await getDoc(memberRef);
    
    if (memberSnap.exists()) {
      const data = memberSnap.data();
      userRole = data.role || 'member';
      console.log("User role found:", userRole);
      
      enableChat();
      
      if (userRole === 'creator' || userRole === 'admin') {
        console.log("Showing admin options for role:", userRole);
        showAdminOptions();
      }
      
      updateUIForRole();
      
    } else {
      console.log("User not found in members");
      window.location.href = 'community.html';
    }
    
  } catch (error) {
    console.error("Error checking user role:", error);
  }
}

function enableChat() {
  console.log("Enabling chat for user role:", userRole);
  document.getElementById('messageInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('chatInputArea').classList.remove('hidden');
}

function showAdminOptions() {
  const adminOptions = document.getElementById('adminOptions');
  adminOptions.classList.remove('hidden');
}

function updateUIForRole() {
  const leaveBtn = document.getElementById('leaveBtn');
  if (userRole === 'creator') {
    leaveBtn.textContent = 'Delete Community';
  } else {
    leaveBtn.textContent = 'Leave Community';
  }
}

async function updateOnlineStatus() {
  if (!currentUid || !communityId || (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator')) return;
  
  try {
    const memberRef = doc(db, "communities", communityId, "members", currentUid);
    await updateDoc(memberRef, {
      online: true,
      lastSeen: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error updating online status:", error);
  }
}

function startOnlineStatusUpdates() {
  if (onlineInterval) clearInterval(onlineInterval);
  
  onlineInterval = setInterval(() => {
    updateOnlineStatus();
  }, 30000);
  
  window.addEventListener('beforeunload', () => {
    if (currentUid && communityId) {
      const memberRef = doc(db, "communities", communityId, "members", currentUid);
      updateDoc(memberRef, {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    }
  });
}

function listenForMemberUpdates() {
  const membersRef = collection(db, "communities", communityId, "members");
  
  onSnapshot(membersRef, (snapshot) => {
    let totalMembers = 0;
    let onlineCount = 0;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.role === 'creator' || data.role === 'admin' || data.role === 'member') {
        totalMembers++;
        
        if (data.lastSeen) {
          const lastSeen = new Date(data.lastSeen);
          if (lastSeen > fiveMinutesAgo) {
            onlineCount++;
          }
        }
      }
    });
    
    document.getElementById('onlineCount').textContent = onlineCount;
    document.getElementById('totalMembers').textContent = totalMembers;
  });
}

function listenForMessages() {
  const messagesRef = collection(db, "communities", communityId, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    let lastDate = null;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const messageDate = data.timestamp ? new Date(data.timestamp) : null;
      const isMine = data.sender === currentUsername;

      if (messageDate) {
        const dateStr = messageDate.toDateString();
        if (lastDate !== dateStr) {
          lastDate = dateStr;
          const divider = createDateDivider(messageDate);
          container.appendChild(divider);
        }
      }

      const messageEl = createMessageElement(data, doc.id, isMine);
      container.appendChild(messageEl);
    });

    container.scrollTop = container.scrollHeight;
  });
}

function createMessageElement(data, messageId, isMine) {
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
  div.setAttribute('data-message-id', messageId);

  let timeString = '';
  if (data.timestamp) {
    timeString = new Date(data.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  const senderHTML = !isMine ? `<div class="message-sender">${data.sender || 'Unknown'}</div>` : '';

  let replyHTML = '';
  if (data.replyTo) {
    replyHTML = `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>`;
  }

  let reactionsHTML = '';
  if (data.reactions && Object.keys(data.reactions).length > 0) {
    const uniqueReactions = [...new Set(Object.values(data.reactions))];
    reactionsHTML = `
      <div class="message-reactions">
        ${uniqueReactions.map(emoji => `<span class="reaction-badge">${emoji}</span>`).join('')}
      </div>
    `;
  }

  if (data.deletedForEveryone) {
    div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
  } else {
    div.innerHTML = `
      ${senderHTML}
      ${replyHTML}
      <div class="message-text">${data.text}</div>
      ${reactionsHTML}
      <div class="message-footer">
        <span class="message-time">${timeString}</span>
      </div>
    `;
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let swiped = false;

  div.addEventListener('touchstart', (e) => {
    if (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator') return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiped = false;
  }, { passive: true });

  div.addEventListener('touchmove', (e) => {
    if (!touchStartX || (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator')) return;
    
    const touchEndX = e.touches[0].clientX;
    const touchEndY = e.touches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = Math.abs(touchEndY - touchStartY);
    
    if (diffX > 50 && diffY < 30 && !swiped && !data.deletedForEveryone) {
      swiped = true;
      e.preventDefault();
      
      div.style.transform = 'translateX(10px)';
      div.style.transition = 'transform 0.2s';
      
      setTimeout(() => {
        div.style.transform = '';
      }, 200);
      
      replyToMessage(data.text);
    }
  }, { passive: false });

  div.addEventListener('touchend', () => {
    touchStartX = 0;
  });

  div.addEventListener('dblclick', (e) => {
    if (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator') return;
    e.preventDefault();
    if (!data.deletedForEveryone) {
      showReactionMenu(e, messageId, div);
    }
  });

  let pressTimer;
  div.addEventListener('touchstart', (e) => {
    if (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator') return;
    pressTimer = setTimeout(() => {
      if (!data.deletedForEveryone) {
        showReactionMenu(e, messageId, div);
      }
    }, 500);
  }, { passive: true });

  div.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
  });

  div.addEventListener('touchcancel', () => {
    clearTimeout(pressTimer);
  });

  if ((userRole === 'admin' || userRole === 'creator' || isMine) && !data.deletedForEveryone) {
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('Delete this message?')) {
        deleteMessage(messageId);
      }
    });
  }

  return div;
}

function createDateDivider(date) {
  const div = document.createElement('div');
  div.className = 'date-divider';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    div.textContent = 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    div.textContent = 'Yesterday';
  } else {
    div.textContent = date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  return div;
}

function showReactionMenu(event, messageId, messageElement) {
  document.querySelectorAll('.reaction-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'reaction-menu';
  
  const reactions = ['❤️', '😂', '🔥', '👍', '😮', '😢', '🎉', '🤔'];
  
  reactions.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    btn.textContent = emoji;
    btn.onclick = async (e) => {
      e.stopPropagation();
      await addReaction(messageId, emoji);
      menu.remove();
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const rect = messageElement.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.top - 50}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '10000';

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 100);
}

async function addReaction(messageId, emoji) {
  try {
    const messageRef = doc(db, "communities", communityId, "messages", messageId);
    await updateDoc(messageRef, {
      [`reactions.${currentUsername}`]: emoji
    });
  } catch (error) {
    console.error("Error adding reaction:", error);
  }
}

window.sendMessage = async function() {
  if (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator') {
    alert('You cannot send messages in this community');
    return;
  }

  const input = document.getElementById('messageInput');
  const text = input.value.trim();

  if (!text) return;

  const messagesRef = collection(db, "communities", communityId, "messages");

  await addDoc(messagesRef, {
    sender: currentUsername,
    senderId: currentUid,
    text: text,
    timestamp: new Date().toISOString(),
    deletedForEveryone: false,
    replyTo: replyingTo,
    reactions: {}
  });

  input.value = '';
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

window.replyToMessage = function(text) {
  replyingTo = text;
  const preview = document.getElementById('replyPreview');
  document.getElementById('replyText').textContent = 
    text.length > 50 ? text.substring(0, 50) + '...' : text;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
};

window.cancelReply = function() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

async function deleteMessage(messageId) {
  await updateDoc(doc(db, "communities", communityId, "messages", messageId), {
    deletedForEveryone: true,
    text: ''
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
    if (userRole === 'creator' || userRole === 'admin') {
      adminOptions.classList.remove('hidden');
    }
  }
};

window.viewMembers = function() {
  loadMembersList();
  document.getElementById('membersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadMembersList(filter = 'all') {
  const membersRef = collection(db, "communities", communityId, "members");
  const snapshot = await getDocs(membersRef);
  
  const membersList = document.getElementById('membersList');
  let membersHTML = '';
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
  
  const members = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.role === 'creator' || data.role === 'admin' || data.role === 'member') {
      const lastSeen = data.lastSeen ? new Date(data.lastSeen) : null;
      const isOnline = lastSeen && lastSeen > fiveMinutesAgo;
      
      members.push({
        id: doc.id,
        username: data.username,
        role: data.role || 'member',
        online: isOnline,
        lastSeen: data.lastSeen,
        joinedAt: data.joinedAt
      });
    }
  });
  
  let filteredMembers = members;
  if (filter === 'online') {
    filteredMembers = members.filter(m => m.online);
  } else if (filter === 'admins') {
    filteredMembers = members.filter(m => m.role === 'admin' || m.role === 'creator');
  }
  
  filteredMembers.sort((a, b) => {
    if (a.role === 'creator') return -1;
    if (b.role === 'creator') return 1;
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  
  filteredMembers.forEach(member => {
    const roleBadge = member.role === 'creator' ? '👑 Creator' : (member.role === 'admin' ? '⚡ Admin' : '');
    const onlineClass = member.online ? 'online' : 'offline';
    const onlineText = member.online ? 'Online' : (member.lastSeen ? formatLastSeen(new Date(member.lastSeen)) : 'Offline');
    
    membersHTML += `
      <div class="member-item">
        <div class="member-avatar">${member.username[0].toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">
            ${member.username}
            ${roleBadge ? `<span class="role-badge">${roleBadge}</span>` : ''}
          </div>
          <div class="member-status ${onlineClass}">${onlineText}</div>
        </div>
      </div>
    `;
  });
  
  membersList.innerHTML = membersHTML || '<div class="no-members">No members found</div>';
}

window.switchMembersTab = function(tab) {
  document.getElementById('allTab').classList.remove('active');
  document.getElementById('onlineTab').classList.remove('active');
  document.getElementById('adminsTab').classList.remove('active');
  document.getElementById(tab + 'Tab').classList.add('active');
  loadMembersList(tab);
};

window.viewMyRequests = function() {
  loadMyRequests();
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadMyRequests() {
  try {
    const requestsRef = collection(db, "communities", communityId, "requests");
    const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      alert('You have no pending requests for this community');
      return;
    }
    
    let message = 'Your pending requests:\n';
    snapshot.forEach(doc => {
      const data = doc.data();
      message += `- Requested: ${formatTime(data.requestedAt)}\n`;
    });
    
    alert(message);
    
  } catch (error) {
    console.error("Error loading requests:", error);
    alert('Failed to load requests');
  }
}

window.leaveCommunity = async function() {
  if (userRole === 'creator') {
    if (!confirm('Are you sure you want to delete this community? This action cannot be undone.')) return;
    
    try {
      const batch = writeBatch(db);
      
      const messagesRef = collection(db, "communities", communityId, "messages");
      const messagesSnap = await getDocs(messagesRef);
      messagesSnap.forEach(doc => batch.delete(doc.ref));
      
      const membersRef = collection(db, "communities", communityId, "members");
      const membersSnap = await getDocs(membersRef);
      membersSnap.forEach(doc => batch.delete(doc.ref));
      
      const requestsRef = collection(db, "communities", communityId, "requests");
      const requestsSnap = await getDocs(requestsRef);
      requestsSnap.forEach(doc => batch.delete(doc.ref));
      
      const bannedRef = collection(db, "communities", communityId, "banned");
      const bannedSnap = await getDocs(bannedRef);
      bannedSnap.forEach(doc => batch.delete(doc.ref));
      
      batch.delete(doc(db, "communities", communityId));
      
      await batch.commit();
      
      alert('Community deleted');
      window.location.href = 'community.html';
      
    } catch (error) {
      console.error("Delete community error:", error);
      alert('Failed to delete community');
    }
    
  } else {
    if (!confirm('Leave this community?')) return;
    
    try {
      await deleteDoc(doc(db, "communities", communityId, "members", currentUid));
      alert('Left community');
      window.location.href = 'community.html';
    } catch (error) {
      console.error("Leave community error:", error);
    }
  }
};

window.manageRequests = function() {
  console.log("Opening manage requests modal");
  loadRequestsList();
  document.getElementById('requestsModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadRequestsList() {
  console.log("Loading requests for community:", communityId);
  
  try {
    const requestsRef = collection(db, "communities", communityId, "requests");
    const q = query(requestsRef, where("status", "==", "pending"));
    const snapshot = await getDocs(q);
    
    console.log("Requests found:", snapshot.size);
    
    const requestsList = document.getElementById('requestsList');
    
    if (snapshot.empty) {
      requestsList.innerHTML = '<div class="no-requests">No pending requests</div>';
      return;
    }
    
    let requestsHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log("Request data:", data);
      
      requestsHTML += `
        <div class="request-item" data-id="${doc.id}">
          <div class="request-avatar">${data.username ? data.username[0].toUpperCase() : '?'}</div>
          <div class="request-details">
            <div class="request-from">${data.username || 'Unknown User'}</div>
            <div class="request-time">${formatTime(data.requestedAt)}</div>
          </div>
          <div class="request-actions">
            <button onclick="approveRequest('${doc.id}', '${data.userId}', '${data.username}')" class="accept-btn">✓ Approve</button>
            <button onclick="declineRequest('${doc.id}')" class="decline-btn">✕ Decline</button>
          </div>
        </div>
      `;
    });
    
    requestsList.innerHTML = requestsHTML;
    
  } catch (error) {
    console.error("Error loading requests:", error);
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading requests</div>';
  }
}

window.approveRequest = async function(requestId, userId, username) {
  console.log("Approving request:", requestId, "for user:", username);
  
  try {
    const memberRef = doc(db, "communities", communityId, "members", userId);
    const memberSnap = await getDoc(memberRef);
    
    if (memberSnap.exists()) {
      alert('User is already a member');
      await deleteDoc(doc(db, "communities", communityId, "requests", requestId));
      loadRequestsList();
      return;
    }
    
    await setDoc(memberRef, {
      username: username,
      role: 'member',
      status: 'member',
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      online: false
    });
    
    await deleteDoc(doc(db, "communities", communityId, "requests", requestId));
    
    alert('Request approved! ' + username + ' is now a member');
    loadRequestsList();
    
  } catch (error) {
    console.error("Approve request error:", error);
    alert('Failed to approve request: ' + error.message);
  }
};

window.declineRequest = async function(requestId) {
  console.log("Declining request:", requestId);
  
  if (confirm('Decline this request?')) {
    try {
      await deleteDoc(doc(db, "communities", communityId, "requests", requestId));
      alert('Request declined');
      loadRequestsList();
    } catch (error) {
      console.error("Decline request error:", error);
      alert('Failed to decline request');
    }
  }
};

window.manageMembers = function() {
  loadManageMembersList();
  document.getElementById('manageMembersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

async function loadManageMembersList(searchTerm = '') {
  const membersRef = collection(db, "communities", communityId, "members");
  const snapshot = await getDocs(membersRef);
  
  const membersList = document.getElementById('manageMembersList');
  let membersHTML = '';
  
  const members = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    members.push({
      id: doc.id,
      username: data.username,
      role: data.role || 'member',
      online: data.online || false,
      lastSeen: data.lastSeen
    });
  });
  
  let filteredMembers = members;
  if (searchTerm) {
    filteredMembers = members.filter(m => 
      m.username.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
  
  filteredMembers.sort((a, b) => {
    if (a.role === 'creator') return -1;
    if (b.role === 'creator') return 1;
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  
  filteredMembers.forEach(member => {
    const roleBadge = member.role === 'creator' ? '👑 Creator' : (member.role === 'admin' ? '⚡ Admin' : 'Member');
    const onlineClass = member.online ? 'online' : 'offline';
    
    let actions = '';
    if (member.role !== 'creator' && member.id !== currentUid) {
      if (userRole === 'creator' || (userRole === 'admin' && member.role !== 'admin')) {
        actions = `
          <div class="member-actions">
            ${member.role !== 'admin' ? `<button onclick="makeAdmin('${member.id}')" class="action-btn promote">⭐ Make Admin</button>` : ''}
            <button onclick="banMember('${member.id}', '${member.username}')" class="action-btn ban">🚫 Ban</button>
          </div>
        `;
      }
    }
    
    membersHTML += `
      <div class="manage-member-item">
        <div class="member-info">
          <div class="member-avatar">${member.username[0].toUpperCase()}</div>
          <div class="member-details">
            <div class="member-name">
              ${member.username}
              <span class="role-badge">${roleBadge}</span>
            </div>
            <div class="member-status ${onlineClass}">
              ${member.online ? 'Online' : (member.lastSeen ? `Last seen ${formatLastSeen(new Date(member.lastSeen))}` : 'Offline')}
            </div>
          </div>
        </div>
        ${actions}
      </div>
    `;
  });
  
  membersList.innerHTML = membersHTML || '<div class="no-members">No members found</div>';
  
  const searchInput = document.getElementById('searchMember');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      loadManageMembersList(e.target.value);
    });
  }
}

window.makeAdmin = async function(userId) {
  if (!confirm('Make this user an admin?')) return;
  
  try {
    await updateDoc(doc(db, "communities", communityId, "members", userId), {
      role: 'admin'
    });
    alert('User is now an admin');
    loadManageMembersList();
  } catch (error) {
    console.error("Make admin error:", error);
    alert('Failed to make admin');
  }
};

window.banMember = async function(userId, username) {
  if (!confirm(`Ban ${username} from this community?`)) return;
  
  try {
    const batch = writeBatch(db);
    
    const bannedRef = doc(db, "communities", communityId, "banned", userId);
    batch.set(bannedRef, {
      username: username,
      bannedAt: new Date().toISOString(),
      bannedBy: currentUsername
    });
    
    batch.delete(doc(db, "communities", communityId, "members", userId));
    
    await batch.commit();
    
    alert('User banned');
    loadManageMembersList();
    
  } catch (error) {
    console.error("Ban member error:", error);
    alert('Failed to ban user');
  }
};

window.editCommunity = function() {
  alert('Edit community feature coming soon');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

window.hideModal = function(modalId) {
  document.getElementById(modalId).classList.add('hidden');
};

function formatTime(timestamp) {
  if (!timestamp) return 'Recently';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000 / 60);
  
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} minutes ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
  return date.toLocaleDateString();
}

function formatLastSeen(date) {
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 1000 / 60);
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} hours ago`;
  return date.toLocaleDateString();
}