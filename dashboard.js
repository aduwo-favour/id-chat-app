import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, collection, query, where, 
  onSnapshot, getDocs 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

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
      
      await updateDoc(doc(db, "users", user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      });
      
      listenForRequests();
      listenForCommunityRequests();
    }
  } catch (error) {
    console.error("Dashboard error:", error);
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
      await updateDoc(doc(db, "users", currentUid), {
        online: false,
        lastSeen: new Date().toISOString()
      });
      
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
