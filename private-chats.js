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
  addDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

// Global back function
window.goBack = function() {
  window.location.href = 'dashboard.html';
};

// Global start new chat
window.startNewChat = function() {
  document.getElementById('searchUser').focus();
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
    loadChats();
  }
});

// Load only accepted chats
function loadChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUsername),
    where("status", "==", "accepted")
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
            <div class="chat-avatar">${otherUser ? otherUser[0].toUpperCase() : '?'}</div>
            <div class="chat-details">
              <div class="chat-name">${otherUser || 'Unknown'}</div>
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
  if (!username) return { online: false, lastSeen: 'Offline' };
  
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
  resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
  
  try {
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
        const requestStatus = await checkRequestStatus(userData.username);
        
        resultsHTML += `
          <div class="search-result-item">
            <span>${userData.username}</span>
            ${getRequestButton(userData.username, requestStatus)}
          </div>
        `;
      }
    }

    resultsDiv.innerHTML = resultsHTML;
  } catch (error) {
    console.error("Search error:", error);
    resultsDiv.innerHTML = '<div class="error-message">Search failed</div>';
  }
};

// Check request status
async function checkRequestStatus(toUser) {
  // Check if request was sent by me
  const sentQuery = query(
    collection(db, "requests"),
    where("from", "==", currentUsername),
    where("to", "==", toUser)
  );
  const sentSnapshot = await getDocs(sentQuery);
  
  if (!sentSnapshot.empty) {
    const data = sentSnapshot.docs[0].data();
    return data.status === "pending" ? "pending" : "declined";
  }
  
  return "none";
}

// Get appropriate button based on request status
function getRequestButton(username, status) {
  switch(status) {
    case "pending":
      return '<span class="pending-badge">Request Pending</span>';
    case "declined":
      return '<span class="declined-badge">Declined</span>';
    default:
      return `<button onclick="sendRequest('${username}')" class="start-chat-btn">Send Request</button>`;
  }
}

// Send message request
window.sendRequest = async function(toUser) {
  try {
    // Check if user blocks you
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", toUser));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      alert('User not found');
      return;
    }
    
    const userData = snapshot.docs[0].data();
    if (userData.blockedUsers && userData.blockedUsers.includes(currentUsername)) {
      alert('You cannot send a request to this user');
      return;
    }

    // Check if there was a previous declined request - delete it first
    const declinedQuery = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser),
      where("status", "==", "declined")
    );
    const declinedSnapshot = await getDocs(declinedQuery);
    
    const batch = writeBatch(db);
    
    // Delete any existing declined requests
    declinedSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Create new request
    const newRequestRef = doc(collection(db, "requests"));
    batch.set(newRequestRef, {
      from: currentUsername,
      to: toUser,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    
    await batch.commit();

    alert('Request sent successfully!');
    
    // Clear search
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchUser').value = '';

  } catch (error) {
    console.error("Send request error:", error);
    alert('Failed to send request: ' + error.message);
  }
};

// Open existing chat
window.openChat = function(chatId, username) {
  if (!chatId || !username) return;
  window.location.href = `chat.html?chatId=${chatId}&user=${username}`;
};
