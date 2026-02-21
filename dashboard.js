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
  updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;
let shownNotifications = {};
let originalTitle = document.title;

/* ================= AUTH STATE ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists()) {
      alert("User data not found.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    currentUserId = userDoc.data().userId;

    document.getElementById("welcome").innerText =
      "Logged in as: " + currentUserId;

    loadChats();

  } catch (error) {
    console.error(error);
    alert("Error loading user data.");
  }
});

/* ================= LOGOUT ================= */

window.logout = async function () {
  await signOut(auth);
  window.location.href = "index.html";
};

/* ================= START CHAT ================= */

window.startChat = async function () {
  const friendId = document.getElementById("friendId").value.trim();

  if (!friendId) {
    showNotification("Enter Friend ID");
    return;
  }

  if (friendId === currentUserId) {
    showNotification("You cannot chat with yourself");
    return;
  }

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", friendId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    showNotification("User not found");
    return;
  }

  const chatId = [currentUserId, friendId].sort().join("_");
  window.location.href = "chat.html?chatId=" + chatId;
};

/* ================= LOAD CHATS ================= */

function loadChats() {
  const chatsRef = collection(db, "chats");

  const q = query(
    chatsRef,
    where("participants", "array-contains", currentUserId)
  );

  onSnapshot(q, (snapshot) => {
    const chatList = document.getElementById("chatList");
    chatList.innerHTML = "";

    let totalUnread = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const otherUser = data.participants.find(
        id => id !== currentUserId
      );

      const unread = data.unread?.[currentUserId] || 0;

      totalUnread += unread;

      // Show popup only once per update
      if (unread > 0 && !shownNotifications[docSnap.id]) {
        showNotification("New message from " + otherUser);
        playSound();
        shownNotifications[docSnap.id] = true;
      }

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

    // Update browser tab title
    if (totalUnread > 0) {
      document.title = `(${totalUnread}) New Messages`;
    } else {
      document.title = originalTitle;
    }
  });
}

/* ================= OPEN CHAT ================= */

window.openChat = async function (chatId) {
  // Reset unread when opening chat
  const chatRef = doc(db, "chats", chatId);

  try {
    await updateDoc(chatRef, {
      [`unread.${currentUserId}`]: 0
    });
  } catch (e) {
    console.log("Unread reset error:", e);
  }

  window.location.href = "chat.html?chatId=" + chatId;
};

/* ================= POPUP NOTIFICATION ================= */

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "custom-notification";
  notification.innerText = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/* ================= SOUND ================= */

function playSound() {
  const audio = new Audio(
    "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
  );
  audio.play().catch(() => {});
}
