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
let chatId = new URLSearchParams(window.location.search).get("chatId");
let participants = chatId.split("_");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));
  currentUserId = userDoc.data().userId;

  await createChatIfNotExists();
  loadMessages();
  resetUnread();
});

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participants: participants,
      unread: {},
      createdAt: serverTimestamp()
    });
  }
}

window.sendMessage = async function () {
  const text = document.getElementById("messageInput").value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text: text,
    timestamp: serverTimestamp()
  });

  const chatRef = doc(db, "chats", chatId);

  const chatSnap = await getDoc(chatRef);
  const data = chatSnap.data();
  const unread = data.unread || {};

  participants.forEach(user => {
    if (user !== currentUserId) {
      unread[user] = (unread[user] || 0) + 1;
    }
  });

  await updateDoc(chatRef, { unread });

  document.getElementById("messageInput").value = "";
};

function loadMessages() {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp")
  );

  onSnapshot(q, (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    snapshot.forEach((doc) => {
      const data = doc.data();
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
  });
}

async function resetUnread() {
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);
  const data = snap.data();
  const unread = data.unread || {};

  unread[currentUserId] = 0;

  await updateDoc(chatRef, { unread });
}

window.goBack = function () {
  window.location.href = "dashboard.html";
};
