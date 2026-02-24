import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  addDoc,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadChats();
  }
});

// Load only accepted chats
function loadChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUsername),
    where("status", "==", "accepted")  // Only show accepted chats
  );

  onSnapshot(chatsQuery, async (snapshot) => {
    const chatsList = document.getElementById('chatsList');
    
    if (snapshot.empty) {
      chatsList.innerHTML = '<div class="no-chats">No chats yet. Search for users to start chatting!</div>';
      return;
    }

    let chatsHTML = '';
    const chatPromises = [];

    snapshot.forEach(doc => {
      const chatData = doc.data();
      const otherUser = chatData.participants.find(p => p !== currentUsername);
      
      const promise = getUserStatus(otherUser).then(status => {
        const unread = chatData.unread?.[currentUsername] || 0;
        const unreadBadge = unread > 0 ? `<span class="unread-count">${unread}</span>` : '';
        const statusClass = status.online ? 'online' : 'offline';
        const statusText = status.online ? 'Online' : status.lastSeen;

        return `
          <div class="chat-item" onclick="openChat('${doc.id}', '${otherUser}')">
            <div class="chat-avatar">${otherUser[0].toUpperCase()}</div>
            <div class="chat-details">
              <div class="chat-name">${otherUser}</div>
              <div class="chat-status ${statusClass}">${statusText}</div>
            </div>
            ${unreadBadge}
          </div>
        `;
      });

      chatPromises.push(promise);
    });

    const chatItems = await Promise.all(chatPromises);
    chatsList.innerHTML = chatItems.join('');
  });
}

// Get user online status
async function getUserStatus(username) {
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", username));
  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    const data = snapshot.docs[0].data();
    const lastSeen = data.lastSeen ? new Date(data.lastSeen) : null;
    const timeAgo = lastSeen ? formatLastSeen(lastSeen) : 'Offline';
    
    return {
      online: data.online || false,
      lastSeen: timeAgo
    };
  }
  return { online: false, lastSeen: 'Offline' };
}

// Format last seen
function formatLastSeen(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000 / 60);

  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return date.toLocaleDateString();
}

// Search users
window.searchUsers = async function() {
  const searchTerm = document.getElementById('searchUser').value.trim();
  if (!searchTerm || searchTerm === currentUsername) return;

  const resultsDiv = document.getElementById('searchResults');
  
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", ">=", searchTerm), where("username", "<=", searchTerm + '\uf8ff'));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    resultsDiv.innerHTML = '<div class="no-results">No users found</div>';
    return;
  }

  let resultsHTML = '<div class="search-header">Search Results:</div>';
  
  for (const doc of snapshot.docs) {
    const userData = doc.data();
    if (userData.username !== currentUsername) {
      // Check if already have pending request
      const hasRequest = await checkExistingRequest(userData.username);
      const requestStatus = hasRequest ? ' (Request Pending)' : '';
      
      resultsHTML += `
        <div class="search-result-item">
          <span>${userData.username}${requestStatus}</span>
          ${!hasRequest ? `<button onclick="sendRequest('${userData.username}')" class="start-chat-btn">Send Request</button>` : '<span class="pending-badge">Pending</span>'}
        </div>
      `;
    }
  }

  resultsDiv.innerHTML = resultsHTML;
};

// Check if request already exists
async function checkExistingRequest(toUser) {
  const requestsRef = collection(db, "requests");
  const q = query(
    requestsRef, 
    where("from", "==", currentUsername),
    where("to", "==", toUser),
    where("status", "==", "pending")
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

// Send message request
window.sendRequest = async function(toUser) {
  try {
    // Check if user blocks you
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", toUser));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return;
    
    const userData = snapshot.docs[0].data();
    if (userData.blockedUsers?.includes(currentUsername)) {
      alert('You cannot send a request to this user');
      return;
    }

    // Create request
    await addDoc(collection(db, "requests"), {
      from: currentUsername,
      to: toUser,
      status: "pending",
      createdAt: new Date().toISOString()
    });

    alert('Request sent successfully!');
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchUser').value = '';

  } catch (error) {
    console.error("Send request error:", error);
    alert('Failed to send request');
  }
};

// Open existing chat
window.openChat = function(chatId, username) {
  window.location.href = `chat.html?chatId=${chatId}&user=${username}`;
};

// Go back
window.goBack = function() {
  window.location.href = 'dashboard.html';
};
