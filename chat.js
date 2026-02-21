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
  increment
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

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  try {
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

  } catch (err) {
    console.error("Send error:", err);
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

      /* ===== AUTO MARK SEEN ===== */
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

      /* ===== FORMAT TIME ===== */
      let timeString = "";
      if (data.timestamp?.toDate) {
        const date = data.timestamp.toDate();
        timeString = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      /* ===== SEEN DISPLAY ===== */
      let seenHTML = "";
      if (isMine && data.seen && data.seenAt?.toDate) {
        const seenTime = data.seenAt.toDate().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });

        seenHTML = `
          <div class="seen-time">
            Seen at ${seenTime}
          </div>
        `;
      }

      /* ===== MESSAGE DISPLAY ===== */

      if (data.deletedForEveryone) {

        messageDiv.innerHTML = `
          <div class="deleted-message">
            This message was deleted
          </div>
        `;

      } else {

        let replyHTML = "";
        if (data.replyTo) {
          replyHTML = `
            <div class="reply-box">
              ${data.replyTo}
            </div>
          `;
        }

        messageDiv.innerHTML = `
          ${replyHTML}
          <div class="message-text">${data.text}</div>
          <div class="message-time">${timeString}</div>
          ${seenHTML}
        `;
      }

      /* ===== DELETE (YOUR MESSAGES ONLY) ===== */

      if (isMine && !data.deletedForEveryone) {

        messageDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          confirmDelete(docSnap.id);
        });

        let pressTimer;
        messageDiv.addEventListener("touchstart", () => {
          pressTimer = setTimeout(() => {
            confirmDelete(docSnap.id);
          }, 600);
        });

        messageDiv.addEventListener("touchend", () => {
          clearTimeout(pressTimer);
        });
      }

      /* ===== SWIPE TO REPLY ===== */

      let startX = 0;

      messageDiv.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
      });

      messageDiv.addEventListener("touchmove", (e) => {
        const diff = e.touches[0].clientX - startX;

        if (diff > 60 && !data.deletedForEveryone) {
          triggerReply(data.text);
        }

        messageDiv.style.transform =
          `translateX(${Math.min(diff, 60)}px)`;
      });

      messageDiv.addEventListener("touchend", () => {
        messageDiv.style.transform = "translateX(0)";
      });

      messagesDiv.appendChild(messageDiv);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

/* ================= DELETE ================= */

function confirmDelete(messageId) {
  if (confirm("Delete this message for everyone?")) {
    deleteForEveryone(messageId);
  }
}

window.deleteForEveryone = async function (messageId) {
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
};

/* ================= REPLY ================= */

function triggerReply(text) {
  replyingTo = text;

  const replyPreview = document.getElementById("replyPreview");
  if (!replyPreview) return;

  replyPreview.style.display = "block";
  replyPreview.innerText = text;

  document.getElementById("messageInput").focus();
}

/* ================= RESET UNREAD ================= */

async function resetUnread() {
  try {
    await updateDoc(doc(db, "chats", chatId), {
      [`unread.${currentUserId}`]: 0
    });
  } catch {}
}

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};
