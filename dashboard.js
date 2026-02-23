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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;
let currentUid = null;
let originalTitle = document.title;
let userRef = null;
let unloadListenerAdded = false;

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

    /* ===== SET USER ONLINE ===== */

    await updateDoc(userRef, {
      online: true,
      lastSeen: serverTimestamp()
    }).catch(() => {});

    /* ===== SET OFFLINE WHEN TAB CLOSES ===== */

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

    /* ===== MOBILE VISIBILITY FIX ===== */

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

    /* ===== LOAD CHATS AFTER LOGIN ===== */

    loadChats();

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
    window.location.href = "chat.html?chatId=" + chatId;

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
    where("participants", "array-contains", currentUserId)
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

      // Update Private badge
const privateBadge = document.getElementById("privateBadge");

if (privateBadge) {
  if (totalUnread > 0) {
    privateBadge.style.display = "inline-block";
    privateBadge.innerText = totalUnread;
  } else {
    privateBadge.style.display = "none";
  }
}

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
          ${badge}
        </div>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      chatList.appendChild(div);

    });

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

  window.location.href = "chat.html?chatId=" + chatId;
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

      



