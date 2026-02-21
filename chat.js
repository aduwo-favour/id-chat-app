import { auth, db } from "./firebase.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

/* ================= GLOBALS ================= */

let currentUserId = null;
let currentUid = null;

let chatId = new URLSearchParams(window.location.search).get("chatId");

if (!chatId) {
  window.location.href = "dashboard.html";
}

let participants = chatId.split("_");
let otherUserId = null;

/* ================= AUTH ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    currentUid = user.uid;

    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists()) {
      alert("User data missing.");
      return;
    }

    currentUserId = userDoc.data().userId;

    otherUserId = participants.find(p => p !== currentUserId);

    // Set chat header name
    const title = document.getElementById("chatTitle");
    if (title && otherUserId) {
      title.innerText = otherUserId;
    }

    await createChatIfNotExists();
    loadMessages();
    resetUnread();
    setupTyping();
    listenTyping();
    listenOnlineStatus();

  } catch (err) {
    console.error("Chat init error:", err);
  }
});

/* ================= CREATE CHAT ================= */

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participants: participants,
      unread: {},
      typing: {},
      createdAt: serverTimestamp()
    });
  }
}

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input || !currentUserId) return;

  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text: text,
    timestamp: serverTimestamp()
  });

  // Update unread
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  const data = chatSnap.data() || {};

  const unread = data.unread || {};

  participants.forEach(user => {
    if (user !== currentUserId) {
      unread[user] = (unread[user] || 0) + 1;
    }
  });

  await updateDoc(chatRef, {
    unread: unread,
    [`typing.${currentUserId}`]: false
  });

  input.value = "";
};

/* ================= LOAD MESSAGES ================= */

function loadMessages() {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp")
  );

  onSnapshot(q, (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    if (!messagesDiv) return;

    messagesDiv.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const messageDiv = document.createElement("div");
      messageDiv.className =
        data.sender === currentUserId
          ? "message my-message"
          : "message other-message";

      messageDiv.textContent = data.text;

      messagesDiv.appendChild(messageDiv);
    });

    // Auto scroll smoothly
    setTimeout(() => {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 50);
  });
}

/* ================= RESET UNREAD ================= */

async function resetUnread() {
  try {
    const chatRef = doc(db, "chats", chatId);
    const snap = await getDoc(chatRef);
    const data = snap.data() || {};

    const unread = data.unread || {};
    unread[currentUserId] = 0;

    await updateDoc(chatRef, { unread });

  } catch (err) {
    console.log("Unread reset skipped");
  }
}

/* ================= TYPING ================= */

function setupTyping() {
  const inputField = document.getElementById("messageInput");
  if (!inputField) return;

  inputField.addEventListener("input", async () => {
    if (!currentUserId) return;

    await updateDoc(doc(db, "chats", chatId), {
      [`typing.${currentUserId}`]: true
    });

    setTimeout(async () => {
      await updateDoc(doc(db, "chats", chatId), {
        [`typing.${currentUserId}`]: false
      });
    }, 1200);
  });
}

function listenTyping() {
  onSnapshot(doc(db, "chats", chatId), (snap) => {
    const data = snap.data();
    const typingDiv = document.getElementById("typingStatus");
    if (!typingDiv) return;

    if (data?.typing?.[otherUserId]) {
      typingDiv.innerText = otherUserId + " is typing...";
    } else {
      typingDiv.innerText = "";
    }
  });
}

/* ================= ONLINE STATUS ================= */

function listenOnlineStatus() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.userId === otherUserId) {
        const statusDiv = document.getElementById("onlineStatus");
        if (!statusDiv) return;

        if (data.online) {
          statusDiv.innerText = "🟢 Online";
        } else {
          const date = data.lastSeen?.toDate?.();
          statusDiv.innerText = date
            ? "Last seen: " + date.toLocaleString()
            : "Offline";
        }
      }
    });
  });
}

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};
