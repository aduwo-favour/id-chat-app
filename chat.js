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

let currentUserId = null;
let currentUid = null;

let chatId = new URLSearchParams(window.location.search).get("chatId");

if (!chatId) {
  window.location.href = "dashboard.html";
}

let participants = chatId.split("_");
let otherUserId = null;

/* ================= AUTH CHECK ================= */

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

    await createChatIfNotExists();
    loadMessages();
    resetUnread();
    listenTyping();
    listenOnlineStatus();

  } catch (err) {
    console.error("Chat error:", err);
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
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text: text,
    timestamp: serverTimestamp()
  });

  // Increase unread for other user
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

      const className =
        data.sender === currentUserId
          ? "message my-message"
          : "message other-message";

      messagesDiv.innerHTML += `
        <div class="${className}">
          ${data.text}
        </div>
      `;
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

    await updateDoc(chatRef, { unread: unread });

  } catch (err) {
    console.log("Unread reset skipped");
  }
}

/* ================= TYPING INDICATOR ================= */

const inputField = document.getElementById("messageInput");

if (inputField) {
  inputField.addEventListener("input", async () => {
    try {
      await updateDoc(doc(db, "chats", chatId), {
        [`typing.${currentUserId}`]: true
      });

      setTimeout(async () => {
        await updateDoc(doc(db, "chats", chatId), {
          [`typing.${currentUserId}`]: false
        });
      }, 1500);

    } catch (e) {}
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

/* ================= ONLINE / LAST SEEN ================= */

function listenOnlineStatus() {
  const usersRef = collection(db, "users");

  onSnapshot(usersRef, (snapshot) => {
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
