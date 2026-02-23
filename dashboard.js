import { auth, db } from "./firebase.js";

import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

let currentUserId = null;
let currentUid = null;
let originalTitle = document.title;
let userRef = null;
let unloadListenerAdded = false;

const rtdb = getDatabase();

/* ================= AUTH CHECK ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    currentUid = user.uid;
    userRef = doc(db, "users", currentUid);

    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      alert("User profile not found.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    const data = userDoc.data();

    if (!data.userId) {
      alert("User ID missing.");
      return;
    }

    currentUserId = data.userId;

    const welcome = document.getElementById("welcome");
    if (welcome) {
      welcome.innerText = "Logged in as: " + currentUserId;
    }

    // ────────────────────────────────────────────────
    //               PRESENCE SYSTEM
    // ────────────────────────────────────────────────

    // 1. Realtime Database - true connection status
    const connectedRef = ref(rtdb, ".info/connected");

    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        const statusRef = ref(rtdb, "status/" + currentUid);

        set(statusRef, {
          online: true,
          lastChanged: rtdbServerTimestamp()
        });

        onDisconnect(statusRef).set({
          online: false,
          lastChanged: rtdbServerTimestamp()
        });
      }
    });

    // 2. Mirror to Firestore (for consistency with your old code)
    await updateDoc(userRef, {
      online: true,
      lastSeen: serverTimestamp()
    }).catch(() => {});

    // 3. Visibility + unload listeners
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

    // ────────────────────────────────────────────────
    //               LOAD CHATS
    // ────────────────────────────────────────────────

    loadChats();

    // Load requests if on private page
    if (document.getElementById("requestsList")) {
      loadRequests();
    }

  } catch (error) {
    console.error("Auth / presence setup error:", error);
  }
});

/* ================= LOGOUT ================= */

window.logout = async function () {
  try {
    if (userRef) {
      await updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    }
  } catch {}

  await signOut(auth);
  window.location.href = "index.html";
};

/* ================= START CHAT ================= */

window.startChat = async function () {
  const friendIdInput = document.getElementById("friendId");
  if (!friendIdInput) return;

  const friendId = friendIdInput.value.trim();

  if (!friendId) {
    showNotification("Enter Friend ID");
    return;
  }

  if (friendId === currentUserId) {
    showNotification("You cannot chat with yourself");
    return;
  }

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", friendId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showNotification("User not found");
      return;
    }

    const chatId = [currentUserId, friendId].sort().join("_");
    window.location.href = "chat.html?chatId=" + chatId + "&from=private";

  } catch (err) {
    console.error("Start chat error:", err);
    showNotification("Error starting chat");
  }
};

/* ================= LOAD CHATS + PRESENCE ================= */

function loadChats() {
  if (!currentUserId) return;

  const chatsRef = collection(db, "chats");

  const q = query(
    chatsRef,
    where("participants", "array-contains", currentUserId),
    orderBy("lastMessageTime", "desc")
  );

  onSnapshot(q, async (snapshot) => {
    const chatList = document.getElementById("chatList");
    if (!chatList) return;

    chatList.innerHTML = "";

    let totalUnread = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      if (!data.participants) continue;

      const otherUser = data.participants.find(id => id !== currentUserId);
      if (!otherUser) continue;

      const unread = data.unread?.[currentUserId] ?? 0;
      totalUnread += unread;

      const badge = unread > 0 ? `<span class="unread-badge">${unread}</span>` : "";

      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <div class="chat-info">
          <span>Chat with ${otherUser}</span>
          <span class="chat-status">…</span>
          ${badge}
        </div>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      chatList.appendChild(div);

      // ─── Get other user's UID and listen to status ───
      try {
        const usersQ = query(collection(db, "users"), where("userId", "==", otherUser));
        const userSnap = await getDocs(usersQ);

        if (userSnap.empty) {
          div.querySelector(".chat-status").innerText = "";
          continue;
        }

        const otherUid = userSnap.docs[0].id;
        const statusRef = ref(rtdb, "status/" + otherUid);

        onValue(statusRef, (snap) => {
          const statusEl = div.querySelector(".chat-status");
          if (!statusEl) return;

          if (!snap.exists()) {
            statusEl.innerText = "Offline";
            statusEl.style.color = "#888";
            return;
          }

          const val = snap.val();

          if (val.online === true) {
            statusEl.innerText = "Online";
            statusEl.style.color = "#4caf50"; // green
          } else {
            const last = val.lastChanged ? new Date(val.lastChanged) : null;
            if (!last) {
              statusEl.innerText = "Offline";
              statusEl.style.color = "#888";
              return;
            }

            const diffMs = Date.now() - last.getTime();
            const diffMin = Math.floor(diffMs / 60000);

            let text = "Offline";

            if (diffMin < 2)          text = "just now";
            else if (diffMin < 60)    text = `${diffMin} min ago`;
            else if (diffMin < 1440) {
              const h = Math.floor(diffMin / 60);
              text = `${h} ${h === 1 ? "hour" : "hours"} ago`;
            }
            else if (diffMin < 10080) { // within a week
              text = last.toLocaleDateString([], { weekday: "short" }) +
                     " at " + last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            }
            else {
              text = last.toLocaleDateString([], {
                day: "numeric", month: "short", year: "numeric"
              });
            }

            statusEl.innerText = "Last seen " + text;
            statusEl.style.color = "#888";
          }
        });

      } catch (err) {
        console.warn("Could not load status for", otherUser, err);
        div.querySelector(".chat-status").innerText = "";
      }
    }

    // Update badge & title
    const privateBadge = document.getElementById("privateBadge");
    if (privateBadge) {
      if (totalUnread > 0) {
        privateBadge.style.display = "inline-block";
        privateBadge.innerText = totalUnread;
      } else {
        privateBadge.style.display = "none";
      }
    }

    document.title = totalUnread > 0
      ? `(${totalUnread}) New Messages`
      : originalTitle;
  });
}

/* ================= LOAD MESSAGE REQUESTS ================= */

function loadRequests() {
  if (!currentUserId) return;

  const requestsQuery = query(
    collection(db, "messageRequests"),
    where("to", "==", currentUserId),
    where("status", "==", "pending"),
    orderBy("lastUpdated", "desc")
  );

  onSnapshot(requestsQuery, (snap) => {
    const list = document.getElementById("requestsList");
    if (!list) return;

    list.innerHTML = "";

    snap.forEach((docSnap) => {
      const req = docSnap.data();
      const div = document.createElement("div");
      div.className = "request-item";
      div.innerHTML = `
        <p>From: ${req.from}</p>
        <p>${req.firstMessage?.text?.substring(0, 100) || "No message"}...</p>
        <button onclick="acceptRequest('${docSnap.id}')">Accept</button>
        <button onclick="declineRequest('${docSnap.id}')">Decline</button>
      `;
      list.appendChild(div);
    });
  });
}

/* ================= ACCEPT / DECLINE ================= */

window.acceptRequest = async function (reqId) {
  const reqRef = doc(db, "messageRequests", reqId);
  const reqSnap = await getDoc(reqRef);
  const req = reqSnap.data();

  const chatId = [req.from, req.to].sort().join("_");
  const chatRef = doc(db, "chats", chatId);

  await updateDoc(chatRef, {
    acceptedBy: [req.from, req.to],
    lastMessageTime: serverTimestamp()
  }).catch(async () => {
    await setDoc(chatRef, {
      participants: [req.from, req.to],
      acceptedBy: [req.from, req.to],
      unread: {},
      createdAt: serverTimestamp(),
      lastMessageTime: serverTimestamp()
    });
  });

  // Copy first message to real chat
  if (req.firstMessage) {
    await addDoc(collection(db, "chats", chatId, "messages"), {
      sender: req.from,
      text: req.firstMessage.text,
      timestamp: req.firstMessage.timestamp || serverTimestamp(),
      deletedForEveryone: false,
      replyTo: null,
      seen: false,
      seenAt: null,
      reactions: {}
    });
  }

  await updateDoc(reqRef, { status: "accepted" });

  showNotification("Request accepted");
  window.location.href = `chat.html?chatId=${chatId}&from=private`;
};

window.declineRequest = async function (reqId) {
  await updateDoc(doc(db, "messageRequests", reqId), { status: "declined" });
  showNotification("Request declined");
};

/* ================= OPEN CHAT ================= */

window.openChat = async function (chatId) {
  try {
    const chatRef = doc(db, "chats", chatId);
    await updateDoc(chatRef, {
      [`unread.${currentUserId}`]: 0
    }).catch(() => {});
  } catch {}

  window.location.href = "chat.html?chatId=" + chatId + "&from=private";
};

/* ================= SIMPLE NOTIFICATION ================= */

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "custom-notification";
  notification.innerText = message;

  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

/* ================= NAVIGATION ================= */

window.openCommunity = function () {
  window.location.href = "community.html";
};

window.openPrivate = function () {
  window.location.href = "private.html";
};
