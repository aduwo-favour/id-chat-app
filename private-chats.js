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
  orderBy,
  updateDoc,
  serverTimestamp,
  addDoc,
  setDoc
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

// Load all private chats
function loadChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUsername)
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
    const lastSeen = data.lastSeen?.toDate();
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
  const diff = Math.floor((now - date) / 1000 / 60); // minutes

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
  snapshot.forEach(doc => {
    const userData = doc.data();
    if (userData.username !== currentUsername) {
      resultsHTML += `
        <div class="search-result-item" onclick="startChat('${userData.username}')">
          <span>${userData.username}</span>
          <button class="start-chat-btn">Chat</button>
        </div>
      `;
    }
  });

  resultsDiv.innerHTML = resultsHTML;
};

// Start new chat
window.startChat = async function(username) {
  // Check if not blocked
  const userRef = collection(db, "users");
  const q = query(userRef, where("username", "==", username));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) return;

  const otherUserDoc = snapshot.docs[0];
  const otherUserData = otherUserDoc.data();

  // Check if blocked
  if (otherUserData.blockedUsers?.includes(currentUsername)) {
    alert('You cannot chat with this user');
    return;
  }

  const chatId = [currentUsername, username].sort().join('_');
  
  // Check if chat exists
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    // Create new chat
    await setDoc(chatRef, {
      participants: [currentUsername, username],
      createdAt: serverTimestamp(),
      unread: {},
      isBlocked: false,
      blockedBy: null
    });
  }

  window.location.href = `chat.html?chatId=${chatId}&user=${username}`;
};

// Open existing chat
window.openChat = function(chatId, username) {
  window.location.href = `chat.html?chatId=${chatId}&user=${username}`;
};

// Go back
window.goBack = function() {
  window.location.href = 'dashboard.html';
};
