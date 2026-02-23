import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

/* ================= GLOBALS ================= */

let currentUserId = null;
let currentUid = null;
let userRef = null;
let unloadListenerAdded = false;

/* ================= AUTH CHECK ================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUid = user.uid;
  userRef = doc(db, "users", currentUid);

  const userDoc = await getDoc(userRef);
  if (!userDoc.exists()) return;

  currentUserId = userDoc.data().userId;

  /* ===== SET ONLINE ===== */

  await updateDoc(userRef, {
    online: true,
    lastSeen: serverTimestamp()
  }).catch(() => {});

  /* ===== SET OFFLINE ON CLOSE ===== */

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

  loadPrivateChats();
});

/* ================= LOAD PRIVATE CHATS ================= */

function loadPrivateChats() {

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

    snapshot.forEach((docSnap) => {

      const data = docSnap.data();
      if (!data.participants) return;

      const otherUser = data.participants.find(
        id => id !== currentUserId
      );

      if (!otherUser) return;

      const unread =
        data.unread && data.unread[currentUserId]
          ? data.unread[currentUserId]
          : 0;

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

  });

}

/* ================= OPEN CHAT ================= */

window.openChat = async function (chatId) {

  try {
    const chatRef = doc(db, "chats", chatId);

    await updateDoc(chatRef, {
      [`unread.${currentUserId}`]: 0
    }).catch(() => {});
  } catch (e) {}

  window.location.href =
    "chat.html?chatId=" + chatId + "&from=private";
};

/* ================= LOGOUT ================= */

window.logout = async function () {

  try {
    if (userRef) {
      await updateDoc(userRef, {
        online: false,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    }
  } catch (e) {}

  await signOut(auth);
  window.location.href = "index.html";
};

/* ================= BACK ================= */

window.goBack = function () {
  window.location.href = "dashboard.html";
};
