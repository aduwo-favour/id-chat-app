import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  writeBatch,
  orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

// Global back function
window.goBack = function() {
  window.location.href = 'dashboard.html';
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentUsername = userDoc.data().username;
      console.log("Current user:", currentUsername);
      loadRequests();
    } else {
      console.error("User document not found");
    }
  } catch (error) {
    console.error("Auth error:", error);
  }
});

// Load message requests
function loadRequests() {
  if (!currentUsername) {
    console.log("Waiting for username...");
    setTimeout(loadRequests, 500);
    return;
  }

  console.log("Loading requests for:", currentUsername);
  
  const requestsQuery = query(
    collection(db, "requests"),
    where("to", "==", currentUsername),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );

  onSnapshot(requestsQuery, (snapshot) => {
    console.log("Requests snapshot received, size:", snapshot.size);
    const requestsList = document.getElementById('requestsList');
    
    if (!requestsList) {
      console.error("requestsList element not found");
      return;
    }
    
    if (snapshot.empty) {
      requestsList.innerHTML = '<div class="no-requests">No pending requests</div>';
      return;
    }

    let requestsHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log("Request data:", data);
      
      requestsHTML += `
        <div class="request-item" data-id="${doc.id}">
          <div class="request-avatar">${data.from ? data.from[0].toUpperCase() : '?'}</div>
          <div class="request-details">
            <div class="request-from">${data.from || 'Unknown'}</div>
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
  }, (error) => {
    console.error("Snapshot error:", error);
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading requests</div>';
  });
}

// Format time
function formatTime(timestamp) {
  if (!timestamp) return 'Recently';
  
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000 / 60);
    
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} minutes ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
    return date.toLocaleDateString();
  } catch (e) {
    return 'Recently';
  }
}

// Accept request
window.acceptRequest = async function(requestId, fromUser) {
  if (!fromUser || !requestId) {
    alert('Invalid request');
    return;
  }

  try {
    const chatId = [currentUsername, fromUser].sort().join('_');
    
    // Check if user is blocked
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", fromUser));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const userData = snapshot.docs[0].data();
      if (userData.blockedUsers && userData.blockedUsers.includes(currentUsername)) {
        alert('You cannot accept this request - you are blocked by this user');
        return;
      }
    }

    // Create chat with ACCEPTED status
    await setDoc(doc(db, "chats", chatId), {
      participants: [currentUsername, fromUser],
      createdAt: new Date().toISOString(),
      unread: {},
      status: "accepted",
      isBlocked: false
    });

    // Delete the request
    await deleteDoc(doc(db, "requests", requestId));

    alert('Request accepted!');
    window.location.href = `chat.html?chatId=${chatId}&user=${fromUser}`;

  } catch (error) {
    console.error("Accept error:", error);
    alert('Failed to accept request: ' + error.message);
  }
};

// Decline request
window.declineRequest = async function(requestId) {
  if (confirm('Decline this request?')) {
    try {
      await deleteDoc(doc(db, "requests", requestId));
      alert('Request declined');
    } catch (error) {
      console.error("Decline error:", error);
      alert('Failed to decline request');
    }
  }
};

// Make functions global
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
