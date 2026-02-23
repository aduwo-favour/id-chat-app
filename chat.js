import { auth, db } from "./firebase.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

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

const urlParams = new URLSearchParams(window.location.search);
let chatId = urlParams.get("chatId");
if (!chatId) window.location.href = "dashboard.html";

const participants = chatId.split("_");
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

  // Get other user's doc
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", otherUserId));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const otherDoc = querySnapshot.docs[0];

  /* ===== Realtime Presence (RTDB) ===== */
  const rtdb = getDatabase();
  const connectedRef = ref(rtdb, ".info/connected");

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      const statusRef = ref(rtdb, "status/" + currentUid);
      set(statusRef, {
        online: true,
        lastChanged: Date.now()
      });

      onDisconnect(statusRef).set({
        online: false,
        lastChanged: Date.now()
      });
    }
  });

  /* ===== Listen to other user's presence ===== */
  const otherStatusRef = ref(rtdb, "status/" + otherDoc.id);

  onValue(otherStatusRef, (snap) => {
    const statusEl = document.getElementById("onlineStatus");
    if (!statusEl) return;

    if (!snap.exists()) {
      statusEl.innerText = "Offline";
      return;
    }

    const data = snap.val();

    if (data.online === true) {
      statusEl.innerText = "Online";
      statusEl.style.color = "#4caf50";
    } else {
      const last = data.lastChanged ? new Date(data.lastChanged) : null;
      if (!last) {
        statusEl.innerText = "Offline";
        return;
      }

      const diffMs = Date.now() - last.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      let text = "Offline";

      if (diffMin < 2) text = "just now";
      else if (diffMin < 60) text = `${diffMin} min ago`;
      else if (diffMin < 1440) {
        const h = Math.floor(diffMin / 60);
        text = `${h} ${h === 1 ? "hour" : "hours"} ago`;
      } else {
        text = last.toLocaleDateString([], { weekday: "short" }) +
               " at " + last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }

      statusEl.innerText = "Last seen " + text;
      statusEl.style.color = "#888";
    }
  });

  /* ===== Firestore status mirror ===== */
  await updateDoc(userRef, {
    online: true,
    lastSeen: serverTimestamp()
  }).catch(() => {});

  if (!unloadListenerAdded) {
    unloadListenerAdded = true;

    document.addEventListener("visibilitychange", () => {
      if (!userRef) return;
      updateDoc(userRef, {
        online: document.visibilityState === "visible",
        lastSeen: serverTimestamp()
      }).catch(() => {});
    });

    window.addEventListener("beforeunload", () => {
      if (!userRef) return;
      updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    });
  }

  await createChatIfNotExists(); // Now also handles request case
  loadMessages();
  await resetUnread();
});

/* ================= CREATE CHAT / REQUEST ================= */

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (chatSnap.exists()) {
    // Chat exists → check if accepted
    if (chatSnap.data().acceptedBy?.includes(currentUserId)) {
      return; // normal chat
    }
  }

  // No accepted chat → treat as request (but we create empty chat doc for consistency)
  if (!chatSnap.exists()) {
    await setDoc(chatRef, {
      participants,
      acceptedBy: [],               // empty → not accepted yet
      createdAt: serverTimestamp(),
      lastMessageTime: serverTimestamp(),
      unread: {}
    });
  }

  // Also create/update request doc
  const requestRef = doc(db, "messageRequests", chatId);
  await setDoc(requestRef, {
    from: currentUserId,
    to: otherUserId,
    status: "pending",
    createdAt: serverTimestamp(),
    lastUpdated: serverTimestamp()
  }, { merge: true });
}

/* ================= SEND MESSAGE (with request logic) ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  let isAcceptedChat = false;

  if (chatSnap.exists()) {
    const chatData = chatSnap.data();
    isAcceptedChat = chatData.acceptedBy?.includes(currentUserId) &&
                     chatData.acceptedBy?.includes(otherUserId);
  }

  if (isAcceptedChat) {
    // Normal send to messages subcollection
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

    await updateDoc(chatRef, {
      [`unread.${otherUserId}`]: increment(1),
      lastMessageTime: serverTimestamp()
    }).catch(() => {});
  } else {
    // Send as request (update firstMessage or add preview)
    const requestRef = doc(db, "messageRequests", chatId);

    await updateDoc(requestRef, {
      firstMessage: {
        text,
        sender: currentUserId,
        timestamp: serverTimestamp()
      },
      lastUpdated: serverTimestamp(),
      status: "pending"
    }).catch(async (err) => {
      // If not exists yet, create
      await setDoc(requestRef, {
        from: currentUserId,
        to: otherUserId,
        firstMessage: {
          text,
          sender: currentUserId,
          timestamp: serverTimestamp()
        },
        status: "pending",
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
    });

    // Optional: show hint in UI that it's a request
    alert("Message sent as request – waiting for acceptance");
  }

  input.value = "";
  replyingTo = null;

  const replyPreview = document.getElementById("replyPreview");
  if (replyPreview) replyPreview.style.display = "none";
};

/* ================= LOAD MESSAGES (only if accepted) ================= */

function loadMessages() {
  const messagesRef = collection(db, "chats", chatId, "messages");

  const q = query(messagesRef, orderBy("timestamp", "asc"));

  onSnapshot(q, (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    if (!messagesDiv) return;

    messagesDiv.innerHTML = "";
    let lastDate = null;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isMine = data.sender === currentUserId;

      let messageDate = data.timestamp?.toDate?.() ?? null;

      // Date divider logic (same as before)
      if (messageDate) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        const messageDay = messageDate.toDateString();
        let label = messageDay === today.toDateString() ? "Today" :
                    messageDay === yesterday.toDateString() ? "Yesterday" :
                    messageDate.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

        if (lastDate !== messageDay) {
          lastDate = messageDay;
          const divider = document.createElement("div");
          divider.className = "date-divider";
          divider.innerText = label;
          messagesDiv.appendChild(divider);
        }
      }

      if (!isMine && data.seen === false) {
        updateDoc(docSnap.ref, { seen: true, seenAt: serverTimestamp() }).catch(() => {});
      }

      const messageDiv = document.createElement("div");
      messageDiv.className = isMine ? "message my-message" : "message other-message";

      const timeString = messageDate
        ? messageDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

      let seenHTML = "";
      if (isMine && data.seen && data.seenAt?.toDate) {
        const seenTime = data.seenAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        seenHTML = `<div class="seen-time">Seen at ${seenTime}</div>`;
      }

      if (data.deletedForEveryone) {
        messageDiv.innerHTML = `<div class="deleted-message">This message was deleted</div>`;
      } else {
        let replyHTML = data.replyTo ? `<div class="reply-box">${data.replyTo}</div>` : "";

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

      // Delete / reaction / swipe logic (same as your original)
      if (isMine && !data.deletedForEveryone) {
        messageDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          confirmDelete(docSnap.id);
        });
      }

      // Touch swipe + long press (your original code - kept)
      let startX = 0;
      let pressTimer = null;
      let triggeredReply = false;

      messageDiv.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        triggeredReply = false;
        pressTimer = setTimeout(() => showReactionMenu(messageDiv, docSnap.id), 500);
      });

      messageDiv.addEventListener("touchmove", (e) => {
        const diff = e.touches[0].clientX - startX;
        if (diff > 0) {
          clearTimeout(pressTimer);
          const moveAmount = Math.min(diff, 80);
          messageDiv.style.transform = `translateX(${moveAmount}px)`;
          if (diff > 70 && !triggeredReply && !data.deletedForEveryone) {
            triggeredReply = true;
            triggerReply(data.text || "");
          }
        }
      });

      messageDiv.addEventListener("touchend", () => {
        clearTimeout(pressTimer);
        messageDiv.style.transform = "translateX(0)";
      });

      messageDiv.addEventListener("dblclick", () => showReactionMenu(messageDiv, docSnap.id));

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
  await updateDoc(
    doc(db, "chats", chatId, "messages", messageId),
    { deletedForEveryone: true, text: "" }
  ).catch(() => {});
}

/* ================= REACTION ================= */

async function addReaction(messageId, emoji) {
  await updateDoc(
    doc(db, "chats", chatId, "messages", messageId),
    { [`reactions.${currentUserId}`]: emoji }
  ).catch(() => {});
}

function showReactionMenu(messageDiv, messageId) {
  document.querySelectorAll(".reaction-menu").forEach(el => el.remove());

  const menu = document.createElement("div");
  menu.className = "reaction-menu";

  ["❤️", "😂", "🔥", "👍", "😮", "😢"].forEach(emoji => {
    const span = document.createElement("span");
    span.innerText = emoji;
    span.onclick = () => {
      addReaction(messageId, emoji);
      menu.remove();
    };
    menu.appendChild(span);
  });

  document.body.appendChild(menu);

  const rect = messageDiv.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.top = `${rect.top - 40}px`;
  menu.style.left = `${rect.left}px`;

  setTimeout(() => {
    document.addEventListener("click", () => menu.remove(), { once: true });
  }, 50);
}

/* ================= RESET UNREAD ================= */

async function resetUnread() {
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${currentUserId}`]: 0
  }).catch(() => {});
}

/* ================= BACK ================= */

window.goBack = function () {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");

  if (from === "private") {
    window.location.href = "private.html";
  } else if (from === "community") {
    window.location.href = "community.html";
  } else {
    window.location.href = "dashboard.html";
  }
};
