import { auth, db, messaging, onForegroundMessage } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, collection, query, where, 
  onSnapshot, getDocs, arrayUnion 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getToken } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

let currentUsername = null;
let currentUid = null;

// Show in-app notification for foreground messages
function showInAppNotification(payload) {
  const { title, body } = payload.notification;
  
  // Create notification element
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.innerHTML = `
    <strong>${title}</strong><br>
    <span>${body}</span>
  `;
  document.body.appendChild(notif);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    notif.classList.add('fade-out');
    setTimeout(() => notif.remove(), 500);
  }, 5000);
  
  // Click to open chat if possible
  notif.addEventListener('click', () => {
    if (payload.data && payload.data.chatId && payload.data.sender) {
      window.location.href = `chat.html?chatId=${payload.data.chatId}&user=${payload.data.sender}`;
    }
  });
}

// Request and update FCM token
async function updateFCMToken() {
  try {
    if (!currentUid) return;
    
    // Check if notifications are supported
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return;
    }
    
    // Request permission and get token
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && messaging) {
      const token = await getToken(messaging, { 
        vapidKey: 'BIP1LxUoE_mKvZ6jHymMOZg5b9qBo3ffthV6B0tA5XvTbLyPb4HhC7yQlAqzRHKk23vz7PfYrK3kR8WzD9KJ-3I' // Replace with your VAPID key
      });
      
      if (token) {
        const userRef = doc(db, "users", currentUid);
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(token)
        });
        console.log('FCM token updated');
      }
    }
  } catch (error) {
    console.error('Error updating FCM token:', error);
  }
}

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
      document.getElementById('welcomeUser').textContent = `Welcome, ${currentUsername}!`;
      
      // Update online status
      await updateDoc(doc(db, "users", user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      });
      
      // Setup FCM token for push notifications
      await updateFCMToken();
      
      // Listen for foreground messages
      onForegroundMessage((payload) => {
        console.log('Foreground message received:', payload);
        showInAppNotification(payload);
      });
      
      // Check if user is admin and show admin card
      const isAdmin = userDoc.data().isAdmin || false;
      if (isAdmin) {
        document.getElementById('adminCard').style.display = 'block';
      }
      
      listenForRequests();
      listenForCommunityRequests();
    }
  } catch (error) {
    console.error("Dashboard error:", error);
  }
});

// Handle online status when tab becomes hidden/visible
document.addEventListener('visibilitychange', () => {
  if (!currentUid) return;
  
  if (document.hidden) {
    // User left the tab
    updateDoc(doc(db, "users", currentUid), {
      online: false,
      lastSeen: new Date().toISOString()
    }).catch(() => {});
  } else {
    // User returned to tab
    updateDoc(doc(db, "users", currentUid), {
      online: true,
      lastSeen: new Date().toISOString()
    }).catch(() => {});
  }
});

// Handle before unload to update status
window.addEventListener('beforeunload', () => {
  if (currentUid) {
    // Use sendBeacon for reliable last seen update
    const data = JSON.stringify({
      fields: {
        online: { booleanValue: false },
        lastSeen: { timestampValue: new Date().toISOString() }
      }
    });
    
    navigator.sendBeacon?.(
      `https://firestore.googleapis.com/v1/projects/chat-messaging-abaa9/databases/(default)/documents/users/${currentUid}`,
      data
    );
  }
});

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
    badge.style.display = count > 0 ? 'inline' : 'none';
    if (count > 0) badge.textContent = count;
  });

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
    chatBadge.style.display = totalUnread > 0 ? 'inline' : 'none';
    if (totalUnread > 0) chatBadge.textContent = totalUnread;
  });
}

function listenForCommunityRequests() {
  if (!currentUid) return;
  
  const communitiesQuery = query(collection(db, "communities"));
  
  onSnapshot(communitiesQuery, async (snapshot) => {
    let pendingCount = 0;
    const promises = [];
    
    snapshot.forEach(doc => {
      const requestsRef = collection(db, "communities", doc.id, "requests");
      const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
      promises.push(getDocs(q).then(snap => { pendingCount += snap.size; }));
    });
    
    await Promise.all(promises);
    
    const badge = document.getElementById('communityBadge');
    if (badge) {
      badge.style.display = pendingCount > 0 ? 'inline' : 'none';
      if (pendingCount > 0) badge.textContent = pendingCount;
    }
  });
}

window.navigateTo = function(page) {
  window.location.href = page;
};

window.logout = async function() {
  if (currentUid) {
    try {
      // Update online status to false before logout
      await updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      });
      
      // Update status in all communities
      const communities = await getDocs(collection(db, "communities"));
      const updatePromises = [];
      
      for (const community of communities.docs) {
        const memberRef = doc(db, "communities", community.id, "members", currentUid);
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) {
          updatePromises.push(
            updateDoc(memberRef, {
              online: false,
              lastSeen: new Date().toISOString()
            }).catch(() => {})
          );
        }
      }
      
      await Promise.all(updatePromises);
    } catch (e) {
      console.error("Error updating status on logout:", e);
    }
  }
  
  await signOut(auth);
  window.location.href = 'index.html';
};
