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
    if (welcome) welcome.innerText = "Logged in as: " + currentUserId;

    // Presence setup
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

    // Load data
    loadChats();

    if (document.getElementById("requestsList")) {
      loadRequests();
    }

    if (document.getElementById("sentRequestsList")) {
      loadSentRequests();
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
      });
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

  if (!friendId) return showNotification("Enter Friend ID");
  if (friendId === currentUserId) return showNotification("You cannot chat with yourself");

  try {
    const q = query(collection(db, "users"), where("userId", "==", friendId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return showNotification("User not found");

    const chatId = [currentUserId, friendId].sort().join("_");
    window.location.href = `chat.html?chatId=${chatId}&from=private`;
  } catch (err) {
    console.error("Start chat error:", err);
    showNotification("Error starting chat");
  }
};

/* ================= LOAD CHATS ================= */

function loadChats() {
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

      // Load presence
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
        console.warn("Presence load failed for", otherUser, err);
        div.querySelector(".chat-status").innerText = "Offline";
      }
    }

    const privateBadge = document.getElementById("privateBadge");
    if (privateBadge) {
      privateBadge.innerText = totalUnread || "";
      privateBadge.style.display = totalUnread > 0 ? "inline-block" : "none";
    }

    document.title = totalUnread > 0 ? `(${totalUnread}) New Messages` : originalTitle;
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

    showNotification("Request accepted");
    window.location.href = `chat.html?chatId=${chatId}&from=private`;
  } catch (err) {
    console.error("Accept failed:", err);
    showNotification("Error accepting request");
  }
};

window.declineRequest = async function (reqId) {
  try {
    await updateDoc(doc(db, "messageRequests", reqId), { status: "declined" });
    showNotification("Request declined");
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

/* ================= NOTIFICATION ================= */

function showNotification(message) {
  const n = document.createElement("div");
  n.className = "custom-notification";
  n.innerText = message;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3500);
}

/* ================= NAVIGATION ================= */

window.openCommunity = () => window.location.href = "community.html";
window.openPrivate = () => window.location.href = "private.html";
