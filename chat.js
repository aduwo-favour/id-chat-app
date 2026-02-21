import { auth, db } from "./firebase.js";
import { 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import { 
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUserId = null;
let chatId = null;

// Get chatId from URL
const urlParams = new URLSearchParams(window.location.search);
chatId = urlParams.get("chatId");

// Check login
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    currentUserId = userDoc.data().userId;

    createChatIfNotExists();
    loadMessages();
  }
});

// Create chat document if it doesn't exist
async function createChatIfNotExists() {
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    const participants = chatId.split("_");

    await setDoc(chatRef, {
      participants: participants,
      createdAt: new Date()
    });
  }
}

// Send message
window.sendMessage = async function () {
  const message = document.getElementById("messageInput").value;
  if (!message) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    sender: currentUserId,
    text: message,
    timestamp: new Date()
  });

  document.getElementById("messageInput").value = "";
};

// Load messages in real time
function loadMessages() {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp")
  );

  onSnapshot(q, (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    snapshot.forEach((doc) => {
      const data = doc.data();

      const messageClass =
  data.sender === currentUserId
    ? "message my-message"
    : "message other-message";

messagesDiv.innerHTML += `
  <div class="${messageClass}">
    ${data.text}
  </div>
`;
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

// Back button
window.goBack = function () {
  window.location.href = "dashboard.html";
};