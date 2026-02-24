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
  increment,
  where,
  getDocs,
  deleteDoc,
  arrayUnion,
  writeBatch,   // ← ADD THIS
  setDoc        // ← ADD THIS if not already there
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// ... rest of your chat.js code stays the same

let currentUsername = null;
let currentUid = null;
let otherUsername = null;
let chatId = null;
let replyingTo = null;
let isBlocked = false;

// Get URL params
const urlParams = new URLSearchParams(window.location.search);
chatId = urlParams.get('chatId');
otherUsername = urlParams.get('user');

if (!chatId || !otherUsername) {
  window.location.href = 'private-chats.html';
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    
    document.getElementById('chatUserName').textContent = otherUsername;
    
    // Check if chat is blocked
    await checkBlockStatus();
    
    // Listen for messages
    listenForMessages();
    
    // Listen for user status
    listenForUserStatus();
    
    // Update online status
    await updateDoc(doc(db, "users", user.uid), {
      online: true,
      lastSeen: new Date().toISOString()
    });

    // Reset unread count
    await resetUnreadCount();
  }
});

// Check if chat is blocked
async function checkBlockStatus() {
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (chatSnap.exists()) {
    const data = chatSnap.data();
    if (data.isBlocked) {
      isBlocked = true;
      document.getElementById('messageInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
      showNotification('This chat has been blocked');
    }
  }
}

// Listen for user online status
function listenForUserStatus() {
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", otherUsername));

  onSnapshot(q, (snapshot) => {
    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      const statusEl = document.getElementById('userStatus');
      const lastSeenEl = document.getElementById('lastSeen');

      if (data.online) {
        statusEl.textContent = 'Online';
        statusEl.className = 'user-status online';
        lastSeenEl.textContent = '';
      } else {
        statusEl.textContent = 'Offline';
        statusEl.className = 'user-status offline';
        
        if (data.lastSeen) {
          const lastSeen = new Date(data.lastSeen);
          lastSeenEl.textContent = `Last seen: ${formatLastSeen(lastSeen)}`;
        }
      }
    }
  });
}

// Format last seen
function formatLastSeen(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000 / 60);

  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} minutes ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
  return date.toLocaleDateString();
}

// Listen for messages
function listenForMessages() {
  const messagesRef = collection(db, "chats", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = ''; // Clear first
    let lastDate = null;

    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Mark as seen if not mine
      if (data.sender !== currentUsername && !data.seen) {
        updateDoc(doc.ref, {
          seen: true,
          seenAt: new Date().toISOString()
        });
      }

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

  let timeString = '';
  if (data.timestamp) {
    timeString = new Date(data.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Reply preview
  let replyHTML = '';
  if (data.replyTo) {
    replyHTML = `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>`;
  }

  // Deleted message
  if (data.deletedForEveryone) {
    div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
  } else {
    div.innerHTML = `
      ${replyHTML}
      <div class="message-text">${data.text}</div>
      <div class="message-footer">
        <span class="message-time">${timeString}</span>
        ${isMine && data.seen ? '<span class="seen-indicator">✓✓ Seen</span>' : ''}
      </div>
    `;
  }

  // Double click to reply
  div.ondblclick = () => {
    if (!data.deletedForEveryone) {
      replyToMessage(data.text);
    }
  };

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

// Send message
window.sendMessage = async function() {
  if (isBlocked) {
    alert('This chat is blocked');
    return;
  }

  const input = document.getElementById('messageInput');
  const text = input.value.trim();

  if (!text) return;

  const messagesRef = collection(db, "chats", chatId, "messages");

  await addDoc(messagesRef, {
    sender: currentUsername,
    text: text,
    timestamp: new Date().toISOString(),
    deletedForEveryone: false,
    replyTo: replyingTo,
    seen: false,
    seenAt: null
  });

  // Update unread count for other user
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${otherUsername}`]: increment(1)
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
};

// Cancel reply
window.cancelReply = function() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

// Reset unread count
async function resetUnreadCount() {
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${currentUsername}`]: 0
  });
}

// UNFRIEND FUNCTION - Clears chat for both users
window.unfriendUser = async function() {
  if (!confirm('Are you sure? This will delete this chat for both users. They will need to send a new request to chat again.')) return;

  try {
    const batch = writeBatch(db);
    
    // Delete all messages in the chat
    const messagesRef = collection(db, "chats", chatId, "messages");
    const messagesSnap = await getDocs(messagesRef);
    messagesSnap.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete the chat document
    batch.delete(doc(db, "chats", chatId));

    // Commit the batch
    await batch.commit();

    showNotification('Chat deleted successfully');
    
    // Redirect to private chats
    setTimeout(() => {
      window.location.href = 'private-chats.html';
    }, 1500);

  } catch (error) {
    console.error("Unfriend error:", error);
    alert('Failed to unfriend user');
  }
};

// BLOCK FUNCTION - Just blocks messages
window.blockUser = async function() {
  if (!confirm('Block messages from this user? They will not be able to send you requests.')) return;

  try {
    // Add to blocked list
    const userRef = doc(db, "users", currentUid);
    await updateDoc(userRef, {
      blockedUsers: arrayUnion(otherUsername)
    });

    // Update chat status
    await updateDoc(doc(db, "chats", chatId), {
      isBlocked: true,
      blockedBy: currentUsername
    });

    isBlocked = true;
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    
    showNotification('User blocked');

  } catch (error) {
    console.error("Block error:", error);
    alert('Failed to block user');
  }
};

// Show chat options
window.showChatOptions = function() {
  const options = document.getElementById('chatOptions');
  options.classList.toggle('hidden');
};

// Go back
window.goBack = function() {
  window.location.href = 'private-chats.html';
};

// Show notification
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
      }
// Make sure goBack is global
window.goBack = function() {
  window.location.href = 'private-chats.html';
};


