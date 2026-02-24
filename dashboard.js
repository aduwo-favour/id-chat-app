import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

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
      
      // Listen for request count
      listenForRequests();
    }
  } catch (error) {
    console.error("Dashboard error:", error);
  }
});

// Listen for pending requests
function listenForRequests() {
  if (!currentUsername) return;
  
  const requestsQuery = query(
    collection(db, "requests"),
    where("to", "==", currentUsername),
    where("status", "==", "pending")
  );

  onSnapshot(requestsQuery, (snapshot) => {
    const count = snapshot.size;
    const badge = document.getElementById('requestsBadge');
    
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  });

  // Also listen for unread messages
  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUsername)
  );

  onSnapshot(chatsQuery, (snapshot) => {
    let totalUnread = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.unread && data.unread[currentUsername]) {
        totalUnread += data.unread[currentUsername];
      }
    });

    const chatBadge = document.getElementById('privateChatsBadge');
    if (totalUnread > 0) {
      chatBadge.textContent = totalUnread;
      chatBadge.style.display = 'inline';
    } else {
      chatBadge.style.display = 'none';
    }
  });
}

// Navigation
window.navigateTo = function(page) {
  window.location.href = page;
};

// Logout
window.logout = async function() {
  if (currentUid) {
    try {
      await updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      });
    } catch (e) {
      console.log("Offline update skipped");
    }
  }
  await signOut(auth);
  window.location.href = 'index.html';
};
