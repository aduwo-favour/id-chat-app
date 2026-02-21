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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));

  currentUserId = userDoc.data().userId;

  document.getElementById("welcome").innerText =
    "Logged in as: " + currentUserId;

  loadChats();
});

window.logout = async function () {
  await signOut(auth);
  window.location.href = "index.html";
};

window.startChat = async function () {
  const friendId = document.getElementById("friendId").value.trim();

  if (!friendId) return;

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", friendId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    alert("User ID not found");
    return;
  }

  const chatId = [currentUserId, friendId].sort().join("_");
  window.location.href = "chat.html?chatId=" + chatId;
};

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
      const otherUser = data.participants.find(id => id !== currentUserId);

      const div = document.createElement("div");
      div.className = "chat-item";
      div.innerHTML = `
        <span>${otherUser}</span>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      chatList.appendChild(div);
    });
  });
}

window.openChat = function (chatId) {
  window.location.href = "chat.html?chatId=" + chatId;
};
