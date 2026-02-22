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
  where
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

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

  const userRef = doc(db, "users", currentUid);
  const userDoc = await getDoc(userRef);
  if (!userDoc.exists()) return;

  currentUserId = userDoc.data().userId;
  otherUserId = participants.find(p => p !== currentUserId);

  const title = document.getElementById("chatTitle");
  if (title) title.innerText = otherUserId;

  /* ===== SET USER ONLINE ===== */
  await updateDoc(userRef, {
    online: true,
    lastSeen: serverTimestamp()
  });

  /* ===== SET OFFLINE WHEN LEAVING ===== */
  window.addEventListener("beforeunload", () => {
    updateDoc(userRef, {
      online: false,
      lastSeen: serverTimestamp()
    }).catch(() => {});
  });

  /* ===== LISTEN TO OTHER USER STATUS ===== */

  const otherQuery = query(
    collection(db, "users"),
    where("userId", "==", otherUserId)
  );

  onSnapshot(otherQuery, (snapshot) => {

    const statusEl = document.getElementById("onlineStatus");
    if (!statusEl) return;

    if (snapshot.empty) {
      statusEl.innerText = "";
      return;
    }

    const data = snapshot.docs[0].data();

    if (data.online) {
      statusEl.innerText = "Online";
    } else if (data.lastSeen?.toDate) {

      const date = data.lastSeen.toDate();
      const time = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      statusEl.innerText = "Last seen at " + time;

    } else {
      statusEl.innerText = "Offline";
    }

  });

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

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {

  try {

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
      seenAt: null
    });

    await updateDoc(doc(db, "chats", chatId), {
      [`unread.${otherUserId}`]: increment(1)
    });

    input.value = "";
    replyingTo = null;

    const replyPreview = document.getElementById("replyPreview");
    if (replyPreview) replyPreview.style.display = "none";

  } catch (error) {
    console.error("Send message error:", error);
  }
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
      const isMine = data.sender === currentUserId;

      if (!isMine && !data.seen) {
        updateDoc(docSnap.ref, {
          seen: true,
          seenAt: serverTimestamp()
        }).catch(() => {});
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
          <div class="message-text">${data.text}</div>
          <div class="message-time">${timeString}</div>
          ${seenHTML}
        `;
      }

      messagesDiv.appendChild(messageDiv);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

/* ================= REPLY ================= */

function triggerReply(text) {
  replyingTo = text;
  const replyPreview = document.getElementById("replyPreview");
  if (!replyPreview) return;
  replyPreview.innerText = text.length > 60 ? text.substring(0, 60) + "..." : text;
  replyPreview.style.display = "block";
}

/* ================= DELETE ================= */

function confirmDelete(messageId) {
  if (confirm("Delete this message for everyone?")) {
    deleteForEveryone(messageId);
  }
}

async function deleteForEveryone(messageId) {
  try {
    await updateDoc(
      doc(db, "chats", chatId, "messages", messageId),
      {
        deletedForEveryone: true,
        text: ""
      }
    );
  } catch (err) {
    console.error("Delete error:", err);
  }
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
