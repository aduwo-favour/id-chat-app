import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadRequests();
  }
});

// Load message requests
function loadRequests() {
  const requestsQuery = query(
    collection(db, "requests"),
    where("to", "==", currentUsername),
    where("status", "==", "pending")
  );

  onSnapshot(requestsQuery, (snapshot) => {
    const requestsList = document.getElementById('requestsList');
    
    if (snapshot.empty) {
      requestsList.innerHTML = '<div class="no-requests">No pending requests</div>';
      return;
    }

    let requestsHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      requestsHTML += `
        <div class="request-item" data-id="${doc.id}">
          <div class="request-avatar">${data.from[0].toUpperCase()}</div>
          <div class="request-details">
            <div class="request-from">${data.from}</div>
            <div class="request-message">Wants to chat with you</div>
          </div>
          <div class="request-actions">
            <button onclick="acceptRequest('${doc.id}', '${data.from}')" class="accept-btn">✓ Accept</button>
            <button onclick="declineRequest('${doc.id}')" class="decline-btn">✕ Decline</button>
          </div>
        </div>
      `;
    });

    requestsList.innerHTML = requestsHTML;
  });
}

// Accept request
window.acceptRequest = async function(requestId, fromUser) {
  const chatId = [currentUsername, fromUser].sort().join('_');
  
  // Create chat
  await setDoc(doc(db, "chats", chatId), {
    participants: [currentUsername, fromUser],
    createdAt: serverTimestamp(),
    unread: {},
    isBlocked: false
  });

  // Delete request
  await deleteDoc(doc(db, "requests", requestId));

  alert('Request accepted! You can now chat.');
  window.location.href = `chat.html?chatId=${chatId}&user=${fromUser}`;
};

// Decline request
window.declineRequest = async function(requestId) {
  await deleteDoc(doc(db, "requests", requestId));
};

// Go back
window.goBack = function() {
  window.location.href = 'dashboard.html';
};
