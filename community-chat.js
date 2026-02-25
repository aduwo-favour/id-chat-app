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
  setDoc,
  limit
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;
let communityId = null;
let communityName = null;
let replyingTo = null;
let userRole = null; // 'creator', 'admin', 'member', 'pending', 'banned'
let onlineInterval = null;

// Get URL params
const urlParams = new URLSearchParams(window.location.search);
communityId = urlParams.get('communityId');
communityName = urlParams.get('name');

if (!communityId) {
  window.location.href = 'community.html';
}

// Go back
window.goBack = function() {
  window.location.href = 'community.html';
};

// Check authentication
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
    
    // Check user's role in community
    await checkUserRole();
    
    // Listen for messages
    listenForMessages();
    
    // Update online status
    updateOnlineStatus();
    startOnlineStatusUpdates();
    
    // Listen for member updates
    listenForMemberUpdates();
  }
});

// Check user's role in community
async function checkUserRole() {
  try {
    // Check if user is a member
    const memberRef = doc(db, "communities", communityId, "members", currentUid);
    const memberSnap = await getDoc(memberRef);
    
    if (memberSnap.exists()) {
      const data = memberSnap.data();
      userRole = data.role || 'member';
      
      // User is a member - enable chat
      enableChat();
      
      // Show admin options if applicable
      if (userRole === 'creator' || userRole === 'admin') {
        showAdminOptions();
      }
      
      // Update UI based on role
      updateUIForRole();
      
    } else {
      // Check if banned
      const bannedRef = doc(db, "communities", communityId, "banned", currentUid);
      const bannedSnap = await getDoc(bannedRef);
      
      if (bannedSnap.exists()) {
        userRole = 'banned';
        showBannedBanner();
      } else {
        // Check for pending request
        const requestsRef = collection(db, "communities", communityId, "requests");
        const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
        const requestsSnap = await getDocs(q);
        
        if (!requestsSnap.empty) {
          userRole = 'pending';
          showPendingBanner();
        } else {
          userRole = 'none';
          showJoinBanner();
        }
      }
    }
    
  } catch (error) {
    console.error("Error checking user role:", error);
  }
}

// Enable chat for members
function enableChat() {
  document.getElementById('messageInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('joinBanner')?.classList.add('hidden');
  document.getElementById('pendingBanner')?.classList.add('hidden');
  document.getElementById('bannedBanner')?.classList.add('hidden');
  document.getElementById('chatInputArea').classList.remove('hidden');
}

// Show join banner
function showJoinBanner() {
  document.getElementById('joinBanner').classList.remove('hidden');
  document.getElementById('chatInputArea').classList.add('hidden');
}

// Show pending banner
function showPendingBanner() {
  document.getElementById('pendingBanner').classList.remove('hidden');
  document.getElementById('chatInputArea').classList.add('hidden');
}

// Show banned banner
function showBannedBanner() {
  document.getElementById('bannedBanner').classList.remove('hidden');
  document.getElementById('chatInputArea').classList.add('hidden');
}

// Show admin options
function showAdminOptions() {
  const adminOptions = document.getElementById('adminOptions');
  adminOptions.classList.remove('hidden');
}

// Update UI based on role
function updateUIForRole() {
  const leaveBtn = document.getElementById('leaveBtn');
  if (userRole === 'creator') {
    leaveBtn.textContent = 'Delete Community';
  } else {
    leaveBtn.textContent = 'Leave Community';
  }
}

// Update online status
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

// Start periodic online status updates
function startOnlineStatusUpdates() {
  if (onlineInterval) clearInterval(onlineInterval);
  
  // Update every 30 seconds
  onlineInterval = setInterval(() => {
    updateOnlineStatus();
  }, 30000);
  
  // Update on page unload
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

// Listen for member updates (online counts)
function listenForMemberUpdates() {
  const membersRef = collection(db, "communities", communityId, "members");
  
  onSnapshot(membersRef, (snapshot) => {
    let totalMembers = 0;
    let onlineCount = 0;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'member' || data.status === 'admin' || data.status === 'creator') {
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

// Listen for messages
function listenForMessages() {
  const messagesRef = collection(db, "communities", communityId, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    let lastDate = null;

    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Don't show messages from banned users? Optional
      // if (data.senderBanned) return;

      const messageDate = data.timestamp ? new Date(data.timestamp) : null;
      const isMine = data.sender === currentUsername;

      // Date divider
      if (messageDate) {
        const dateStr = messageDate.toDateString();
        if (lastDate !== dateStr) {
          lastDate = dateStr;
          const divider = createDateDivider(messageDate);
          container.appendChild(divider);
        }
      }

      // Create message element
      const messageEl = createMessageElement(data, doc.id, isMine);
      container.appendChild(messageEl);
    });

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  });
}

// Create message element
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

  // Sender name (for community messages)
  const senderHTML = !isMine ? `<div class="message-sender">${data.sender || 'Unknown'}</div>` : '';

  // Reply preview
  let replyHTML = '';
  if (data.replyTo) {
    replyHTML = `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>`;
  }

  // Reactions
  let reactionsHTML = '';
  if (data.reactions && Object.keys(data.reactions).length > 0) {
    const uniqueReactions = [...new Set(Object.values(data.reactions))];
    reactionsHTML = `
      <div class="message-reactions">
        ${uniqueReactions.map(emoji => `<span class="reaction-badge">${emoji}</span>`).join('')}
      </div>
    `;
  }

  // Deleted message
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

  // SWIPE TO REPLY (Touch events)
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

  // DOUBLE CLICK FOR REACTIONS
  div.addEventListener('dblclick', (e) => {
    if (userRole !== 'member' && userRole !== 'admin' && userRole !== 'creator') return;
    e.preventDefault();
    if (!data.deletedForEveryone) {
      showReactionMenu(e, messageId, div);
    }
  });

  // LONG PRESS FOR REACTIONS
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

  // DELETE FOR ADMINS/CREATOR (or own messages)
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

// Create date divider
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

// Show reaction menu
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

// Add reaction
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

// Send message
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

// Reply to message
window.replyToMessage = function(text) {
  replyingTo = text;
  const preview = document.getElementById('replyPreview');
  document.getElementById('replyText').textContent = 
    text.length > 50 ? text.substring(0, 50) + '...' : text;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
};

// Cancel reply
window.cancelReply = function() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

// Delete message
async function deleteMessage(messageId) {
  await updateDoc(doc(db, "communities", communityId, "messages", messageId), {
    deletedForEveryone: true,
    text: ''
  });
}

// Request to join
window.requestToJoin = async function() {
  try {
    // Check if already has pending request
    const requestsRef = collection(db, "communities", communityId, "requests");
    const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
    const existingSnap = await getDocs(q);
    
    if (!existingSnap.empty) {
      alert('You already have a pending request');
      return;
    }

    await addDoc(collection(db, "communities", communityId, "requests"), {
      userId: currentUid,
      username: currentUsername,
      status: 'pending',
      requestedAt: new Date().toISOString()
    });
    
    alert('Join request sent!');
    showPendingBanner();
    
  } catch (error) {
    console.error("Request to join error:", error);
    alert('Failed to send request');
  }
};

// Toggle community options
window.toggleCommunityOptions = function() {
  document.getElementById('communityOptions').classList.toggle('hidden');
};

// View members
window.viewMembers = function() {
  loadMembersList();
  document.getElementById('membersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
};

// Load members list
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
    if (data.status === 'member' || data.status === 'admin' || data.status === 'creator') {
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
  
  // Filter based on tab
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

// Switch members tab
window.switchMembersTab = function(tab) {
  document.getElementById('allTab').classList.remove('active');
  document.getElementById('onlineTab').classList.remove('active');
  document.getElementById('adminsTab').classList.remove('active');
  document.getElementById(tab + 'Tab').classList.add('active');
  
  loadMembersList(tab);
};

// View my requests
window.viewMyRequests = function() {
  // Implement if needed
  alert('Coming soon');
};

// Leave or delete community
window.leaveCommunity = async function() {
  if (userRole === 'creator') {
    if (!confirm('Are you sure you want to delete this community? This action cannot be undone.')) return;
    
    try {
      // Delete all subcollections (messages, members, requests, banned)
      const batch = writeBatch(db);
      
      // Delete messages
      const messagesRef = collection(db, "communities", communityId, "messages");
      const messagesSnap = await getDocs(messagesRef);
      messagesSnap.forEach(doc => batch.delete(doc.ref));
      
      // Delete members
      const membersRef = collection(db, "communities", communityId, "members");
      const membersSnap = await getDocs(membersRef);
      membersSnap.forEach(doc => batch.delete(doc.ref));
      
      // Delete requests
      const requestsRef = collection(db, "communities", communityId, "requests");
      const requestsSnap = await getDocs(requestsRef);
      requestsSnap.forEach(doc => batch.delete(doc.ref));
      
      // Delete banned
      const bannedRef = collection(db, "communities", communityId, "banned");
      const bannedSnap = await getDocs(bannedRef);
      bannedSnap.forEach(doc => batch.delete(doc.ref));
      
      // Delete community
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

// Manage requests (admin only)
window.manageRequests = function() {
  loadRequestsList();
  document.getElementById('requestsModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

// Load requests list
async function loadRequestsList() {
  const requestsRef = collection(db, "communities", communityId, "requests");
  const q = query(requestsRef, where("status", "==", "pending"), orderBy("requestedAt", "desc"));
  const snapshot = await getDocs(q);
  
  const requestsList = document.getElementById('requestsList');
  
  if (snapshot.empty) {
    requestsList.innerHTML = '<div class="no-requests">No pending requests</div>';
    return;
  }
  
  let requestsHTML = '';
  snapshot.forEach(doc => {
    const data = doc.data();
    requestsHTML += `
      <div class="request-item" data-id="${doc.id}">
        <div class="request-avatar">${data.username[0].toUpperCase()}</div>
        <div class="request-details">
          <div class="request-from">${data.username}</div>
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
}

// Approve request
window.approveRequest = async function(requestId, userId, username) {
  try {
    // Add as member
    await setDoc(doc(db, "communities", communityId, "members", userId), {
      username: username,
      role: 'member',
      status: 'member',
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      online: false
    });
    
    // Delete request
    await deleteDoc(doc(db, "communities", communityId, "requests", requestId));
    
    alert('Request approved');
    loadRequestsList();
    
  } catch (error) {
    console.error("Approve request error:", error);
    alert('Failed to approve request');
  }
};

// Decline request
window.declineRequest = async function(requestId) {
  if (confirm('Decline this request?')) {
    try {
      await deleteDoc(doc(db, "communities", communityId, "requests", requestId));
      loadRequestsList();
    } catch (error) {
      console.error("Decline request error:", error);
    }
  }
};

// Manage members (admin only)
window.manageMembers = function() {
  loadManageMembersList();
  document.getElementById('manageMembersModal').classList.remove('hidden');
  document.getElementById('communityOptions').classList.add('hidden');
  document.getElementById('adminOptions').classList.add('hidden');
};

// Load manage members list
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
  
  // Filter by search
  let filteredMembers = members;
  if (searchTerm) {
    filteredMembers = members.filter(m => 
      m.username.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
  
  // Sort: creator first, then admins, then members
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
    
    // Don't show actions for creator or self
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
  
  // Add search functionality
  document.getElementById('searchMember').addEventListener('input', (e) => {
    loadManageMembersList(e.target.value);
  });
}

// Make admin
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

// Ban member
window.banMember = async function(userId, username) {
  if (!confirm(`Ban ${username} from this community?`)) return;
  
  try {
    const batch = writeBatch(db);
    
    // Add to banned collection
    const bannedRef = doc(db, "communities", communityId, "banned", userId);
    batch.set(bannedRef, {
      username: username,
      bannedAt: new Date().toISOString(),
      bannedBy: currentUsername
    });
    
    // Remove from members
    batch.delete(doc(db, "communities", communityId, "members", userId));
    
    await batch.commit();
    
    alert('User banned');
    loadManageMembersList();
    
  } catch (error) {
    console.error("Ban member error:", error);
    alert('Failed to ban user');
  }
};

// Edit community
window.editCommunity = function() {
  alert('Edit community feature coming soon');
};

// Hide modal
window.hideModal = function(modalId) {
  document.getElementById(modalId).classList.add('hidden');
};

// Format time for requests
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

// Format last seen
function formatLastSeen(date) {
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 1000 / 60);
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} hours ago`;
  return date.toLocaleDateString();
}