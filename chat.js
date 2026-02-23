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

/* ================= AUTH & PRESENCE ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUid = user.uid;
  userRef = doc(db, "users", currentUid);

  let userDoc;
  try {
    userDoc = await getDoc(userRef);
  } catch (err) {
    console.error("Failed to load user doc:", err);
    return;
  }

  if (!userDoc.exists()) {
    console.error("User document does not exist");
    return;
  }

  currentUserId = userDoc.data().userId;
  otherUserId = participants.find(p => p !== currentUserId);

  console.log(`[Auth] Logged in as ${currentUserId} (uid: ${currentUid}), chatting with ${otherUserId}`);

  const title = document.getElementById("chatTitle");
  if (title) title.innerText = otherUserId;

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", otherUserId));
  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (err) {
    console.error("Failed to query other user:", err);
  }

  if (querySnapshot?.empty) {
    console.warn("Other user not found in users collection");
  }

  const otherDoc = querySnapshot?.docs?.[0];

  /* ===== Realtime Presence ===== */
  const rtdb = getDatabase();
  const connectedRef = ref(rtdb, ".info/connected");

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      const statusRef = ref(rtdb, "status/" + currentUid);
      set(statusRef, {
        online: true,
        lastChanged: Date.now()
      }).catch(err => console.error("Presence set failed:", err));

      onDisconnect(statusRef).set({
        online: false,
        lastChanged: Date.now()
      }).catch(() => {});
    }
  });

  if (otherDoc) {
    const otherStatusRef = ref(rtdb, "status/" + otherDoc.id);
    onValue(otherStatusRef, (snap) => {
      const statusEl = document.getElementById("onlineStatus");
      if (!statusEl) return;

      if (!snap.exists()) {
        statusEl.innerText = "Offline";
        statusEl.style.color = "#888";
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
  }

  try {
    await updateDoc(userRef, {
      online: true,
      lastSeen: serverTimestamp()
    });
  } catch (err) {
    console.warn("Firestore presence mirror failed:", err);
  }

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

  await createChatIfNotExists();
  loadMessages();
  await resetUnread();
});

/* ================= CREATE CHAT / REQUEST ================= */

async function createChatIfNotExists() {
  console.log("[createChatIfNotExists] chatId:", chatId);

  const chatRef = doc(db, "chats", chatId);
  let chatSnap;
  try {
    chatSnap = await getDoc(chatRef);
  } catch (err) {
    console.error("getDoc(chat) failed:", err);
  }

  if (chatSnap?.exists()) {
    if (chatSnap.data().acceptedBy?.includes(currentUserId)) {
      console.log("[create] Chat already accepted");
      return;
    }
    console.log("[create] Chat exists but not accepted");
  } else {
    console.log("[create] Creating chat placeholder");
    try {
      await setDoc(chatRef, {
        participants,
        acceptedBy: [],
        createdAt: serverTimestamp(),
        lastMessageTime: serverTimestamp(),
        unread: {}
      });
      console.log("[create] Chat placeholder created OK");
    } catch (err) {
      console.error("[create] Failed to create chat doc:", err);
    }
  }

  const requestRef = doc(db, "messageRequests", chatId);
  console.log("[create] Setting request doc");
  try {
    await setDoc(requestRef, {
      from: currentUserId,
      to: otherUserId,
      status: "pending",
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    }, { merge: true });
    console.log("[create] Request doc OK");
  } catch (err) {
    console.error("[create] Failed to set request doc:", err);
  }
}

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  if (!auth.currentUser) {
    console.error("No authenticated user at send time");
    alert("Account still loading — wait a moment and retry");
    return;
  }

  console.log("SEND → from:", currentUserId, "to:", otherUserId, "text:", text);

  const chatRef = doc(db, "chats", chatId);
  let chatSnap;
  try {
    chatSnap = await getDoc(chatRef);
  } catch (err) {
    console.error("getDoc(chat) failed:", err);
  }

  let isAccepted = false;
  if (chatSnap?.exists()) {
    isAccepted = chatSnap.data().acceptedBy?.includes(currentUserId) &&
                  chatSnap.data().acceptedBy?.includes(otherUserId);
  }

  if (isAccepted) {
    console.log("Sending NORMAL message");
    try {
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
      });
      console.log("Normal message sent");
    } catch (err) {
      console.error("Normal send failed:", err);
    }
  } else {
    console.log("Sending REQUEST");
    const requestRef = doc(db, "messageRequests", chatId);

    try {
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

      console.log("Request document written successfully");
    } catch (err) {
      console.error("Request write failed:", err);
      alert("Failed to send request – check console (F12)");
    }
  }

  input.value = "";
  replyingTo = null;
  const replyPreview = document.getElementById("replyPreview");
  if (replyPreview) replyPreview.style.display = "none";
};

/* ================= LOAD MESSAGES ================= */

function loadMessages() {
  console.log("[loadMessages] Starting listener for chat:", chatId);

  const messagesRef = collection(db, "chats", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));

  onSnapshot(q, async (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    if (!messagesDiv) return;

    messagesDiv.innerHTML = "";

    if (snapshot.empty) {
      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef).catch(() => null);
      if (chatSnap?.exists() && !chatSnap.data().acceptedBy?.includes(currentUserId)) {
        messagesDiv.innerHTML = `
          <div class="request-placeholder">
            <p class="request-title">Message Request Pending</p>
            <p>Your message has been sent as a request.</p>
            <p>The other user needs to accept it before you can chat normally.</p>
          </div>
        `;
        return;
      }
    }

    let lastDate = null;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isMine = data.sender === currentUserId;

      let messageDate = data.timestamp?.toDate?.() ?? null;

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
          const rc = document.createElement("div");
          rc.className = "reaction-container";
          Object.values(data.reactions).forEach(emoji => {
            const span = document.createElement("span");
            span.innerText = emoji;
            rc.appendChild(span);
          });
          messageDiv.appendChild(rc);
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
  }, (err) => {
    console.error("[loadMessages] onSnapshot error:", err);
  });
}

/* ================= Other functions (unchanged but included for completeness) ================= */

function triggerReply(text) {
  replyingTo = text;
  const replyPreview = document.getElementById("replyPreview");
  if (!replyPreview) return;
  replyPreview.innerText = text.length > 60 ? text.substring(0, 60) + "..." : text;
  replyPreview.style.display = "block";
}

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

async function resetUnread() {
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${currentUserId}`]: 0
  }).catch(() => {});
}

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
