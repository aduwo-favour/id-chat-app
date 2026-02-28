import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, query, where, getDocs, onSnapshot,
  doc, getDoc, addDoc, deleteDoc, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

window.goBack = function() { window.location.href = 'dashboard.html'; };
window.startNewChat = function() { document.getElementById('searchUser').focus(); };

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadChats();
  }
});

function loadChats() {
  if (!currentUsername) return;
  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUsername),
    where("status", "==", "accepted")
  );

  onSnapshot(chatsQuery, async (snapshot) => {
    const chatsList = document.getElementById('chatsList');
    if (snapshot.empty) {
      chatsList.innerHTML = '<div class="no-chats">No chats yet. Search for users!</div>';
      return;
    }

    let chatsHTML = '';
    const promises = [];

    snapshot.forEach(doc => {
      const chatData = doc.data();
      const otherUser = chatData.participants.find(p => p !== currentUsername);
      
      promises.push(getUserStatus(otherUser).then(status => {
        const unread = chatData.unread?.[currentUsername] || 0;
        const badge = unread > 0 ? `<span class="unread-count">${unread}</span>` : '';
        const statusClass = status.online ? 'online' : 'offline';
        const statusText = status.online ? 'Online' : status.lastSeen;
        const verifiedBadge = status.verified ? '<span class="verified-badge" title="Verified Account">✓</span>' : '';

        return `
          <div class="chat-item" onclick="openChat('${doc.id}', '${otherUser}')">
            <div class="chat-avatar">${otherUser ? otherUser[0].toUpperCase() : '?'}</div>
            <div class="chat-details">
              <div class="chat-name">${otherUser || 'Unknown'} ${verifiedBadge}</div>
              <div class="chat-status ${statusClass}">${statusText}</div>
            </div>
            ${badge}
          </div>
        `;
      }));
    });

    const items = await Promise.all(promises);
    chatsList.innerHTML = items.join('');
  });
}

async function getUserStatus(username) {
  if (!username) return { online: false, lastSeen: 'Offline', verified: false };
  
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

window.searchUsers = async function() {
  const term = document.getElementById('searchUser').value.trim();
  if (!term || term === currentUsername) {
    document.getElementById('searchResults').innerHTML = '';
    return;
  }

  const resultsDiv = document.getElementById('searchResults');
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
            <span>${userData.username} ${verifiedBadge}</span>
            ${getRequestButton(userData.username, status)}
          </div>
        `;
      }
    }
    resultsDiv.innerHTML = html;
  } catch (error) {
    resultsDiv.innerHTML = '<div class="error-message">Search failed</div>';
  }
};

async function checkRequestStatus(toUser) {
  try {
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
  } catch (error) {}
  return "none";
}

function getRequestButton(username, status) {
  switch(status) {
    case "pending": return '<span class="pending-badge">Pending</span>';
    case "declined": return '<span class="declined-badge">Declined</span>';
    default: return `<button onclick="sendRequest('${username}')" class="start-chat-btn">Send Request</button>`;
  }
}

window.sendRequest = async function(toUser) {
  try {
    const q = query(collection(db, "users"), where("username", "==", toUser));
    const userSnap = await getDocs(q);
    if (userSnap.empty) { alert('User not found'); return; }
    
    const userData = userSnap.docs[0].data();
    if (userData.blockedUsers?.includes(currentUsername)) {
      alert('You cannot send a request to this user');
      return;
    }

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

    const declinedQ = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser),
      where("status", "==", "declined")
    );
    const declinedSnap = await getDocs(declinedQ);
    
    const batch = writeBatch(db);
    declinedSnap.forEach(d => batch.delete(d.ref));
    
    const newRequestRef = doc(collection(db, "requests"));
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
    alert('Failed: ' + error.message);
  }
};

window.openChat = function(chatId, username) {
  window.location.href = `chat.html?chatId=${chatId}&user=${username}`;
};
