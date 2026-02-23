import { auth, db } from "./firebase.js";

import { onAuthStateChanged } from
"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;

/* ================= AUTH ================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // Get your custom userId (NOT uid)
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  currentUserId = userSnap.data().userId;

  loadMessages();
});

/* ================= SEND MESSAGE ================= */

window.sendMessage = async function () {

  const input = document.getElementById("messageInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  await addDoc(
    collection(db, "community", "global", "messages"),
    {
      sender: currentUserId,
      text,
      timestamp: serverTimestamp()
    }
  );

  input.value = "";
};

/* ================= LOAD MESSAGES ================= */

function loadMessages() {

  const q = query(
    collection(db, "community", "global", "messages"),
    orderBy("timestamp", "asc")
  );

  onSnapshot(q, (snapshot) => {

    const messagesDiv = document.getElementById("messages");
    if (!messagesDiv) return;

    messagesDiv.innerHTML = "";

    snapshot.forEach((docSnap) => {

      const data = docSnap.data();
      const isMine = data.sender === currentUserId;

      const div = document.createElement("div");
      div.className = isMine
        ? "message my-message"
        : "message other-message";

      let timeString = "";
      if (data.timestamp?.toDate) {
        timeString = data.timestamp.toDate().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      div.innerHTML = `
        <div class="sender-name">${data.sender}</div>
        <div class="message-text">${data.text}</div>
        <div class="message-time">${timeString}</div>
      `;

      messagesDiv.appendChild(div);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}
