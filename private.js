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
  orderBy,
  deleteDoc
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
let userRef = null;
let unloadListenerAdded = false;

const rtdb = getDatabase();

/* ================= AUTH CHECK ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

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

  /* ===== PRESENCE SYSTEM ===== */

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

    document.addEventListener("visibilitychange", () => {
      if (!userRef) return;
      updateDoc(userRef, {
        online: document.visibilityState === "visible",
        lastSeen: serverTimestamp()
      }).catch(() => {});
    });
  }

  // Load everything
  loadPrivateChats();
  loadRequests();
  loadSentRequests();
});

/* ================= LOAD PRIVATE CHATS ================= */

function loadPrivateChats() {
  if (!currentUserId) return;

  const q = query(
    collection(db, "chats"),
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
          <span class="chat-status">Loading...</span>
          ${badge}
        </div>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;
      chatList.appendChild(div);

      // Presence
      try {
        const usersQ = query(collection(db, "users"), where("userId", "==", otherUser));
        const userSnap = await getDocs(usersQ);

        if (!userSnap.empty) {
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
              statusEl.style.color = "#4caf50";
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
      } catch (err) {
        console.warn("Presence failed for", otherUser, err);
        div.querySelector(".chat-status").innerText = "Offline";
      }
    }

    const privateBadge = document.getElementById("privateBadge");
    if (privateBadge) {
      privateBadge.innerText = totalUnread || "";
      privateBadge.style.display = totalUnread > 0 ? "inline-block" : "none";
    }
  });
}

/* ================= LOAD INCOMING REQUESTS ================= */

function loadRequests() {
  if (!currentUserId) return;

  const q = query(
    collection(db, "messageRequests"),
    where("to", "==", currentUserId),
    where("status", "==", "pending"),
    orderBy("lastUpdated", "desc")
  );

  onSnapshot(q, (snap) => {
    const list = document.getElementById("requestsList");
    if (!list) return;

    list.innerHTML = "";

    const count = snap.size;
    const badge = document.getElementById("requestsBadge");
    if (badge) {
      badge.innerText = count;
      badge.style.display = count > 0 ? "inline-block" : "none";
    }

    if (count === 0) {
      list.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">No incoming requests</p>';
      return;
    }

    snap.forEach((docSnap) => {
      const req = docSnap.data();
      const div = document.createElement("div");
      div.className = "request-item";
      div.innerHTML = `
        <p>From: ${req.from}</p>
        <p>${req.firstMessage?.text?.substring(0, 80) || "No message"}...</p>
        <button onclick="acceptRequest('${docSnap.id}')">Accept</button>
        <button onclick="declineRequest('${docSnap.id}')">Decline</button>
      `;
      list.appendChild(div);
    });
  });
}

/* ================= LOAD SENT REQUESTS ================= */

function loadSentRequests() {
  if (!currentUserId) return;

  const q = query(
    collection(db, "messageRequests"),
    where("from", "==", currentUserId),
    where("status", "==", "pending"),
    orderBy("lastUpdated", "desc")
  );

  onSnapshot(q, (snap) => {
    const list = document.getElementById("sentRequestsList");
    if (!list) return;

    list.innerHTML = "";

    if (snap.empty) {
      list.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">No pending sent requests</p>';
      return;
    }

    snap.forEach((docSnap) => {
      const req = docSnap.data();
      const div = document.createElement("div");
      div.className = "request-item";
      div.innerHTML = `
        <p>Sent to: ${req.to}</p>
        <p>${req.firstMessage?.text?.substring(0, 80) || "No message"}...</p>
        <p style="font-size:12px; color:#888;">Waiting for acceptance</p>
      `;
      list.appendChild(div);
    });
  });
}

/* ================= ACCEPT / DECLINE ================= */

window.acceptRequest = async function (reqId) {
  try {
    const reqRef = doc(db, "messageRequests", reqId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) return;

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

    alert("Request accepted");
    window.location.href = `chat.html?chatId=${chatId}&from=private`;
  } catch (err) {
    console.error("Accept failed:", err);
    alert("Error accepting request");
  }
};

window.declineRequest = async function (reqId) {
  try {
    await updateDoc(doc(db, "messageRequests", reqId), { status: "declined" });
    alert("Request declined");
  } catch (err) {
    console.error("Decline failed:", err);
  }
};

/* ================= OPEN CHAT ================= */

window.openChat = async function (chatId) {
  try {
    await updateDoc(doc(db, "chats", chatId), {
      [`unread.${currentUserId}`]: 0
    });
  } catch {}

  window.location.href = `chat.html?chatId=${chatId}&from=private`;
};

/* ================= LOGOUT ================= */

window.logout = async function () {
  try {
    if (userRef) {
      await updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      });
    }
  } catch {}

  await signOut(auth);
  window.location.href = "index.html";
};

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};

/* ================= NOTIFICATION ================= */

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "custom-notification";
  notification.innerText = message;

  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 3000);
            }
