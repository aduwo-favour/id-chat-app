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
  setDoc,
  orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Make goBack globally available
window.goBack = function() {
  window.location.href = 'dashboard.html';
};

let currentUsername = null;
let currentUid = null;

// Check authentication
onAuthStateChanged(auth, async (user) => {
  console.log("Auth state changed:", user ? "Logged in" : "Not logged in");
  
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
      
      // Show that we're loading
      const requestsList = document.getElementById('requestsList');
      if (requestsList) {
        requestsList.innerHTML = '<div class="loading">Loading requests...</div>';
      }
      
      // Load requests
      loadRequests();
    } else {
      console.error("User document not found");
      document.getElementById('requestsList').innerHTML = '<div class="error-message">User not found</div>';
    }
  } catch (error) {
    console.error("Auth error:", error);
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Error loading user</div>';
  }
});

// Load message requests
function loadRequests() {
  if (!currentUsername) {
    console.log("Waiting for username...");
    setTimeout(loadRequests, 1000);
    return;
  }

  console.log("Setting up requests listener for:", currentUsername);
  
  try {
    const requestsQuery = query(
      collection(db, "requests"),
      where("to", "==", currentUsername),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc")
    );

    // Use onSnapshot for real-time updates
    const unsubscribe = onSnapshot(requestsQuery, (snapshot) => {
      console.log("Requests snapshot received. Size:", snapshot.size);
      
      const requestsList = document.getElementById('requestsList');
      
      if (!requestsList) {
        console.error("requestsList element not found!");
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
              <div class="request-from">${data.from || 'Unknown User'}</div>
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

    // Return unsubscribe function in case we need it later
    return unsubscribe;
    
  } catch (error) {
    console.error("Error setting up requests listener:", error);
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Failed to load requests</div>';
  }
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
  console.log("Accepting request:", requestId, "from:", fromUser);
  
  if (!requestId || !fromUser) {
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
  console.log("Declining request:", requestId);
  
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

// Make functions globally available
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
