import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadRequests();
    listenForNewRequests(); // Listen for real-time updates
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
            <div class="request-time">${formatTime(data.createdAt)}</div>
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

// Listen for new requests (for notification badge)
function listenForNewRequests() {
  const requestsQuery = query(
    collection(db, "requests"),
    where("to", "==", currentUsername),
    where("status", "==", "pending")
  );

  onSnapshot(requestsQuery, (snapshot) => {
    // Update badge in dashboard if exists
    const badge = document.getElementById('requestsBadge');
    if (badge) {
      const count = snapshot.size;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }
  });
}

// Format time
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000 / 60);
  
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} minutes ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
  return date.toLocaleDateString();
}

// Accept request
window.acceptRequest = async function(requestId, fromUser) {
  try {
    const chatId = [currentUsername, fromUser].sort().join('_');
    
    // Check if user is blocked
    const userRef = collection(db, "users");
    const q = query(userRef, where("username", "==", fromUser));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const userData = snapshot.docs[0].data();
      if (userData.blockedUsers?.includes(currentUsername)) {
        alert('You cannot accept this request - you are blocked by this user');
        return;
      }
    }

    // Create chat with ACCEPTED status
    await setDoc(doc(db, "chats", chatId), {
      participants: [currentUsername, fromUser],
      createdAt: new Date().toISOString(),
      unread: {},
      status: "accepted",  // Mark as accepted
      isBlocked: false
    });

    // Delete the request
    await deleteDoc(doc(db, "requests", requestId));

    alert('Request accepted! You can now chat.');
    window.location.href = `chat.html?chatId=${chatId}&user=${fromUser}`;

  } catch (error) {
    console.error("Accept error:", error);
    alert('Failed to accept request');
  }
};

// Decline request
window.declineRequest = async function(requestId) {
  if (confirm('Decline this request?')) {
    await deleteDoc(doc(db, "requests", requestId));
  }
};

// Go back
window.goBack = function() {
  window.location.href = 'dashboard.html';
};
