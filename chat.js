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
  getDocs,
  deleteDoc,
  runTransaction,
  arrayRemove
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

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", otherUserId));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const otherDoc = querySnapshot.docs[0];

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
    } else {
      const date = new Date(data.lastChanged);
      const time = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      statusEl.innerText = "Last seen at " + time;
    }

  });

  await updateDoc(userRef, {
    online: true,
    lastSeen: serverTimestamp()
  }).catch(() => {});

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

  await createChatIfNotExists();
  loadMessages();
  await resetUnread();

});

/* ================= CREATE CHAT ================= */

async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participants,
      unread: {},
      createdAt: serverTimestamp(),
      lastMessageTime: serverTimestamp()
    });
  }
}

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  let isAccepted = false;

  if (chatSnap.exists()) {
    const data = chatSnap.data();
    isAccepted = data.acceptedBy && data.acceptedBy.includes(currentUserId) && data.acceptedBy.includes(otherUserId);
  }

  if (isAccepted) {
    // Normal message
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
    // Send as request
    const requestRef = doc(db, "messageRequests", chatId);

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
    }, { merge: true });

    alert("Message sent as request – waiting for acceptance");
  }

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
    let lastDate = null;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      let messageDate = data.timestamp?.toDate() ?? null;

      const isMine = data.sender === currentUserId;

      if (messageDate) {
        const today = new Date();
        const yesterday = new Date(today);
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

      if (!isMine && data.seen === false) {
        updateDoc(docSnap.ref, {
          seen: true,
          seenAt: serverTimestamp()
        }).catch(() => {});
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

      if (isMine && !data.deletedForEveryone) {
        messageDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          confirmDelete(docSnap.id);
        });
      }

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

/* ================= DELETE ENTIRE CHAT ================= */

window.deleteChat = async function () {
  if (!confirm("Delete this chat for both users? This cannot be undone.")) return;

  try {
    // Delete all messages in batch
    const messagesQ = query(collection(db, "chats", chatId, "messages"));
    const messagesSnap = await getDocs(messagesQ);
    const batch = db.batch();

    messagesSnap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    await batch.commit();

    // Delete chat doc
    await deleteDoc(doc(db, "chats", chatId));

    // Delete request doc
    await deleteDoc(doc(db, "messageRequests", chatId)).catch(() => {});

    alert("Chat deleted completely");
    window.goBack();
  } catch (err) {
    console.error("Delete chat failed:", err);
    alert("Failed to delete chat – see console for details");
  }
};
