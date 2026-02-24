import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  try {
    // Get user data
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentUsername = userDoc.data().username;
      document.getElementById('welcomeUser').textContent = `Welcome, ${currentUsername}!`;
      
      // Update online status
      await updateDoc(doc(db, "users", user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      });
    } else {
      // If user doc doesn't exist, create it
      await updateDoc(doc(db, "users", user.uid), {
        username: user.email.split('@')[0],
        online: true,
        lastSeen: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Dashboard error:", error);
  }
});

// Navigation
window.navigateTo = function(page) {
  window.location.href = page;
};

// Logout
window.logout = async function() {
  await signOut(auth);
  window.location.href = 'index.html';
};
