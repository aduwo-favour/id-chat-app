import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, query, onSnapshot, doc, getDoc, addDoc,
  setDoc, updateDoc, deleteDoc, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null, currentUid = null;
let unsubscribeCommunities = null;

window.goBack = function() { 
  if (unsubscribeCommunities) unsubscribeCommunities();
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
      loadCommunities();
    } else {
      alert('User data not found');
    }
  } catch (error) {
    console.error('Auth error:', error);
    document.getElementById('communitiesList').innerHTML = '<div class="error-message">Error loading user</div>';
  }
});

function loadCommunities() {
  const list = document.getElementById('communitiesList');
  list.innerHTML = '<div class="loading">Loading communities...</div>';
  
  try {
    const q = query(collection(db, "communities"), orderBy("createdAt", "desc"));
    
    unsubscribeCommunities = onSnapshot(q, async (snap) => {
      if (snap.empty) {
        list.innerHTML = '<div class="no-communities">No communities yet. Create the first one!</div>';
        return;
      }
      
      let html = '';
      const promises = [];
      
      snap.forEach(doc => {
        promises.push(
          getCommunityStats(doc.id, doc.data())
            .then(stats => {
              const { memberCount, onlineCount, userStatus } = stats;
              let action = '', badge = '';
              
              if (['creator','admin','member'].includes(userStatus)) {
                action = `<button onclick="event.stopPropagation(); openCommunity('${doc.id}','${doc.data().name}')" class="join-btn entered"> Joined</button>`;
              } else if (userStatus === 'pending') {
                badge = '<span class="pending-badge">Request Pending</span>';
                action = `<button onclick="event.stopPropagation(); cancelRequest('${doc.id}')" class="cancel-btn">Cancel</button>`;
              } else if (userStatus === 'banned') {
                badge = '<span class="banned-badge">Banned</span>';
                action = `<button class="join-btn disabled" disabled>Banned</button>`;
              } else {
                action = `<button onclick="event.stopPropagation(); joinCommunity('${doc.id}','${doc.data().type}')" class="join-btn">Request to Join</button>`;
              }
              
              return `
                <div class="community-card" onclick="handleCommunityClick('${doc.id}','${doc.data().name}','${userStatus}')">
                  <div class="community-avatar">${escapeHtml(doc.data().name[0]?.toUpperCase() || '?')}</div>
                  <div class="community-info">
                    <div class="community-name">
                      ${escapeHtml(doc.data().name)}
                      ${doc.data().type === 'private' ? '<span class="private-badge">Private</span>' : '<span class="public-badge">Public</span>'}
                      ${doc.data().createdBy === currentUsername ? '<span class="creator-badge">Creator</span>' : ''}
                    </div>
                    <div class="community-description">${escapeHtml(doc.data().description || 'No description')}</div>
                    <div class="community-stats"><span> ${memberCount}</span> <span> ${onlineCount}</span></div>
                    ${badge}
                  </div>
                  <div class="community-action">${action}</div>
                </div>
              `;
            })
            .catch(err => {
              console.error('Error processing community:', err);
              return '';
            })
        );
      });
      
      const cards = await Promise.all(promises);
      list.innerHTML = cards.filter(card => card).join('') || '<div class="error-message">No communities available</div>';
      
    }, (error) => {
      console.error('Communities listener error:', error);
      list.innerHTML = '<div class="error-message">Failed to load communities</div>';
    });
  } catch (error) {
    console.error('Error setting up communities listener:', error);
    list.innerHTML = '<div class="error-message">Error initializing communities</div>';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.handleCommunityClick = function(id, name, status) {
  if (['creator','admin','member'].includes(status)) {
    window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(name)}`;
  } else {
    showGlobalBanner(status === 'pending' ? 'pending' : status === 'banned' ? 'banned' : 'join');
  }
};

function showGlobalBanner(type) {
  ['globalJoinBanner','globalPendingBanner','globalBannedBanner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  
  const bannerId = type === 'join' ? 'globalJoinBanner' : 
                   type === 'pending' ? 'globalPendingBanner' : 'globalBannedBanner';
  const banner = document.getElementById(bannerId);
  if (banner) {
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 3000);
  }
}

async function getCommunityStats(id, data) {
  try {
    const membersSnap = await getDocs(collection(db, "communities", id, "members"));
    let memberCount = 0, onlineCount = 0, userStatus = 'none';
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120000);
    let found = false;
    
    membersSnap.forEach(d => {
      const dta = d.data();
      if (['creator','admin','member'].includes(dta.role)) {
        memberCount++;
        
        if (dta.online === true && dta.lastSeen) {
          const lastSeen = new Date(dta.lastSeen);
          if (lastSeen > twoMinAgo) {
            onlineCount++;
          }
        }
      }
      if (d.id === currentUid) {
        found = true;
        userStatus = dta.role;
      }
    });
    
    if (!found) {
      // Check pending requests
      const reqSnap = await getDocs(query(
        collection(db, "communities", id, "requests"),
        where("userId", "==", currentUid),
        where("status", "==", "pending")
      ));
      if (!reqSnap.empty) userStatus = 'pending';
      else {
        // Check banned
        const bannedSnap = await getDoc(doc(db, "communities", id, "banned", currentUid));
        if (bannedSnap.exists()) userStatus = 'banned';
      }
    }
    return { memberCount, onlineCount, userStatus };
  } catch (error) {
    console.error("Error getting community stats:", error);
    return { memberCount: 0, onlineCount: 0, userStatus: 'none' };
  }
}

window.showCreateCommunityModal = function() {
  const modal = document.getElementById('createCommunityModal');
  if (modal) modal.classList.remove('hidden');
};

window.hideCreateCommunityModal = function() {
  const modal = document.getElementById('createCommunityModal');
  if (modal) {
    modal.classList.add('hidden');
    document.getElementById('communityName').value = '';
    document.getElementById('communityDescription').value = '';
  }
};

window.createCommunity = async function() {
  const name = document.getElementById('communityName').value.trim();
  const desc = document.getElementById('communityDescription').value.trim();
  const type = document.getElementById('communityType').value;
  
  if (!name) { 
    alert('Community name required'); 
    return; 
  }
  
  try {
    const ref = await addDoc(collection(db, "communities"), {
      name, 
      description: desc, 
      type,
      createdBy: currentUsername, 
      createdByUid: currentUid,
      createdAt: new Date().toISOString(),
      settings: { 
        allowMemberInvites: false, 
        requireApproval: type === 'private' 
      }
    });
    
    await setDoc(doc(db, "communities", ref.id, "members", currentUid), {
      username: currentUsername, 
      role: 'creator', 
      status: 'creator',
      joinedAt: new Date().toISOString(), 
      lastSeen: new Date().toISOString(), 
      online: true
    });
    
    alert('Community created!');
    hideCreateCommunityModal();
    window.location.href = `community-chat.html?communityId=${ref.id}&name=${encodeURIComponent(name)}`;
  } catch (error) {
    console.error('Create community error:', error);
    alert('Failed to create community: ' + error.message);
  }
};

window.joinCommunity = async function(id, type) {
  try {
    // Check if already a member
    const memberRef = doc(db, "communities", id, "members", currentUid);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      // Already a member, redirect to chat
      const commDoc = await getDoc(doc(db, "communities", id));
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(commDoc.data().name)}`;
      return;
    }
    
    // Check for existing pending request
    const pendingQ = query(
      collection(db, "communities", id, "requests"),
      where("userId", "==", currentUid),
      where("status", "==", "pending")
    );
    const pendingSnap = await getDocs(pendingQ);
    if (!pendingSnap.empty) {
      alert('You already have a pending request');
      return;
    }
    
    // Check if banned
    const bannedSnap = await getDoc(doc(db, "communities", id, "banned", currentUid));
    if (bannedSnap.exists()) {
      alert('You are banned from this community');
      return;
    }
    
    const commDoc = await getDoc(doc(db, "communities", id));
    if (!commDoc.exists()) {
      alert('Community not found');
      return;
    }
    
    const data = commDoc.data();
    if (data.type === 'public') {
      // Direct join
      await setDoc(memberRef, {
        username: currentUsername, 
        role: 'member', 
        status: 'member',
        joinedAt: new Date().toISOString(), 
        lastSeen: new Date().toISOString(), 
        online: true
      });
      alert('You joined the community!');
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(data.name)}`;
    } else {
      // Private - send request
      await addDoc(collection(db, "communities", id, "requests"), {
        userId: currentUid, 
        username: currentUsername,
        status: 'pending', 
        requestedAt: new Date().toISOString()
      });
      alert('Join request sent!');
    }
  } catch (error) {
    console.error('Join community error:', error);
    alert('Failed to join: ' + error.message);
  }
};

window.cancelRequest = async function(id) {
  try {
    const q = query(
      collection(db, "communities", id, "requests"),
      where("userId", "==", currentUid),
      where("status", "==", "pending")
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    alert('Request cancelled');
  } catch (error) {
    console.error('Cancel request error:', error);
    alert('Failed to cancel request');
  }
};

window.openCommunity = function(id, name) {
  window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(name)}`;
};

// Cleanup
window.addEventListener('beforeunload', () => {
  if (unsubscribeCommunities) unsubscribeCommunities();
});