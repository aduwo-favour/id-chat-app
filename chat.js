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
  serverTimestamp,
  increment
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

  currentUid = user.uid;

  const userDoc = await getDoc(doc(db, "users", user.uid));
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

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text,
    timestamp: serverTimestamp(),
    status: {
      delivered: false,
      seen: false,
      seenAt: null
    }
  });

  await addDoc(collection(db, "chats", chatId, "messages"), {
  sender: currentUserId,
  text,
  timestamp: serverTimestamp(),
  deleted: false,
  deletedForEveryone: false,
  deletedFor: []
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
    messagesDiv.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const messageDiv = document.createElement("div");
      messageDiv.className =
        data.sender === currentUserId
          ? "message my-message"
          : "message other-message";

      // Format time
      let timeString = "";
      if (data.timestamp?.toDate) {
        const date = data.timestamp.toDate();
        timeString = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      // Handle deleted messages
      if (data.deletedForEveryone) {
        messageDiv.innerHTML = `
          <div class="deleted-message">
            This message was deleted
          </div>
        `;
      } else {
        messageDiv.innerHTML = `
          <div class="message-text">${data.text}</div>
          <div class="message-time">${timeString}</div>
        `;
      }

      messagesDiv.appendChild(messageDiv);
    });

    setTimeout(() => {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 50);
  });
}

      /* ===== AUTO MARK DELIVERED ===== */
      if (data.sender !== currentUserId && !data.status?.delivered) {
        updateDoc(
          doc(db, "chats", chatId, "messages", docSnap.id),
          { "status.delivered": true }
        );
      }

      /* ===== AUTO MARK SEEN ===== */
      if (data.sender !== currentUserId && !data.status?.seen) {
        updateDoc(
          doc(db, "chats", chatId, "messages", docSnap.id),
          {
            "status.seen": true,
            "status.seenAt": serverTimestamp()
          }
        );
      }

      /* ===== TICKS ===== */
      let tickHTML = "";
      if (data.sender === currentUserId) {
        if (data.status?.seen) {
          tickHTML = `<span class="tick seen">✔✔</span>`;
        } else if (data.status?.delivered) {
          tickHTML = `<span class="tick delivered">✔✔</span>`;
        } else {
          tickHTML = `<span class="tick sent">✔</span>`;
        }
      }

      messageDiv.innerHTML = `
        <div class="message-text">${data.text}</div>
        <div class="message-time">
          ${timeString} ${tickHTML}
        </div>
      `;

      /* ===== SEEN AT ===== */
      if (data.sender === currentUserId && data.status?.seenAt?.toDate) {
        const seenDate = data.status.seenAt.toDate();
        const seenTime = seenDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });

        messageDiv.innerHTML += `
          <div class="seen-time">
            Seen at ${seenTime}
          </div>
        `;
      }

      /* ===== SWIPE TO REPLY ===== */
      let startX = 0;

      messageDiv.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
      });

      messageDiv.addEventListener("touchmove", (e) => {
        const moveX = e.touches[0].clientX;
        const diff = moveX - startX;

        if (diff > 60) {
          triggerReply(data.text);
        }

        messageDiv.style.transform = `translateX(${Math.min(diff, 60)}px)`;
      });

      messageDiv.addEventListener("touchend", () => {
        messageDiv.style.transform = "translateX(0)";
      });

      messagesDiv.appendChild(messageDiv);
    });

    setTimeout(() => {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 50);
  });
}

/* ================= REPLY FUNCTION ================= */

function triggerReply(text) {
  const input = document.getElementById("messageInput");
  input.value = "↪ " + text + " ";
  input.focus();
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


