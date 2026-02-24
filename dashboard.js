import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUser = null;
let currentUsername = null;

// Check auth state
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUser = user;

  // Get user data
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    document.getElementById('welcomeUser').textContent = `Welcome, ${currentUsername}!`;

    // Update online status
    await updateDoc(doc(db, "users", user.uid), {
      online: true,
      lastSeen: serverTimestamp()
    });

    // Listen for unread counts
    listenForUnread();
  }
});

// Listen for unread messages and requests
function listenForUnread() {
  // Private chats unread count
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

    const badge = document.getElementById('privateChatsBadge');
    if (totalUnread > 0) {
      badge.textContent = totalUnread;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  });

  // Requests count
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
}

// Navigation
window.navigateTo = function(page) {
  window.location.href = page;
};

// Logout
window.logout = async function() {
  if (currentUser) {
    await updateDoc(doc(db, "users", currentUser.uid), {
      online: false,
      lastSeen: serverTimestamp()
    });
  }
  await signOut(auth);
  window.location.href = 'index.html';
};

// Handle visibility change
document.addEventListener("visibilitychange", async () => {
  if (!currentUser) return;

  if (document.visibilityState === "visible") {
    await updateDoc(doc(db, "users", currentUser.uid), {
      online: true
    });
  }
});
