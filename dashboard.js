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
  setDoc,
  addDoc
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

    // Presence setup (unchanged from previous)
    const connectedRef = ref(rtdb, ".info/connected");
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        const statusRef = ref(rtdb, "status/" + currentUid);
        set(statusRef, { online: true, lastChanged: rtdbServerTimestamp() });
        onDisconnect(statusRef).set({ online: false, lastChanged: rtdbServerTimestamp() });
      }
    });

    await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});

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
        updateDoc(userRef, { online: false, lastSeen: serverTimestamp() }).catch(() => {});
      });
    }

    loadChats();

    if (document.getElementById("requestsList")) {
      loadRequests();
    }

  } catch (error) {
    console.error("Auth error:", error);
  }
});

/* ================= LOGOUT ================= */

window.logout = async function () {
  try {
    if (userRef) await updateDoc(userRef, { online: false, lastSeen: serverTimestamp() });
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
    console.error(err);
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
          <span class="chat-status">…</span>
          ${badge}
        </div>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;
      chatList.appendChild(div);

      // Presence (unchanged, but kept for completeness)
      const usersQ = query(collection(db, "users"), where("userId", "==", otherUser));
      const userSnap = await getDocs(usersQ);
      if (!userSnap.empty) {
        const otherUid = userSnap.docs[0].id;
        onValue(ref(rtdb, "status/" + otherUid), (snap) => {
          const el = div.querySelector(".chat-status");
          if (!el) return;
          if (!snap.exists() || !snap.val().online) {
            el.innerText = "Offline";
            el.style.color = "#888";
          } else {
            el.innerText = "Online";
            el.style.color = "#4caf50";
          }
        });
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

/* ================= LOAD MESSAGE REQUESTS ================= */

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
    const countEl = document.getElementById("requestsCount");
    const badge = document.getElementById("requestsBadge");

    if (!list) return;

    list.innerHTML = "";

    const count = snap.size;
    if (countEl) countEl.innerText = count > 0 ? `(${count})` : "";
    if (badge) {
      badge.innerText = count;
      badge.style.display = count > 0 ? "inline-block" : "none";
    }

    if (count === 0) {
      list.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">No pending requests</p>';
      return;
    }

    snap.forEach((docSnap) => {
      const req = docSnap.data();
      const div = document.createElement("div");
      div.className = "request-item";
      div.innerHTML = `
        <div class="request-header">
          <strong>From: ${req.from}</strong>
          <span class="request-time">${formatRelativeTime(req.lastUpdated?.toDate?.() || new Date())}</span>
        </div>
        <p class="request-preview">${req.firstMessage?.text?.substring(0, 120) || "No message"} ${req.firstMessage?.text?.length > 120 ? '...' : ''}</p>
        <div class="request-actions">
          <button class="accept-btn" onclick="acceptRequest('${docSnap.id}')">Accept</button>
          <button class="decline-btn" onclick="declineRequest('${docSnap.id}')">Decline</button>
        </div>
      `;
      list.appendChild(div);
    });
  });
}

function formatRelativeTime(date) {
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  const h = Math.floor(min / 60);
  if (h < 24) return h + (h === 1 ? " hour" : " hours") + " ago";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
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

    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        participants: [req.from, req.to],
        acceptedBy: [req.from, req.to],
        unread: { [req.from]: 0, [req.to]: 0 },
        createdAt: serverTimestamp(),
        lastMessageTime: serverTimestamp()
      });
    } else {
      await updateDoc(chatRef, { acceptedBy: [req.from, req.to] });
    }

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
    showNotification("Request accepted!");
    window.location.href = `chat.html?chatId=${chatId}&from=private`;
  } catch (err) {
    console.error(err);
    showNotification("Error accepting request");
  }
};

window.declineRequest = async function (reqId) {
  try {
    await updateDoc(doc(db, "messageRequests", reqId), { status: "declined" });
    showNotification("Request declined");
  } catch (err) {
    console.error(err);
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
