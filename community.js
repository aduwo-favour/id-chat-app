import { auth, db } from "./firebase.js";

import { onAuthStateChanged } from
"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;

onAuthStateChanged(auth, (user) => {

  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUserId = user.uid;

  loadMessages();
});

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

      const div = document.createElement("div");
      div.className = "message other-message";

      div.innerHTML = `
        <div class="sender-name">${data.sender}</div>
        <div class="message-text">${data.text}</div>
      `;

      messagesDiv.appendChild(div);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}
