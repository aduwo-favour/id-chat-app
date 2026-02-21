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
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;

/* ===============================
   AUTH STATE CHECK
=================================*/
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      alert("User profile not found. Please login again.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    const data = userDoc.data();

    if (!data.userId) {
      alert("User ID not set correctly.");
      return;
    }

    currentUserId = data.userId;

    document.getElementById("welcome").innerText =
      "Logged in as: " + currentUserId;

    loadChats();

  } catch (error) {
    console.error("Error loading user:", error);
    alert("Error loading user profile.");
  }
});

/* ===============================
   LOGOUT
=================================*/
window.logout = async function () {
  await signOut(auth);
  window.location.href = "index.html";
};

/* ===============================
   START CHAT
=================================*/
window.startChat = async function () {
  const friendId = document.getElementById("friendId").value.trim();

  if (!friendId) {
    alert("Enter Friend ID");
    return;
  }

  if (friendId === currentUserId) {
    alert("You cannot chat with yourself");
    return;
  }

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", friendId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      alert("User ID does not exist");
      return;
    }

    const chatId = [currentUserId, friendId].sort().join("_");
    window.location.href = "chat.html?chatId=" + chatId;

  } catch (error) {
    console.error("Error starting chat:", error);
    alert("Error starting chat.");
  }
};

/* ===============================
   LOAD CHATS
=================================*/
function loadChats() {
  const chatsRef = collection(db, "chats");

  const q = query(
    chatsRef,
    where("participants", "array-contains", currentUserId)
  );

  onSnapshot(q, (snapshot) => {
    const chatList = document.getElementById("chatList");
    chatList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const otherUser = data.participants.find(
        (id) => id !== currentUserId
      );

      const unreadCount =
        data.unread && data.unread[currentUserId]
          ? data.unread[currentUserId]
          : 0;

      const badge = unreadCount > 0
        ? `<span class="unread-badge">${unreadCount}</span>`
        : "";

      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <span>Chat with ${otherUser}</span>
        ${badge}
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      chatList.appendChild(div);
    });
  });
}

/* ===============================
   OPEN CHAT
=================================*/
window.openChat = function (chatId) {
  window.location.href = "chat.html?chatId=" + chatId;
};
