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

    /* ===== PRESENCE SYSTEM (Realtime DB + Firestore mirror) ===== */

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
    if (userRef) {
      await updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    }
  } catch (e) {
    console.log("Offline update skipped");
  }

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
    window.location.href = "chat.html?chatId=" + chatId + "&from=dashboard";

  } catch (err) {
    console.error("Start chat error:", err);
  }
};

/* ================= LOAD CHATS ================= */

function loadChats() {
  if (!currentUserId) return;

  const chatsRef = collection(db, "chats");

  const q = query(
  chatsRef,
  where("participants", "array-contains", currentUserId),
  orderBy("lastMessageTime", "desc")
);

  onSnapshot(q, (snapshot) => {

    const chatList = document.getElementById("chatList");
    if (!chatList) return;

    chatList.innerHTML = "";

    let totalUnread = 0;

    snapshot.forEach((docSnap) => {

      const data = docSnap.data() || {};
      if (!data.participants) return;

      const otherUser = data.participants.find(
        id => id !== currentUserId
      );

      if (!otherUser) return;

      const unread =
        data.unread && data.unread[currentUserId]
          ? data.unread[currentUserId]
          : 0;

      totalUnread += unread;

      const badge = unread > 0
        ? `<span class="unread-badge">${unread}</span>`
        : "";

      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <div class="chat-info">
          <span>Chat with ${otherUser}</span>
          <span class="chat-status">...</span>
          ${badge}
        </div>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      chatList.appendChild(div);

      // Listen to presence
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("userId", "==", otherUser));
      getDocs(q).then(querySnapshot => {

        if (querySnapshot.empty) return;

        const otherDoc = querySnapshot.docs[0];

        const otherStatusRef = ref(rtdb, "status/" + otherDoc.id);

        onValue(otherStatusRef, (snap) => {

          const statusEl = div.querySelector(".chat-status");
          if (!statusEl) return;

          if (!snap.exists()) {
            statusEl.innerText = "Offline";
            statusEl.style.color = "gray";
            return;
          }

          const data = snap.val();

          if (data.online === true) {
            statusEl.innerText = "Online";
            statusEl.style.color = "green";
          } else {
            const date = new Date(data.lastChanged);
            const time = date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            });

            statusEl.innerText = "Last seen at " + time;
            statusEl.style.color = "gray";
          }

        });
      });

    });

    const privateBadge = document.getElementById("privateBadge");
    if (privateBadge) {
      if (totalUnread > 0) {
        privateBadge.style.display = "inline-block";
        privateBadge.innerText = totalUnread;
      } else {
        privateBadge.style.display = "none";
      }
    }

    if (totalUnread > 0) {
      document.title = `(${totalUnread}) New Messages`;
    } else {
      document.title = originalTitle;
    }

  });

}


/* ================= OPEN CHAT ================= */

window.openChat = async function (chatId) {
  try {
    const chatRef = doc(db, "chats", chatId);
    await updateDoc(chatRef, {
      [`unread.${currentUserId}`]: 0
    }).catch(() => {});
  } catch (err) {
    console.log("Unread reset skipped");
  }

  window.location.href = "chat.html?chatId=" + chatId + "&from=dashboard";
};


/* ================= LOAD REQUESTS ================= */

function loadRequests() {
  if (!currentUserId) return;

  const q = query(
    collection(db, "messageRequests"),
    where("to", "==", currentUserId),
    where("status", "==", "pending"),
    orderBy("lastUpdated", "desc")
  );

  onSnapshot(q, (snapshot) => {
    const requestsList = document.getElementById("requestsList");
    if (!requestsList) return;

    requestsList.innerHTML = "";

    let count = snapshot.size;

    const badge = document.getElementById("requestsBadge");
    if (badge) {
      if (count > 0) {
        badge.innerText = count;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }

    snapshot.forEach((docSnap) => {

      const data = docSnap.data();

      const div = document.createElement("div");
      div.className = "request-item";

      div.innerHTML = `
        <div class="request-info">
          <span>Request from ${data.from}</span>
        </div>
        <p>${data.firstMessage.text.substring(0, 100)}...</p>
        <button onclick="acceptRequest('${docSnap.id}')">Accept</button>
        <button onclick="declineRequest('${docSnap.id}')">Decline</button>
      `;

      requestsList.appendChild(div);

    });
  });
}

/* ================= ACCEPT REQUEST ================= */

window.acceptRequest = async function (requestId) {
  const requestRef = doc(db, "messageRequests", requestId);
  const snap = await getDoc(requestRef);

  if (!snap.exists()) return;

  const data = snap.data();

  const chatId = [data.from, data.to].sort().join("_");

  const chatRef = doc(db, "chats", chatId);

  await updateDoc(chatRef, {
    acceptedBy: [data.from, data.to]
  });

  await updateDoc(requestRef, {
    status: "accepted"
  });

  window.location.href = "chat.html?chatId=" + chatId + "&from=dashboard";
};

/* ================= DECLINE REQUEST ================= */

window.declineRequest = async function (requestId) {
  const requestRef = doc(db, "messageRequests", requestId);

  await updateDoc(requestRef, {
    status: "declined"
  });
};

/* ================= SIMPLE POPUP ================= */

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "custom-notification";
  notification.innerText = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);

  }
window.openCommunity = function () {
  window.location.href = "community.html";
};

window.openPrivate = function () {
  window.location.href = "private.html";
};
