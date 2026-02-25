import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, query, onSnapshot, doc, getDoc, addDoc,
  setDoc, updateDoc, deleteDoc, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null, currentUid = null;

window.goBack = function() { window.location.href = 'dashboard.html'; };

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadCommunities();
  }
});

function loadCommunities() {
  const q = query(collection(db, "communities"), orderBy("createdAt", "desc"));
  onSnapshot(q, async (snap) => {
    const list = document.getElementById('communitiesList');
    if (snap.empty) {
      list.innerHTML = '<div class="no-communities">No communities yet. Create the first one!</div>';
      return;
    }
    let html = '';
    const promises = [];
    snap.forEach(doc => {
      promises.push(getCommunityStats(doc.id, doc.data()).then(stats => {
        const { memberCount, onlineCount, userStatus } = stats;
        let action = '', badge = '';
        if (['creator','admin','member'].includes(userStatus)) {
          action = `<button onclick="event.stopPropagation(); openCommunity('${doc.id}','${doc.data().name}')" class="join-btn entered">✓ Joined</button>`;
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
            <div class="community-avatar">${doc.data().name[0].toUpperCase()}</div>
            <div class="community-info">
              <div class="community-name">
                ${doc.data().name}
                ${doc.data().type === 'private' ? '<span class="private-badge">Private</span>' : '<span class="public-badge">Public</span>'}
                ${doc.data().createdBy === currentUsername ? '<span class="creator-badge">Creator</span>' : ''}
              </div>
              <div class="community-description">${doc.data().description || 'No description'}</div>
              <div class="community-stats"><span>👥 ${memberCount}</span> <span>🟢 ${onlineCount}</span></div>
              ${badge}
            </div>
            <div class="community-action">${action}</div>
          </div>
        `;
      }));
    });
    const cards = await Promise.all(promises);
    list.innerHTML = cards.join('');
  });
}

window.handleCommunityClick = function(id, name, status) {
  if (['creator','admin','member'].includes(status)) {
    window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(name)}`;
  } else {
    showGlobalBanner(status === 'pending' ? 'pending' : status === 'banned' ? 'banned' : 'join');
  }
};

function showGlobalBanner(type) {
  ['globalJoinBanner','globalPendingBanner','globalBannedBanner'].forEach(id => 
    document.getElementById(id).classList.add('hidden'));
  const banner = document.getElementById(type === 'join' ? 'globalJoinBanner' : 
    type === 'pending' ? 'globalPendingBanner' : 'globalBannedBanner');
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 3000);
}

async function getCommunityStats(id, data) {
  try {
    const membersSnap = await getDocs(collection(db, "communities", id, "members"));
    let memberCount = 0, onlineCount = 0, userStatus = 'none';
    const fiveMinAgo = new Date(Date.now() - 300000);
    let found = false;
    membersSnap.forEach(d => {
      const dta = d.data();
      if (['creator','admin','member'].includes(dta.role)) {
        memberCount++;
        if (dta.lastSeen && new Date(dta.lastSeen) > fiveMinAgo) onlineCount++;
      }
      if (d.id === currentUid) {
        found = true;
        userStatus = dta.role;
      }
    });
    if (!found) {
      const reqSnap = await getDocs(query(
        collection(db, "communities", id, "requests"),
        where("userId", "==", currentUid),
        where("status", "==", "pending")
      ));
      if (!reqSnap.empty) userStatus = 'pending';
      else {
        const bannedSnap = await getDoc(doc(db, "communities", id, "banned", currentUid));
        if (bannedSnap.exists()) userStatus = 'banned';
      }
    }
    return { memberCount, onlineCount, userStatus };
  } catch (error) {
    return { memberCount: 0, onlineCount: 0, userStatus: 'none' };
  }
}

window.showCreateCommunityModal = function() {
  document.getElementById('createCommunityModal').classList.remove('hidden');
};

window.hideCreateCommunityModal = function() {
  document.getElementById('createCommunityModal').classList.add('hidden');
  document.getElementById('communityName').value = '';
  document.getElementById('communityDescription').value = '';
};

window.createCommunity = async function() {
  const name = document.getElementById('communityName').value.trim();
  const desc = document.getElementById('communityDescription').value.trim();
  const type = document.getElementById('communityType').value;
  if (!name) { alert('Name required'); return; }
  try {
    const ref = await addDoc(collection(db, "communities"), {
      name, description: desc, type,
      createdBy: currentUsername, createdByUid: currentUid,
      createdAt: new Date().toISOString(),
      settings: { allowMemberInvites: false, requireApproval: type === 'private' }
    });
    await setDoc(doc(db, "communities", ref.id, "members", currentUid), {
      username: currentUsername, role: 'creator', status: 'creator',
      joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), online: true
    });
    alert('Community created!');
    hideCreateCommunityModal();
    window.location.href = `community-chat.html?communityId=${ref.id}&name=${encodeURIComponent(name)}`;
  } catch (error) {
    alert('Failed: ' + error.message);
  }
};

window.joinCommunity = async function(id, type) {
  try {
    const pendingQ = query(
      collection(db, "communities", id, "requests"),
      where("userId", "==", currentUid),
      where("status", "==", "pending")
    );
    if (!(await getDocs(pendingQ)).empty) {
      alert('You already have a pending request');
      return;
    }
    const memberRef = doc(db, "communities", id, "members", currentUid);
    if ((await getDoc(memberRef)).exists()) {
      const commDoc = await getDoc(doc(db, "communities", id));
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(commDoc.data().name)}`;
      return;
    }
    const commDoc = await getDoc(doc(db, "communities", id));
    const data = commDoc.data();
    if (data.type === 'public') {
      await setDoc(memberRef, {
        username: currentUsername, role: 'member', status: 'member',
        joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), online: true
      });
      alert('You joined!');
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(data.name)}`;
    } else {
      await addDoc(collection(db, "communities", id, "requests"), {
        userId: currentUid, username: currentUsername,
        status: 'pending', requestedAt: new Date().toISOString()
      });
      alert('Request sent!');
    }
  } catch (error) {
    alert('Failed: ' + error.message);
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
  } catch (error) {}
};

window.openCommunity = function(id, name) {
  window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(name)}`;
};
