import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, getDoc, collection, addDoc, query, orderBy, onSnapshot,
  updateDoc, increment, where, getDocs, deleteDoc,
  arrayUnion, arrayRemove, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername, currentUid, otherUsername, chatId, replyingTo = null;
let isBlocked = false, blockedByMe = false;

const urlParams = new URLSearchParams(window.location.search);
chatId = urlParams.get('chatId');
otherUsername = urlParams.get('user');
if (!chatId || !otherUsername) window.location.href = 'private-chats.html';

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    document.getElementById('chatUserName').textContent = otherUsername;
    await checkBlockStatus();
    listenForMessages();
    listenForUserStatus();
    await updateDoc(doc(db, "users", user.uid), {
      online: true,
      lastSeen: new Date().toISOString()
    });
    await resetUnreadCount();
  }
});

async function checkBlockStatus() {
  const chatSnap = await getDoc(doc(db, "chats", chatId));
  if (chatSnap.exists() && chatSnap.data().isBlocked) {
    isBlocked = true;
    blockedByMe = chatSnap.data().blockedBy === currentUsername;
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    updateBlockButton();
  }
}

function updateBlockButton() {
  const btn = document.querySelector('[onclick="blockUser()"]');
  if (btn) btn.textContent = blockedByMe ? 'Unblock User' : 'Block Messages';
}

function listenForUserStatus() {
  const q = query(collection(db, "users"), where("username", "==", otherUsername));
  onSnapshot(q, (snap) => {
    if (snap.empty) return;
    const data = snap.docs[0].data();
    const statusEl = document.getElementById('userStatus');
    const lastSeenEl = document.getElementById('lastSeen');
    
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
  });
}

function formatLastSeen(date) {
  const now = new Date();
  const sec = Math.floor((now - date) / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return 'Just now';
  if (min < 60) return `${min} minute${min > 1 ? 's' : ''} ago`;
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  if (day < 7) return `${day} day${day > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

function listenForMessages() {
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp"));
  onSnapshot(q, (snap) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    let lastDate = null;
    snap.forEach(doc => {
      const data = doc.data();
      if (data.sender !== currentUsername && !data.seen) {
        updateDoc(doc.ref, { seen: true, seenAt: new Date().toISOString() });
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
    container.scrollTop = container.scrollHeight;
  });
}

function createMessageElement(data, msgId, isMine) {
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
  div.dataset.messageId = msgId;
  let time = '';
  if (data.timestamp) {
    time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  let replyHtml = data.replyTo ? `<div class="reply-preview-inline">↪️ ${data.replyTo}</div>` : '';
  let reactionsHtml = '';
  if (data.reactions && Object.keys(data.reactions).length) {
    const uniq = [...new Set(Object.values(data.reactions))];
    reactionsHtml = `<div class="message-reactions">${uniq.map(e => `<span class="reaction-badge">${e}</span>`).join('')}</div>`;
  }
  if (data.deletedForEveryone) {
    div.innerHTML = '<div class="deleted-message">This message was deleted</div>';
  } else {
    div.innerHTML = `
      ${replyHtml}
      <div class="message-text">${data.text}</div>
      ${reactionsHtml}
      <div class="message-footer">
        <span class="message-time">${time}</span>
        ${isMine && data.seen ? '<span class="seen-indicator">✓✓</span>' : ''}
      </div>
    `;
  }

  let touchStartX = 0, touchStartY = 0, swiped = false;
  div.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiped = false;
  }, { passive: true });
  
  div.addEventListener('touchmove', e => {
    if (!touchStartX) return;
    const endX = e.touches[0].clientX;
    const endY = e.touches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = Math.abs(endY - touchStartY);
    if (diffX > 50 && diffY < 30 && !swiped && !data.deletedForEveryone) {
      swiped = true;
      e.preventDefault();
      div.style.transform = 'translateX(10px)';
      setTimeout(() => div.style.transform = '', 200);
      replyToMessage(data.text);
    }
  }, { passive: false });
  
  div.addEventListener('touchend', () => { touchStartX = 0; });

  div.addEventListener('dblclick', e => {
    e.preventDefault();
    if (!data.deletedForEveryone) showReactionMenu(e, msgId, div);
  });

  let pressTimer;
  div.addEventListener('touchstart', e => {
    pressTimer = setTimeout(() => {
      if (!data.deletedForEveryone) showReactionMenu(e, msgId, div);
    }, 500);
  }, { passive: true });
  div.addEventListener('touchend', () => clearTimeout(pressTimer));
  div.addEventListener('touchcancel', () => clearTimeout(pressTimer));

  if (isMine && !data.deletedForEveryone) {
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (confirm('Delete for everyone?')) deleteMessage(msgId);
    });
  }
  return div;
}

function createDateDivider(date) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) div.textContent = 'Today';
  else if (date.toDateString() === yesterday.toDateString()) div.textContent = 'Yesterday';
  else div.textContent = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  return div;
}

function showReactionMenu(e, msgId, el) {
  document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'reaction-menu';
  ['❤️','😂','🔥','👍','😮','😢','🎉','🤔'].forEach(emoji => {
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
  const rect = el.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.top - 50}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '10000';
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 100);
}

async function addReaction(msgId, emoji) {
  try {
    await updateDoc(doc(db, "chats", chatId, "messages", msgId), {
      [`reactions.${currentUsername}`]: emoji
    });
  } catch (error) {}
}

window.sendMessage = async function() {
  if (isBlocked) { alert('Chat blocked'); return; }
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUsername,
    text, timestamp: new Date().toISOString(),
    deletedForEveryone: false, replyTo: replyingTo,
    seen: false, seenAt: null, reactions: {}
  });
  await updateDoc(doc(db, "chats", chatId), { [`unread.${otherUsername}`]: increment(1) });
  input.value = '';
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

window.replyToMessage = function(text) {
  replyingTo = text;
  const preview = document.getElementById('replyPreview');
  document.getElementById('replyText').textContent = text.length > 50 ? text.slice(0,50)+'...' : text;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
};

window.cancelReply = function() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
};

async function deleteMessage(msgId) {
  await updateDoc(doc(db, "chats", chatId, "messages", msgId), {
    deletedForEveryone: true, text: ''
  });
}

async function resetUnreadCount() {
  await updateDoc(doc(db, "chats", chatId), { [`unread.${currentUsername}`]: 0 });
}

window.unfriendUser = async function() {
  if (!confirm('Delete chat for both users?')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "chats", chatId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, "chats", chatId));
    await batch.commit();
    showNotification('Chat deleted');
    setTimeout(() => window.location.href = 'private-chats.html', 1500);
  } catch (error) { alert('Failed'); }
};

window.blockUser = async function() {
  try {
    if (blockedByMe) {
      if (!confirm('Unblock?')) return;
      await updateDoc(doc(db, "users", currentUid), { blockedUsers: arrayRemove(otherUsername) });
      await updateDoc(doc(db, "chats", chatId), { isBlocked: false, blockedBy: null });
      isBlocked = false; blockedByMe = false;
      document.getElementById('messageInput').disabled = false;
      document.getElementById('sendBtn').disabled = false;
      showNotification('User unblocked');
    } else {
      if (!confirm('Block messages?')) return;
      await updateDoc(doc(db, "users", currentUid), { blockedUsers: arrayUnion(otherUsername) });
      await updateDoc(doc(db, "chats", chatId), { isBlocked: true, blockedBy: currentUsername });
      isBlocked = true; blockedByMe = true;
      document.getElementById('messageInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
      showNotification('User blocked');
    }
    updateBlockButton();
  } catch (error) { alert('Failed: ' + error.message); }
};

function showNotification(msg) {
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = msg;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

window.toggleChatOptions = function() {
  document.getElementById('chatOptions').classList.toggle('hidden');
};

window.goBack = function() { window.location.href = 'private-chats.html'; };
