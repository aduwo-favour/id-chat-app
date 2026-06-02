import { auth, db, messaging, onForegroundMessage, watchBanStatus } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, query, where,
  onSnapshot, getDocs, arrayUnion
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getToken } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

let currentUsername = null;
let currentUid = null;
let unsubscribeRequests = null;
let unsubscribeChats = null;
let requestsFirstLoad = true;
let chatsFirstLoad = true;

// SECURITY: Escape HTML to prevent XSS anywhere we insert dynamic text
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// SECURITY: Build notification DOM using textContent, NOT innerHTML,
// so push notification payloads cannot inject scripts.
function showInAppNotification(payload) {
  if (!payload.notification) return;

  const { title, body } = payload.notification;

  const notif = document.createElement('div');
  notif.className = 'notification';

  const strong = document.createElement('strong');
  strong.textContent = title || '';          // textContent — safe

  const br = document.createElement('br');

  const span = document.createElement('span');
  span.textContent = body || '';             // textContent — safe

  notif.appendChild(strong);
  notif.appendChild(br);
  notif.appendChild(span);
  document.body.appendChild(notif);

  setTimeout(() => {
    notif.classList.add('fade-out');
    setTimeout(() => notif.remove(), 500);
  }, 5000);

  notif.addEventListener('click', () => {
    // SECURITY: Validate chatId and sender before constructing URL
    const chatId = payload.data?.chatId;
    const sender = payload.data?.sender;
    if (chatId && sender && /^[a-zA-Z0-9_]+$/.test(sender)) {
      window.location.href = `chat.html?chatId=${encodeURIComponent(chatId)}&user=${encodeURIComponent(sender)}`;
    }
  });
}

async function updateFCMToken() {
  if (!currentUid) return;
  try {
    // requestNotificationPermission in firebase.js handles permission + VAPID key
    const { requestNotificationPermission } = await import("./firebase.js");
    const token = await requestNotificationPermission();
    if (token) {
      await updateDoc(doc(db, "users", currentUid), {
        fcmTokens: arrayUnion(token)
      });
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
    // Immediately sign out if admin bans this user while they are online
    watchBanStatus(user.uid, async () => {
      await signOut(auth);
      window.location.href = 'index.html';
    });

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();

      // SECURITY: Check for banned/disabled on every page load
      if (userData.banned) {
        await signOut(auth);
        window.location.href = 'index.html';
        return;
      }
      if (userData.disabled) {
        await signOut(auth);
        window.location.href = 'index.html';
        return;
      }

      currentUsername = userData.username;

      // SECURITY: Use textContent, not innerHTML or string interpolation
      const welcomeEl = document.getElementById('welcomeUser');
      if (welcomeEl) welcomeEl.textContent = `Welcome, ${currentUsername}!`;

      await updateDoc(doc(db, "users", user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      });

      await updateFCMToken();

      onForegroundMessage((payload) => {
        showInAppNotification(payload);
      });

      const isAdmin = userData.isAdmin || false;
      const adminCard = document.getElementById('adminCard');
      if (adminCard) {
        adminCard.style.display = isAdmin ? 'block' : 'none';
      }

      if (unsubscribeRequests) unsubscribeRequests();
      if (unsubscribeChats) unsubscribeChats();

      listenForRequests();
      listenForCommunityRequests();
    } else {
      await signOut(auth);
      window.location.href = 'index.html';
    }
  } catch (error) {
    console.error("Dashboard error:", error);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!currentUid) return;

  updateDoc(doc(db, "users", currentUid), {
    online: !document.hidden,
    lastSeen: new Date().toISOString()
  }).catch((error) => console.error('Error updating status:', error));
});

window.addEventListener('beforeunload', () => {
  if (currentUid) {
    // Use sendBeacon for reliable last-seen on page close
    // SECURITY: Do NOT include sensitive user data in the beacon payload.
    // Only send status fields. The Firestore REST endpoint requires auth;
    // consider a Cloud Function endpoint for proper server-side auth on beacon.
    try {
      updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    } catch (e) {}
  }
});

function listenForRequests() {
  if (!currentUsername) return;
  requestsFirstLoad = true;
  chatsFirstLoad = true;

  try {
    const requestsQuery = query(
      collection(db, "requests"),
      where("to", "==", currentUsername),
      where("status", "==", "pending")
    );

    unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
      const count = snapshot.size;
      const badge = document.getElementById('requestsBadge');
      if (badge) {
        badge.style.display = count > 0 ? 'inline' : 'none';
        if (count > 0) badge.textContent = count;
      }

      if (!requestsFirstLoad) {
        snapshot.docChanges().forEach(ch => {
          if (ch.type === 'added') {
            const r = ch.doc.data();
            if (r.from) {
              showInAppNotification({ notification: {
                title: 'New message request',
                body: `${r.from} sent you a message request`
              }});
            }
          }
        });
      }
      requestsFirstLoad = false;
    }, (error) => {
      console.error('Error listening to requests:', error);
    });
  } catch (error) {
    console.error('Error setting up requests listener:', error);
  }

  try {
    const chatsQuery = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUsername)
    );

    unsubscribeChats = onSnapshot(chatsQuery, (snapshot) => {
      let totalUnread = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.unread && data.unread[currentUsername]) {
          totalUnread += data.unread[currentUsername];
        }
      });

      if (!chatsFirstLoad) {
        snapshot.docChanges().forEach(ch => {
          if (ch.type === 'added') {
            const c = ch.doc.data();
            // Notify the SENDER when the other person accepted their request.
            if (c.status === 'accepted' && c.acceptedBy && c.acceptedBy !== currentUsername) {
              showInAppNotification({
                notification: {
                  title: 'Request accepted',
                  body: `${c.acceptedBy} accepted your request`
                },
                data: { chatId: ch.doc.id, sender: c.acceptedBy }
              });
            }
          }
        });
      }
      chatsFirstLoad = false;

      const chatBadge = document.getElementById('privateChatsBadge');
      if (chatBadge) {
        chatBadge.style.display = totalUnread > 0 ? 'inline' : 'none';
        if (totalUnread > 0) chatBadge.textContent = totalUnread;
      }
    }, (error) => {
      console.error('Error listening to chats:', error);
    });
  } catch (error) {
    console.error('Error setting up chats listener:', error);
  }
}

function listenForCommunityRequests() {
  if (!currentUid) return;

  try {
    const communitiesQuery = query(collection(db, "communities"));

    onSnapshot(communitiesQuery, async (snapshot) => {
      let pendingCount = 0;
      const promises = [];

      snapshot.forEach(doc => {
        const requestsRef = collection(db, "communities", doc.id, "requests");
        const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
        promises.push(getDocs(q).then(snap => { pendingCount += snap.size; }).catch(() => {}));
      });

      await Promise.all(promises);

      const badge = document.getElementById('communityBadge');
      if (badge) {
        badge.style.display = pendingCount > 0 ? 'inline' : 'none';
        if (pendingCount > 0) badge.textContent = pendingCount;
      }
    }, (error) => {
      console.error('Error listening to community requests:', error);
    });
  } catch (error) {
    console.error('Error setting up community requests listener:', error);
  }
}

window.navigateTo = function(page) {
  // SECURITY: Whitelist allowed navigation targets to prevent open redirect
  const allowedPages = ['private-chats.html', 'profile.html', 'community.html', 'admin-verify.html'];
  if (allowedPages.includes(page)) {
    window.location.href = page;
  }
};

window.logout = async function() {
  try {
    if (currentUid) {
      await updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      }).catch(() => {});

      try {
        const communities = await getDocs(collection(db, "communities"));
        const updatePromises = [];

        for (const community of communities.docs) {
          const memberRef = doc(db, "communities", community.id, "members", currentUid);
          const memberSnap = await getDoc(memberRef).catch(() => null);
          if (memberSnap?.exists()) {
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
        console.error("Error updating community status:", e);
      }
    }

    if (unsubscribeRequests) unsubscribeRequests();
    if (unsubscribeChats) unsubscribeChats();

    // Clear all cached data so next user doesn't see stale content
    try {
      const keys = Object.keys(sessionStorage).filter(k => k.startsWith('chatapp_'));
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch (e) {}

    await signOut(auth);
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
};
