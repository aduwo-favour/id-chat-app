import { auth, db, storage } from "./firebase.js";

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
  increment
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";

/* ================= GLOBALS ================= */

let currentUserId = null;
let currentUid = null;
let replyingTo = null;

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

  const userDoc = await getDoc(doc(db, "users", currentUid));
  if (!userDoc.exists()) return;

  currentUserId = userDoc.data().userId;
  otherUserId = participants.find(p => p !== currentUserId);

  const title = document.getElementById("chatTitle");
  if (title) title.innerText = otherUserId;

  await createChatIfNotExists();
  loadMessages();
  resetUnread();
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

/* ================= SEND TEXT ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text,
    imageUrl: null,
    timestamp: serverTimestamp(),
    deletedForEveryone: false,
    replyTo: replyingTo,
    seen: false,
    seenAt: null
  });

  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${otherUserId}`]: increment(1)
  });

  input.value = "";
  replyingTo = null;

  const replyPreview = document.getElementById("replyPreview");
  if (replyPreview) replyPreview.style.display = "none";
};

/* ================= SEND IMAGE ================= */

const imageInput = document.getElementById("imageInput");

if (imageInput) {
  imageInput.addEventListener("change", async (e) => {

    const file = e.target.files[0];
    if (!file) return;

    const imageRef = ref(storage, `chatImages/${chatId}/${Date.now()}`);

    await uploadBytes(imageRef, file);
    const downloadURL = await getDownloadURL(imageRef);

    await addDoc(collection(db, "chats", chatId, "messages"), {
      sender: currentUserId,
      text: null,
      imageUrl: downloadURL,
      timestamp: serverTimestamp(),
      deletedForEveryone: false,
      replyTo: null,
      seen: false,
      seenAt: null
    });

    await updateDoc(doc(db, "chats", chatId), {
      [`unread.${otherUserId}`]: increment(1)
    });
  });
}

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
      const isMine = data.sender === currentUserId;

      /* AUTO MARK SEEN */
      if (!isMine && !data.seen) {
        updateDoc(
          doc(db, "chats", chatId, "messages", docSnap.id),
          {
            seen: true,
            seenAt: serverTimestamp()
          }
        );
      }

      const messageDiv = document.createElement("div");
      messageDiv.className = isMine
        ? "message my-message"
        : "message other-message";

      let timeString = "";
      if (data.timestamp?.toDate) {
        const date = data.timestamp.toDate();
        timeString = date.toLocaleTimeString([], {
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
          <div class="deleted-message">This message was deleted</div>
        `;
      } else {

        let replyHTML = "";
        if (data.replyTo) {
          replyHTML = `<div class="reply-box">${data.replyTo}</div>`;
        }

        let contentHTML = "";

        if (data.imageUrl) {
          contentHTML = `
            <img src="${data.imageUrl}" class="chat-image">
          `;
        } else {
          contentHTML = `
            <div class="message-text">${data.text}</div>
          `;
        }

        messageDiv.innerHTML = `
          ${replyHTML}
          ${contentHTML}
          <div class="message-time">${timeString}</div>
          ${seenHTML}
        `;
      }

      messagesDiv.appendChild(messageDiv);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

/* ================= RESET UNREAD ================= */

async function resetUnread() {
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${currentUserId}`]: 0
  });
}

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};
