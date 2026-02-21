import { auth, db } from "./firebase.js";
import { onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

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
  increment
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;
let chatId = null;

const urlParams = new URLSearchParams(window.location.search);
chatId = urlParams.get("chatId");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    currentUserId = userDoc.data().userId;

    await createChatIfNotExists();
    await resetUnread();
    loadMessages();
  }
});

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    const participants = chatId.split("_");

    await setDoc(chatRef, {
      participants: participants,
      lastMessage: "",
      lastSender: "",
      updatedAt: new Date(),
      unread: {}
    });
  }
}

async function resetUnread() {
  const chatRef = doc(db, "chats", chatId);

  await updateDoc(chatRef, {
    [`unread.${currentUserId}`]: 0
  });
}

window.sendMessage = async function () {
  const message = document.getElementById("messageInput").value.trim();
  if (!message) return;

  const participants = chatId.split("_");
  const otherUser = participants.find(id => id !== currentUserId);

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text: message,
    timestamp: new Date()
  });

  const chatRef = doc(db, "chats", chatId);

  await updateDoc(chatRef, {
    lastMessage: message,
    lastSender: currentUserId,
    updatedAt: new Date(),
    [`unread.${otherUser}`]: increment(1)
  });

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

      const messageClass =
        data.sender === currentUserId
          ? "message my-message"
          : "message other-message";

      messagesDiv.innerHTML += `
        <div class="${messageClass}">
          ${data.text}
        </div>
      `;
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

window.goBack = function () {
  window.location.href = "dashboard.html";
};
