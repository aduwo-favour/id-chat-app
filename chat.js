import { auth, db } from "./firebase.js";

import { onAuthStateChanged } from
"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  increment,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

/* ================= GLOBALS ================= */

let currentUserId = null;
let currentUid = null;
let replyingTo = null;
let userRef = null;
let unloadListenerAdded = false;

let chatId = new URLSearchParams(window.location.search).get("chatId");
if (!chatId) window.location.href = "dashboard.html";

let participants = chatId.split("_");
let otherUserId = null;

/* ================= AUTH ================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUid = user.uid;
  userRef = doc(db, "users", currentUid);

  const userDoc = await getDoc(userRef);
  if (!userDoc.exists()) return;

  currentUserId = userDoc.data().userId;
  otherUserId = participants.find(p => p !== currentUserId);

  const title = document.getElementById("chatTitle");
  if (title) title.innerText = otherUserId;

  /* ===== SET ONLINE ===== */

  await updateDoc(userRef, {
    online: true,
    lastSeen: serverTimestamp()
  }).catch(() => {});

  /* ===== SET OFFLINE ON LEAVE ===== */

  if (!unloadListenerAdded) {
    unloadListenerAdded = true;

    window.addEventListener("beforeunload", () => {
      if (!userRef) return;

      updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    });
  }

  /* ===== MOBILE VISIBILITY FIX ===== */

  document.addEventListener("visibilitychange", () => {

    if (!userRef) return;

    if (document.visibilityState === "hidden") {

      updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});

    } else {

      updateDoc(userRef, {
        online: true
      }).catch(() => {});
    }

  });

  /* ===== LISTEN TO OTHER USER STATUS ===== */

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", otherUserId));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {

    const otherDoc = querySnapshot.docs[0];
    const otherUserRef = doc(db, "users", otherDoc.id);

    onSnapshot(otherUserRef, (snap) => {

      const statusEl = document.getElementById("onlineStatus");
      if (!statusEl) return;

      if (!snap.exists()) {
        statusEl.innerText = "";
        return;
      }

      const data = snap.data();

      if (data.online === true) {
        statusEl.innerText = "Online";
      } else if (data.lastSeen?.toDate) {

        const time = data.lastSeen.toDate().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });

        statusEl.innerText = "Last seen at " + time;
      } else {
        statusEl.innerText = "Offline";
      }

    });
  }

  await createChatIfNotExists();
  loadMessages();
});

/* ================= CREATE CHAT ================= */

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participants,
      unread: {},
      createdAt: serverTimestamp()
    });
  }
}

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {

  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text,
    timestamp: serverTimestamp(),
    deletedForEveryone: false,
    replyTo: replyingTo,
    seen: false,
    seenAt: null,
    reactions: {}
  });

  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${otherUserId}`]: increment(1)
  }).catch(() => {});

  input.value = "";
  replyingTo = null;

  const replyPreview = document.getElementById("replyPreview");
  if (replyPreview) replyPreview.style.display = "none";
};

/* ================= LOAD MESSAGES ================= */

function loadMessages() {

  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp", "asc")
  );

  onSnapshot(q, (snapshot) => {

    const messagesDiv = document.getElementById("messages");
    if (!messagesDiv) return;

    messagesDiv.innerHTML = "";
    let firstUnreadElement = null;
    let lastDate = null;

snapshot.forEach((docSnap) => {

  const data = docSnap.data();
  let messageDate = null;

  if (data.timestamp?.toDate) {
    messageDate = data.timestamp.toDate();
  }

  const isMine = data.sender === currentUserId; // FIXED (semicolon added)

  /* ===== DATE DIVIDER ===== */

  if (messageDate) {

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const messageDay = messageDate.toDateString();

    let label = "";

    if (messageDay === today.toDateString()) {
      label = "Today";
    } else if (messageDay === yesterday.toDateString()) {
      label = "Yesterday";
    } else {
      label = messageDate.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }

    if (lastDate !== messageDay) {

      lastDate = messageDay;

      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.innerText = label;

      messagesDiv.appendChild(divider);
    }
  }  
  const messageDiv = document.createElement("div");

  // FIXED unread detection placement (AFTER messageDiv exists)
  if (!isMine && data.seen === false && !firstUnreadElement) {
    firstUnreadElement = messageDiv;
  }

  messageDiv.className = isMine
    ? "message my-message"
    : "message other-message";

  let timeString = "";
  if (data.timestamp?.toDate) {
    timeString = data.timestamp.toDate().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  let seenHTML = "";
  if (isMine && data.seen && data.seenAt?.toDate) {
    const seenTime = data.seenAt.toDate().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    seenHTML = `<div class="seen-time">Seen at ${seenTime}</div>`;
  }

  if (data.deletedForEveryone) {

    messageDiv.innerHTML = `
      <div class="deleted-message">
        This message was deleted
      </div>
    `;

  } else {

    let replyHTML = "";
    if (data.replyTo) {
      replyHTML = `<div class="reply-box">${data.replyTo}</div>`;
    }

    messageDiv.innerHTML = `
      ${replyHTML}
      <div class="message-text">${data.text || ""}</div>
      <div class="message-time">${timeString}</div>
      ${seenHTML}
    `;

    if (data.reactions && Object.keys(data.reactions).length > 0) {
      const reactionContainer = document.createElement("div");
      reactionContainer.className = "reaction-container";

      Object.values(data.reactions).forEach(emoji => {
        const span = document.createElement("span");
        span.innerText = emoji;
        reactionContainer.appendChild(span);
      });

      messageDiv.appendChild(reactionContainer);
    }
  }

  messagesDiv.appendChild(messageDiv);
});

    
if (firstUnreadElement) {
  firstUnreadElement.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
} else {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
    // ===== MARK MESSAGES AS SEEN AFTER SCROLL =====
snapshot.forEach((docSnap) => {
  const data = docSnap.data();
  const isMine = data.sender === currentUserId;

  if (!isMine && data.seen === false) {
    updateDoc(docSnap.ref, {
      seen: true,
      seenAt: serverTimestamp()
    }).catch(() => {});
  }
});
    // ===== RESET UNREAD AFTER LOADING =====
resetUnread();
  });
}

/* ================= RESET UNREAD ================= */

async function resetUnread() {
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${currentUserId}`]: 0
  }).catch(() => {});
}

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};



    

