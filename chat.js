import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, getDoc, collection, addDoc, query, orderBy, onSnapshot,
  updateDoc, increment, where, getDocs, deleteDoc,
  arrayUnion, arrayRemove, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Global variables
let currentUsername = null;
let currentUid = null;
let otherUsername = null;
let chatId = null;
let replyingTo = null;
let isBlocked = false;
let blockedByMe = false;
let unsubscribeMessages = null;
let unsubscribeStatus = null;
let onlineInterval = null;
let otherUserVerified = false;

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
chatId = urlParams.get('chatId');
otherUsername = urlParams.get('user');

// Validate parameters
if (!chatId || !otherUsername) {
  alert('Invalid chat link');
  window.location.href = 'private-chats.html';
}

// Initialize chat
onAuthStateChanged(auth, async (user) => {
  if (!user) { 
    window.location.href = 'index.html'; 
    return; 
  }
  
  currentUid = user.uid;
  
  try {
    // Get current user's username
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      alert('User data not found');
      await signOut(auth);
      window.location.href = 'index.html';
      return;
    }
    
    currentUsername = userDoc.data().username;

    // Security check: Verify current user is a participant of this chat
    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);
    
    if (!chatSnap.exists()) {
      alert('Chat does not exist');
      window.location.href = 'private-chats.html';
      return;
    }
    
    const chatData = chatSnap.data();
    if (!chatData.participants || !chatData.participants.includes(currentUsername)) {
      alert('You are not a participant of this chat');
      window.location.href = 'private-chats.html';
      return;
    }
    
    // Verify that the 'otherUsername' parameter matches the other participant
    const otherParticipant = chatData.participants.find(p => p !== currentUsername);
    if (otherParticipant !== otherUsername) {
      alert('Chat user mismatch');
      window.location.href = 'private-chats.html';
      return;
    }

    // Get other user's verified status for header badge
    await getOtherUserVerifiedStatus();
    
    // Update chat header
    updateChatHeader();
    
    // Check block status
    await checkBlockStatus();
    
    // Start listening to messages
    listenForMessages();
    
    // Start listening to user status
    listenForUserStatus();
    
    // Update online status
    await updateOnlineStatus();
    
    // Start periodic online status updates
    startOnlineStatusUpdates();
    
    // Reset unread count
    await resetUnreadCount();
    
    // Handle visibility change
    setupVisibilityHandler();
    
  } catch (error) {
    console.error('Error in chat initialization:', error);
    showNotification('Error loading chat: ' + error.message);
    setTimeout(() => {
      window.location.href = 'private-chats.html';
    }, 2000);
  }
});

// Clean up listeners when leaving
window.addEventListener('beforeunload', () => {
  cleanupListeners();
});

// Cleanup function
function cleanupListeners() {
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeStatus) unsubscribeStatus();
  if (onlineInterval) clearInterval(onlineInterval);
}

// Setup visibility change handler
function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (!currentUid) return;
    
    if (document.hidden) {
      // User left the tab
      updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
      
      if (onlineInterval) clearInterval(onlineInterval);
    } else {
      // User returned to tab
      updateOnlineStatus();
      startOnlineStatusUpdates();
    }
  });
}

// Get other user's verified status
async function getOtherUserVerifiedStatus() {
  try {
    const otherUserQuery = query(collection(db, "users"), where("username", "==", otherUsername));
    const otherUserSnap = await getDocs(otherUserQuery);
    if (!otherUserSnap.empty) {
      otherUserVerified = otherUserSnap.docs[0].data().verified || false;
    }
  } catch (error) {
    console.error('Error getting other user status:', error);
  }
}

// Update chat header
function updateChatHeader() {
  const nameElement = document.getElementById('chatUserName');
  if (!nameElement) return;
  
  if (otherUserVerified) {
    nameElement.innerHTML = `${otherUsername} <span class="verified-badge" title="Verified Account">✓</span>`;
  } else {
    nameElement.textContent = otherUsername;
  }
}

// Update online status
async function updateOnlineStatus() {
  if (!currentUid) return;
  
  try {
    await updateDoc(doc(db, "users", currentUid), {
      online: true,
      lastSeen: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to update online status:", error);
  }
}

// Start periodic online status updates
function startOnlineStatusUpdates() {
  if (onlineInterval) clearInterval(onlineInterval);
  
  onlineInterval = setInterval(updateOnlineStatus, 30000);
}

// Check block status
async function checkBlockStatus() {
  try {
    const chatSnap = await getDoc(doc(db, "chats", chatId));
    if (chatSnap.exists() && chatSnap.data().isBlocked) {
      isBlocked = true;
      blockedByMe = chatSnap.data().blockedBy === currentUsername;
      
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');
      
      if (messageInput) messageInput.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      
      updateBlockButton();
    }
  } catch (error) {
    console.error('Error checking block status:', error);
  }
}

// Update block button text
function updateBlockButton() {
  const blockBtn = document.querySelector('[onclick="blockUser()"]');
  if (blockBtn) {
    blockBtn.textContent = blockedByMe ? 'Unblock User' : 'Block Messages';
  }
}

// Listen for user status changes
function listenForUserStatus() {
  try {
    const q = query(collection(db, "users"), where("username", "==", otherUsername));
    unsubscribeStatus = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      
      const data = snap.docs[0].data();
      updateUserStatusDisplay(data);
      
    }, (error) => {
      console.error('Error listening to user status:', error);
    });
  } catch (error) {
    console.error('Error setting up status listener:', error);
  }
}

// Update user status display
function updateUserStatusDisplay(data) {
  const statusEl = document.getElementById('userStatus');
  const lastSeenEl = document.getElementById('lastSeen');
  
  if (!statusEl || !lastSeenEl) return;
  
  const now = new Date();
  const twoMinAgo = new Date(now.getTime() - 120000);
  
  if (data.online === true && data.lastSeen) {
    const lastSeen = new Date(data.lastSeen);
    if (lastSeen > twoMinAgo) {
      statusEl.textContent = 'Online';
      statusEl.className = 'user-status online';
      lastSeenEl.textContent = '';
    } else {
      statusEl.textContent = 'Offline';
      statusEl.className = 'user-status offline';
      if (data.lastSeen) {
        lastSeenEl.textContent = `Last seen: ${formatLastSeen(new Date(data.lastSeen))}`;
      }
    }
  } else {
    statusEl.textContent = 'Offline';
    statusEl.className = 'user-status offline';
    if (data.lastSeen) {
      lastSeenEl.textContent = `Last seen: ${formatLastSeen(new Date(data.lastSeen))}`;
    } else {
      lastSeenEl.textContent = '';
    }
  }
}

// Format last seen time
function formatLastSeen(date) {
  if (!date) return 'Unknown';
  
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  
  if (diffSec < 30) return 'Just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString();
}

// Listen for messages
function listenForMessages() {
  if (!chatId) return;
  
  try {
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    unsubscribeMessages = onSnapshot(q, (snap) => {
      const container = document.getElementById('messagesContainer');
      if (!container) return;
      
      // Store scroll position
      const wasAtBottom = isScrolledToBottom(container);
      
      container.innerHTML = '';
      let lastDate = null;
      
      snap.forEach(doc => {
        const data = doc.data();
        
        // Mark message as seen if it's from other user
        if (data.sender !== currentUsername && !data.seen) {
          markMessageAsSeen(doc.ref);
        }
        
        const msgDate = data.timestamp ? new Date(data.timestamp) : null;
        const isMine = data.sender === currentUsername;
        
        if (msgDate) {
          const dateStr = msgDate.toDateString();
          if (lastDate !== dateStr) {
            lastDate = dateStr;
            container.appendChild(createDateDivider(msgDate));
          }
        }
        
        container.appendChild(createMessageElement(data, doc.id, isMine));
      });
      
      // Scroll to bottom if was at bottom or no messages
      if (wasAtBottom || snap.empty) {
        scrollToBottom(container);
      }
      
    }, (error) => {
      console.error('Error listening to messages:', error);
      showNotification('Error loading messages');
    });
  } catch (error) {
    console.error('Error setting up messages listener:', error);
  }
}

// Check if container is scrolled to bottom
function isScrolledToBottom(container) {
  if (!container) return true;
  const threshold = 100; // pixels from bottom
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Scroll to bottom
function scrollToBottom(container) {
  if (!container) return;
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

// Mark message as seen
async function markMessageAsSeen(messageRef) {
  try {
    await updateDoc(messageRef, { 
      seen: true, 
      seenAt: new Date().toISOString() 
    });
  } catch (error) {
    console.error('Error marking message as seen:', error);
  }
}

// Create date divider
function createDateDivider(date) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  
  const today = new Date();
  const yesterday = new Date(today);
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

// Create message element
function createMessageElement(data, msgId, isMine) {
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
  div.dataset.messageId = msgId;
  
  let time = '';
  if (data.timestamp) {
    time = new Date(data.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }
  
  // Reply preview
  let replyHtml = data.replyTo ? 
    `<div class="reply-preview-inline">↪️ ${escapeHtml(data.replyTo)}</div>` : '';
  
  // Reactions
  let reactionsHtml = '';
  if (data.reactions && Object.keys(data.reactions).length) {
    const uniqueReactions = [...new Set(Object.values(data.reactions))];
    reactionsHtml = `<div class="message-reactions">${
      uniqueReactions.map(e => `<span class="reaction-badge">${e}</span>`).join('')
    }</div>`;
  }
  
  // Verified badge
  const verifiedBadge = data.senderVerified ? 
    '<span class="verified-badge" title="Verified Account">✓</span>' : '';
  
  if (data.deletedForEveryone) {
    div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
  } else {
    if (!isMine) {
      // Other user's message
      div.innerHTML = `
        <div class="message-sender">${escapeHtml(data.sender || 'Unknown')} ${verifiedBadge}</div>
        ${replyHtml}
        <div class="message-text">${escapeHtml(data.text)}</div>
        ${reactionsHtml}
        <div class="message-footer">
          <span class="message-time">${time}</span>
        </div>
      `;
    } else {
      // My message
      div.innerHTML = `
        ${replyHtml}
        <div class="message-text">${escapeHtml(data.text)}</div>
        ${reactionsHtml}
        <div class="message-footer">
          <span class="message-time">${time}</span>
          ${data.seen ? '<span class="seen-indicator" title="Seen">✓✓</span>' : ''}
        </div>
      `;
    }
  }

  // Add touch handlers for swipe to reply
  addSwipeHandler(div, data);
  
  // Add double click for reactions
  addReactionHandlers(div, msgId, data);
  
  // Add context menu for delete (own messages only)
  if (isMine && !data.deletedForEveryone) {
    addDeleteHandler(div, msgId);
  }
  
  return div;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add swipe handler for reply
function addSwipeHandler(element, data) {
  if (data.deletedForEveryone) return;
  
  let touchStartX = 0;
  let touchStartY = 0;
  let swiped = false;
  
  element.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiped = false;
  }, { passive: true });
  
  element.addEventListener('touchmove', (e) => {
    if (!touchStartX || swiped) return;
    
    const endX = e.touches[0].clientX;
    const endY = e.touches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = Math.abs(endY - touchStartY);
    
    if (diffX > 50 && diffY < 30 && !swiped) {
      swiped = true;
      e.preventDefault();
      
      // Visual feedback
      element.style.transform = 'translateX(10px)';
      setTimeout(() => element.style.transform = '', 200);
      
      // Trigger reply
      replyToMessage(data.text);
    }
  }, { passive: false });
  
  element.addEventListener('touchend', () => {
    touchStartX = 0;
    touchStartY = 0;
  });
}

// Add reaction handlers
function addReactionHandlers(element, msgId, data) {
  if (data.deletedForEveryone) return;
  
  // Double click for reactions
  element.addEventListener('dblclick', (e) => {
    e.preventDefault();
    showReactionMenu(e, msgId, element);
  });
  
  // Long press for reactions
  let pressTimer;
  element.addEventListener('touchstart', (e) => {
    pressTimer = setTimeout(() => {
      if (!data.deletedForEveryone) {
        showReactionMenu(e, msgId, element);
      }
    }, 500);
  }, { passive: true });
  
  element.addEventListener('touchend', () => clearTimeout(pressTimer));
  element.addEventListener('touchcancel', () => clearTimeout(pressTimer));
}

// Add delete handler
function addDeleteHandler(element, msgId) {
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (confirm('Delete this message for everyone?')) {
      deleteMessage(msgId);
    }
  });
}

// Show reaction menu
function showReactionMenu(e, msgId, element) {
  // Remove any existing reaction menus
  document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
  
  const menu = document.createElement('div');
  menu.className = 'reaction-menu';
  
  const reactions = ['❤️', '😂', '🔥', '👍', '😮', '😢', '🎉', '🤔'];
  
  reactions.forEach(emoji => {
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
  
  // Position menu near the message
  const rect = element.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.top - 60}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '10000';
  
  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 100);
}

// Add reaction to message
async function addReaction(msgId, emoji) {
  if (!chatId || !currentUsername) return;
  
  try {
    const messageRef = doc(db, "chats", chatId, "messages", msgId);
    await updateDoc(messageRef, {
      [`reactions.${currentUsername}`]: emoji
    });
  } catch (error) {
    console.error('Error adding reaction:', error);
  }
}

// Send message
window.sendMessage = async function() {
  if (isBlocked) {
    showNotification('Chat is blocked');
    return;
  }
  
  const input = document.getElementById('messageInput');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  // Disable input temporarily to prevent double sending
  input.disabled = true;
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;
  
  try {
    // Get user's verified status
    const userDoc = await getDoc(doc(db, "users", currentUid));
    const isVerified = userDoc.data()?.verified || false;
    
    // Create message
    await addDoc(collection(db, "chats", chatId, "messages"), {
      sender: currentUsername,
      senderVerified: isVerified,
      text: text,
      timestamp: new Date().toISOString(),
      deletedForEveryone: false,
      replyTo: replyingTo,
      seen: false,
      seenAt: null,
      reactions: {}
    });
    
    // Update unread count for other user
    await updateDoc(doc(db, "chats", chatId), { 
      [`unread.${otherUsername}`]: increment(1) 
    });
    
    // Clear input and reply
    input.value = '';
    replyingTo = null;
    
    const replyPreview = document.getElementById('replyPreview');
    if (replyPreview) {
      replyPreview.classList.add('hidden');
    }
    
  } catch (error) {
    console.error('Error sending message:', error);
    showNotification('Failed to send message');
  } finally {
    // Re-enable input
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
};

// Reply to message
window.replyToMessage = function(text) {
  replyingTo = text;
  
  const preview = document.getElementById('replyPreview');
  const replyText = document.getElementById('replyText');
  
  if (preview && replyText) {
    replyText.textContent = text.length > 50 ? text.slice(0, 50) + '...' : text;
    preview.classList.remove('hidden');
  }
  
  const input = document.getElementById('messageInput');
  if (input) input.focus();
};

// Cancel reply
window.cancelReply = function() {
  replyingTo = null;
  
  const preview = document.getElementById('replyPreview');
  if (preview) {
    preview.classList.add('hidden');
  }
};

// Delete message
async function deleteMessage(msgId) {
  if (!chatId || !msgId) return;
  
  try {
    await updateDoc(doc(db, "chats", chatId, "messages", msgId), {
      deletedForEveryone: true,
      text: ''
    });
    showNotification('Message deleted');
  } catch (error) {
    console.error('Error deleting message:', error);
    showNotification('Failed to delete message');
  }
}

// Reset unread count
async function resetUnreadCount() {
  if (!chatId || !currentUsername) return;
  
  try {
    await updateDoc(doc(db, "chats", chatId), { 
      [`unread.${currentUsername}`]: 0 
    });
  } catch (error) {
    console.error('Error resetting unread count:', error);
  }
}

// Unfriend user (delete chat)
window.unfriendUser = async function() {
  if (!confirm('Delete this chat for both users? This cannot be undone.')) return;
  
  try {
    const batch = writeBatch(db);
    
    // Delete all messages
    const messagesSnap = await getDocs(collection(db, "chats", chatId, "messages"));
    messagesSnap.forEach(doc => batch.delete(doc.ref));
    
    // Delete chat document
    batch.delete(doc(db, "chats", chatId));
    
    await batch.commit();
    
    showNotification('Chat deleted');
    setTimeout(() => {
      window.location.href = 'private-chats.html';
    }, 1500);
    
  } catch (error) {
    console.error('Error deleting chat:', error);
    showNotification('Failed to delete chat');
  }
};

// Block/unblock user
window.blockUser = async function() {
  try {
    if (blockedByMe) {
      // Unblock
      if (!confirm('Unblock this user?')) return;
      
      await updateDoc(doc(db, "users", currentUid), { 
        blockedUsers: arrayRemove(otherUsername) 
      });
      
      await updateDoc(doc(db, "chats", chatId), { 
        isBlocked: false, 
        blockedBy: null 
      });
      
      isBlocked = false;
      blockedByMe = false;
      
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');
      
      if (messageInput) messageInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      
      showNotification('User unblocked');
      
    } else {
      // Block
      if (!confirm('Block messages from this user?')) return;
      
      await updateDoc(doc(db, "users", currentUid), { 
        blockedUsers: arrayUnion(otherUsername) 
      });
      
      await updateDoc(doc(db, "chats", chatId), { 
        isBlocked: true, 
        blockedBy: currentUsername 
      });
      
      isBlocked = true;
      blockedByMe = true;
      
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');
      
      if (messageInput) messageInput.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      
      showNotification('User blocked');
    }
    
    updateBlockButton();
    
  } catch (error) {
    console.error('Error toggling block:', error);
    showNotification('Failed: ' + error.message);
  }
};

// Show notification
function showNotification(msg) {
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = msg;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.classList.add('fade-out');
    setTimeout(() => notif.remove(), 500);
  }, 3000);
}

// Toggle chat options dropdown
window.toggleChatOptions = function() {
  const options = document.getElementById('chatOptions');
  if (options) {
    options.classList.toggle('hidden');
  }
};

// Go back
window.goBack = function() {
  cleanupListeners();
  window.location.href = 'private-chats.html';
};

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const options = document.getElementById('chatOptions');
  const optionsBtn = document.getElementById('optionsBtn');
  
  if (options && optionsBtn && !options.contains(event.target) && !optionsBtn.contains(event.target)) {
    options.classList.add('hidden');
  }
});

// Handle Enter key for sending messages
document.addEventListener('keydown', function(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    const input = document.getElementById('messageInput');
    if (input && document.activeElement === input) {
      event.preventDefault();
      sendMessage();
    }
  }
});