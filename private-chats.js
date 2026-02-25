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
  deleteDoc,
  writeBatch,
  setDoc
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
    console.log("Current user:", currentUsername);
    loadChats();
  }
});

// Load only accepted chats
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
        
        // Set status class and text
        const statusClass = status.online ? 'online' : 'offline';
        let statusText = '';
        
        if (status.online) {
          statusText = 'Online';
        } else {
          // For offline, show the formatted last seen with prefix
          statusText = status.lastSeen; // This will be like "Last seen 5 minutes ago"
        }

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

// Get user online status - FIXED VERSION
async function getUserStatus(username) {
  if (!username) return { online: false, lastSeen: 'Offline' };
  
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", username));
  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    const data = snapshot.docs[0].data();
    
    // Check if user is online (strict comparison)
    if (data.online === true) {
      return {
        online: true,
        lastSeen: 'Online'
      };
    }
    
    // If offline, calculate last seen
    if (data.lastSeen) {
      const lastSeen = new Date(data.lastSeen);
      const timeAgo = formatLastSeen(lastSeen);
      return {
        online: false,
        lastSeen: `Last seen ${timeAgo}`
      };
    }
    
    return { online: false, lastSeen: 'Offline' };
  }
  return { online: false, lastSeen: 'Offline' };
}

// Format last seen - IMPROVED VERSION
function formatLastSeen(date) {
  const now = new Date();
  const diffSeconds = Math.floor((now - date) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 30) {
    return 'just now';
  } else if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}

// Search users
window.searchUsers = async function() {
  const searchTerm = document.getElementById('searchUser').value.trim();
  if (!searchTerm || searchTerm === currentUsername) {
    document.getElementById('searchResults').innerHTML = '';
    return;
  }

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
  try {
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
  } catch (error) {
    console.error("Check request status error:", error);
    return "none";
  }
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
  console.log("Sending request to:", toUser);
  
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

    // Check if there's already a pending request
    const pendingQuery = query(
      collection(db, "requests"),
      where("from", "==", currentUsername),
      where("to", "==", toUser),
      where("status", "==", "pending")
    );
    const pendingSnapshot = await getDocs(pendingQuery);
    
    if (!pendingSnapshot.empty) {
      alert('You already have a pending request to this user');
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
    
    // Create a new request document reference properly
    const requestsCollection = collection(db, "requests");
    const newRequestRef = doc(requestsCollection);
    
    // Use batch for multiple operations
    const batch = writeBatch(db);
    
    // Delete any existing declined requests
    declinedSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Create new request
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

// Make functions globally available
window.searchUsers = searchUsers;
window.sendRequest = sendRequest;
window.openChat = openChat;
