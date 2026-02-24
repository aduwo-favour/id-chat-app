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
  setDoc
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
      
      // Show loading
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
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Auth error: ' + error.message + '</div>';
  }
});

// Load message requests - SIMPLIFIED VERSION (no index needed)
function loadRequests() {
  if (!currentUsername) {
    console.log("Waiting for username...");
    setTimeout(loadRequests, 1000);
    return;
  }

  console.log("Setting up requests listener for:", currentUsername);
  
  try {
    // SIMPLE QUERY - only filter by 'to' field (no status filter, no orderBy)
    const requestsQuery = query(
      collection(db, "requests"),
      where("to", "==", currentUsername)
    );

    // Use onSnapshot for real-time updates
    const unsubscribe = onSnapshot(requestsQuery, (snapshot) => {
      console.log("Requests snapshot received. Total size:", snapshot.size);
      
      const requestsList = document.getElementById('requestsList');
      
      if (!requestsList) {
        console.error("requestsList element not found!");
        return;
      }
      
      // Filter for pending requests in JavaScript (not in the query)
      const pendingRequests = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.status === "pending") {
          pendingRequests.push({
            id: doc.id,
            ...data
          });
        }
      });
      
      // Sort by createdAt in JavaScript (newest first)
      pendingRequests.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateB - dateA;
      });
      
      console.log("Pending requests after filtering:", pendingRequests.length);
      
      if (pendingRequests.length === 0) {
        requestsList.innerHTML = '<div class="no-requests">No pending requests</div>';
        return;
      }

      let requestsHTML = '';
      pendingRequests.forEach(request => {
        requestsHTML += `
          <div class="request-item" data-id="${request.id}">
            <div class="request-avatar">${request.from ? request.from[0].toUpperCase() : '?'}</div>
            <div class="request-details">
              <div class="request-from">${request.from || 'Unknown User'}</div>
              <div class="request-message">Wants to chat with you</div>
              <div class="request-time">${formatTime(request.createdAt)}</div>
            </div>
            <div class="request-actions">
              <button onclick="acceptRequest('${request.id}', '${request.from}')" class="accept-btn">✓ Accept</button>
              <button onclick="declineRequest('${request.id}')" class="decline-btn">✕ Decline</button>
            </div>
          </div>
        `;
      });

      requestsList.innerHTML = requestsHTML;
    }, (error) => {
      console.error("Snapshot error:", error);
      document.getElementById('requestsList').innerHTML = '<div class="error-message">Error: ' + error.message + '</div>';
    });

    // Return unsubscribe function in case we need it later
    return unsubscribe;
    
  } catch (error) {
    console.error("Error setting up requests listener:", error);
    document.getElementById('requestsList').innerHTML = '<div class="error-message">Failed: ' + error.message + '</div>';
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
