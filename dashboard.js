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
  getDocs
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;

// 🔐 Check if user is logged in
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists()) {
      alert("User data not found.");
      return;
    }

    currentUserId = userDoc.data().userId;

    document.getElementById("welcome").innerText =
      "Logged in as: " + currentUserId;

    loadChats();
  }
});

// 🚪 Logout
window.logout = async function () {
  await signOut(auth);
  window.location.href = "index.html";
};

// 💬 Start Chat (With Validation)
window.startChat = async function () {
  const friendIdInput = document.getElementById("friendId");
  const friendId = friendIdInput.value.trim();

  if (!friendId) {
    alert("Enter Friend ID");
    return;
  }

  if (friendId === currentUserId) {
    alert("You cannot chat with yourself");
    return;
  }

  // 🔎 Check if friend exists
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("userId", "==", friendId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    alert("User ID does not exist");
    return;
  }

  const chatId = [currentUserId, friendId].sort().join("_");

  window.location.href = "chat.html?chatId=" + chatId;
};

// 📂 Load Old Chats
async function loadChats() {
  const chatsRef = collection(db, "chats");
  const q = query(
    chatsRef,
    where("participants", "array-contains", currentUserId)
  );

  const snapshot = await getDocs(q);

  const chatList = document.getElementById("chatList");
  chatList.innerHTML = "";

  if (snapshot.empty) {
    chatList.innerHTML = "<p>No chats yet.</p>";
    return;
  }

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const otherUser = data.participants.find(
      (id) => id !== currentUserId
    );

    const div = document.createElement("div");
    div.innerHTML = `
      <p>
        Chat with ${otherUser}
        <button onclick="openChat('${docSnap.id}')">Open</button>
      </p>
    `;

    chatList.appendChild(div);
  });
}

// 📖 Open Existing Chat
window.openChat = function (chatId) {
  window.location.href = "chat.html?chatId=" + chatId;
};