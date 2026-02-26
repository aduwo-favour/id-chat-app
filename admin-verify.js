import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, query, where, getDocs, doc, 
  updateDoc, getDoc, orderBy 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUser = null;
let currentUsername = null;
let isAdmin = false;

window.goBack = function() { window.location.href = 'dashboard.html'; };

onAuthStateChanged(auth, async (user) => {
  if (!user) { 
    window.location.href = 'index.html'; 
    return; 
  }
  
  currentUser = user;
  
  // Check if current user is admin
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    isAdmin = userDoc.data().isAdmin || false;
    
    if (isAdmin) {
      document.getElementById('adminCheck').innerHTML = '✅ You are an admin';
      document.getElementById('verificationPanel').style.display = 'block';
      loadUnverifiedUsers();
    } else {
      document.getElementById('adminCheck').innerHTML = '⛔ You are not authorized to access this page';
    }
  }
});

async function loadUnverifiedUsers(searchTerm = '') {
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '<div class="loading">Loading users...</div>';
  
  try {
    // Get all users
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("username"));
    const snapshot = await getDocs(q);
    
    let html = '<h4>Users (click verify to add blue tick):</h4>';
    
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      
      // Skip admins and already verified users
      if (userData.isAdmin) continue;
      
      const username = userData.username;
      const isVerified = userData.verified || false;
      const verifiedBy = userData.verifiedBy || null;
      const verifiedAt = userData.verifiedAt ? new Date(userData.verifiedAt).toLocaleDateString() : null;
      
      // Filter by search term
      if (searchTerm && !username.toLowerCase().includes(searchTerm.toLowerCase())) continue;
      
      html += `
        <div class="user-item" data-userid="${doc.id}">
          <div class="user-avatar">${username[0].toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">
              ${username} 
              ${isVerified ? '<span class="verified-badge">✓ Verified</span>' : ''}
            </div>
            ${isVerified ? `
              <div class="user-details">
                <small>Verified by: ${verifiedBy} on ${verifiedAt}</small>
              </div>
            ` : ''}
          </div>
          <button class="verify-btn" 
                  onclick="verifyUser('${doc.id}', '${username}')" 
                  ${isVerified ? 'disabled' : ''}>
            ${isVerified ? '✓ Verified' : 'Verify User'}
          </button>
        </div>
      `;
    }
    
    if (html.includes('user-item')) {
      usersList.innerHTML = html;
    } else {
      usersList.innerHTML = '<div class="no-users">No users found</div>';
    }
  } catch (error) {
    console.error("Error loading users:", error);
    usersList.innerHTML = '<div class="error">Error loading users</div>';
  }
}

// Make verifyUser available globally
window.verifyUser = async function(userId, username) {
  if (!confirm(`Verify ${username} with a blue tick?`)) return;
  
  try {
    await updateDoc(doc(db, "users", userId), {
      verified: true,
      verifiedAt: new Date().toISOString(),
      verifiedBy: currentUsername  // This sets the admin's username
    });
    
    alert(`${username} is now verified! ✓`);
    loadUnverifiedUsers(document.getElementById('searchUsers').value);
  } catch (error) {
    console.error("Error verifying user:", error);
    alert("Failed to verify user");
  }
};

// Search functionality
document.getElementById('searchUsers')?.addEventListener('input', (e) => {
  loadUnverifiedUsers(e.target.value);
});

// Load users when search changes
window.loadUnverifiedUsers = loadUnverifiedUsers;
