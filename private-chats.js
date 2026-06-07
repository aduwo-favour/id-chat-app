import { auth, db, watchBanStatus } from "./firebase.js";
import { Cache } from "./cache.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, query, where, getDocs, onSnapshot,
  doc, getDoc, addDoc, deleteDoc, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;
let unsubscribeChats = null;

window.goBack = function() { 
  if (unsubscribeChats) unsubscribeChats();
  window.location.href = 'dashboard.html'; 
};

window.startNewChat = function() { 
  document.getElementById('searchUser').focus(); 
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { 
    window.location.href = 'index.html'; 
    return; 
  }
  currentUid = user.uid;
    watchBanStatus(user.uid, async () => {
      await signOut(auth);
      window.location.href = 'index.html';
    });
  
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      alert('User data not found');
      return;
    }
    currentUsername = userDoc.data().username;
    loadChats();
  } catch (error) {
    console.error('Auth error:', error);
    document.getElementById('chatsList').innerHTML = '<div class="error-message">Error loading user data</div>';
  }
});

function loadChats() {
  if (!currentUsername) return;
  
  const chatsList = document.getElementById('chatsList');

  // Render cached chat list instantly while Firestore loads
  const cached = Cache.get('chats_' + currentUsername);
  if (cached) {
    chatsList.innerHTML = cached;
  } else {
    chatsList.innerHTML = '<div class="loading">Loading chats...</div>';
  }
  
  try {
    const chatsQuery = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUsername),
      where("status", "==", "accepted")
    );

    unsubscribeChats = onSnapshot(chatsQuery, async (snapshot) => {
      if (snapshot.empty) {
        chatsList.innerHTML = '<div class="no-chats">No chats yet. Search for users!</div>';
        return;
      }

      const promises = [];

      snapshot.forEach(chatDoc => {
        const chatData = chatDoc.data();
        const otherUser = chatData.participants.find(p => p !== currentUsername);

        promises.push(
          getUserStatus(otherUser)
            .then(status => {
              const unread = chatData.unread?.[currentUsername] || 0;
              const badge = unread > 0 ? `<span class="unread-count">${unread}</span>` : '';
              const verifiedBadge = status.verified ? '<span class="verified-badge" title="Verified Account">✓</span>' : '';
              const lastMessageAt = chatData.lastMessageAt || chatData.createdAt || '';
              const lastText = chatData.lastMessageText
                ? (chatData.lastMessageSender === currentUsername ? 'You: ' : '') + escapeHtml(chatData.lastMessageText)
                : '<em style="opacity:0.5">No messages yet</em>';
              const onlineDot = status.online
                ? '<span style="display:inline-block;width:8px;height:8px;background:#44d;border-radius:50%;margin-right:4px;vertical-align:middle"></span>'
                : '';

              return {
                html: `
                  <div class="chat-item" onclick="openChat('${chatDoc.id}', '${otherUser}')">
                    <div class="chat-avatar">${otherUser ? otherUser[0].toUpperCase() : '?'}</div>
                    <div class="chat-details" style="flex:1;min-width:0">
                      <div style="display:flex;justify-content:space-between;align-items:center">
                        <div class="chat-name">${escapeHtml(otherUser || 'Unknown')} ${verifiedBadge}</div>
                        ${lastMessageAt ? `<span style="font-size:0.7rem;color:var(--text3);flex-shrink:0;margin-left:6px">${formatChatTime(lastMessageAt)}</span>` : ''}
                      </div>
                      <div style="font-size:0.82rem;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${onlineDot}${lastText}</div>
                    </div>
                    ${badge}
                  </div>
                `,
                lastMessageAt
              };
            })
            .catch(err => {
              console.error('Error getting user status:', err);
              return null;
            })
        );
      });

      const items = (await Promise.all(promises)).filter(Boolean);

      // Sort: most recent message first
      items.sort((a, b) => {
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      });

      const html = items.map(i => i.html).join('') || '<div class="no-chats">No chats available</div>';
      chatsList.innerHTML = html;
      // Cache the rendered HTML for instant next load
      Cache.set('chats_' + currentUsername, html);

    }, (error) => {
      console.error('Chats listener error:', error);
      chatsList.innerHTML = '<div class="error-message">Failed to load chats. Check console.</div>';
    });
  } catch (error) {
    console.error('Error setting up chats listener:', error);
    chatsList.innerHTML = '<div class="error-message">Error initializing chats</div>';
  }
}

async function getUserStatus(username) {
  if (!username) return { online: false, lastSeen: 'Offline', verified: false };

  // Cache user status for 30 seconds — frequent enough to stay current
  const cacheKey = 'ustatus_' + username;
  const cached = Cache.get(cacheKey, 30000);
  if (cached) return cached;
  
  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      const now = new Date();
      const twoMinAgo = new Date(now.getTime() - 120000);
      
      let online = false;
      if (data.online === true && data.lastSeen) {
        const lastSeen = new Date(data.lastSeen);
        if (lastSeen > twoMinAgo) {
          online = true;
        }
      }
      
      let lastSeenText = 'Offline';
      if (data.lastSeen) {
        const lastSeen = new Date(data.lastSeen);
        lastSeenText = `Last seen ${formatLastSeen(lastSeen)}`;
      }
      
      return {
        online,
        lastSeen: online ? 'Online' : lastSeenText,
        verified: data.verified || false
      };
      Cache.set(cacheKey, result);
      return result;
    }
  } catch (error) {
    console.error('Error in getUserStatus:', error);
  }
  return { online: false, lastSeen: 'Offline', verified: false };
}

function formatLastSeen(date) {
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatChatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return diffMins + 'm';
    if (diffDays < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

window.searchUsers = async function() {
  const term = document.getElementById('searchUser').value.trim();
  const resultsDiv = document.getElementById('searchResults');
  
  if (!term || term === currentUsername) {
    resultsDiv.innerHTML = '';
    return;
  }

  resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
  
  try {
    const q = query(
      collection(db, "users"),
      where("username", ">=", term),
      where("username", "<=", term + '\uf8ff')
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      resultsDiv.innerHTML = '<div class="no-results">No users found</div>';
      return;
    }

    let html = '<div class="search-header">Results:</div>';
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      if (userData.username !== currentUsername) {
        const status = await checkRequestStatus(userData.username);
        const verifiedBadge = userData.verified ? '<span class="verified-badge" title="Verified Account">✓</span>' : '';
        html += `
          <div class="search-result-item">
            <span>${escapeHtml(userData.username)} ${verifiedBadge}</span>
            ${getRequestButton(userData.username, status)}
          </div>
        `;
      }
    }
    resultsDiv.innerHTML = html;
  } catch (error) {
    console.error('Search error:', error);
    resultsDiv.innerHTML = '<div class="error-message">Search failed. Please try again.</div>'; console.error('Search error:', error);
  }
};

async function checkRequestStatus(toUser) {
  try {
    // Check if already friends (accepted chat exists)
    const chatId = [currentUsername, toUser].sort().join('_');
    const chatSnap = await getDoc(doc(db, "chats", chatId));
    if (chatSnap.exists() && chatSnap.data().status === "accepted") {
      return "friends";
    }

    // Check pending/declined request
    const q = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const data = snap.docs[0].data();
      return data.status === "pending" ? "pending" : "declined";
    }

    // Also check if THEY sent us a request we haven't answered yet
    const inboundQ = query(
      collection(db, "requests"),
      where("from", "==", toUser),
      where("to", "==", currentUsername),
      where("status", "==", "pending")
    );
    const inboundSnap = await getDocs(inboundQ);
    if (!inboundSnap.empty) return "inbound";

  } catch (error) {
    console.error('Error checking request status:', error);
  }
  return "none";
}

function getRequestButton(username, status) {
  switch(status) {
    case "friends":  return '<span class="pending-badge" style="background:#e8f8f0;color:#38a169">✓ Already Friends</span>';
    case "pending":  return '<span class="pending-badge">Request Sent</span>';
    case "inbound":  return '<span class="pending-badge" style="background:#fff3e0;color:#f57c00">Sent you a request</span>';
    case "declined": return `<button onclick="sendRequest('${username}')" class="start-chat-btn">Send Request</button>`;
    default:         return `<button onclick="sendRequest('${username}')" class="start-chat-btn">Send Request</button>`;
  }
}

window.sendRequest = async function(toUser) {
  try {
    // Check if user exists and is not blocked
    const q = query(collection(db, "users"), where("username", "==", toUser));
    const userSnap = await getDocs(q);
    if (userSnap.empty) { 
      alert('User not found'); 
      return; 
    }
    
    const userData = userSnap.docs[0].data();
    if (userData.blockedUsers?.includes(currentUsername)) {
      alert('You cannot send a request to this user (you are blocked)');
      return;
    }

    // Check for existing pending request
    const pendingQ = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser),
      where("status", "==", "pending")
    );
    const pendingSnap = await getDocs(pendingQ);
    if (!pendingSnap.empty) {
      alert('You already have a pending request');
      return;
    }

    // Check for declined requests (optional: you may want to allow resend after some time)
    const declinedQ = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser),
      where("status", "==", "declined")
    );
    const declinedSnap = await getDocs(declinedQ);
    
    const batch = writeBatch(db);
    // Delete old declined requests
    declinedSnap.forEach(d => batch.delete(d.ref));
    
    // Create new request with a DETERMINISTIC id ("from_to") so security rules
    // can verify it exists when the recipient accepts (rules can't run queries).
    const newRequestRef = doc(db, "requests", `${currentUsername}_${toUser}`);
    batch.set(newRequestRef, {
      from: currentUsername,
      to: toUser,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    
    await batch.commit();
    alert('Request sent!');
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchUser').value = '';
  } catch (error) {
    console.error('Send request error:', error);
    alert('Failed: ' + error.message);
  }
};

window.openChat = function(chatId, username) {
  if (unsubscribeChats) unsubscribeChats();
  window.location.href = `chat.html?chatId=${encodeURIComponent(chatId)}&user=${encodeURIComponent(username)}`;
};

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (unsubscribeChats) unsubscribeChats();
});