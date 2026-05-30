import { auth, db, watchBanStatus } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  collection, query, onSnapshot, doc, getDoc, addDoc,
  setDoc, updateDoc, deleteDoc, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null, currentUid = null;
let unsubscribeCommunities = null;

// Cache user status per community to avoid re-fetching on every snapshot
const userStatusCache = new Map();

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

window.goBack = function() {
  if (unsubscribeCommunities) unsubscribeCommunities();
  window.location.href = 'dashboard.html';
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;

  watchBanStatus(user.uid, async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentUsername = userDoc.data().username;
      loadCommunities();
    } else {
      document.getElementById('communitiesList').innerHTML = '<div class="error-message">User data not found</div>';
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

      const promises = [];

      snap.forEach(communityDoc => {
        const data = communityDoc.data();
        promises.push(
          getCommunityStats(communityDoc.id, data)
            .then(stats => {
              const { memberCount, onlineCount, userStatus } = stats;
              let action = '', badge = '';

              if (['creator', 'admin', 'member'].includes(userStatus)) {
                action = `<button onclick="event.stopPropagation(); openCommunity('${communityDoc.id}','${escapeHtml(data.name)}')" class="join-btn entered">✓ Joined</button>`;
              } else if (userStatus === 'pending') {
                badge = '<span class="pending-badge">Request Pending</span>';
                action = `<button onclick="event.stopPropagation(); cancelRequest('${communityDoc.id}')" class="cancel-btn">Cancel</button>`;
              } else if (userStatus === 'banned') {
                badge = '<span class="banned-badge">Banned</span>';
                action = `<button class="join-btn disabled" disabled>Banned</button>`;
              } else {
                action = `<button onclick="event.stopPropagation(); joinCommunity('${communityDoc.id}','${data.type}')" class="join-btn">Request to Join</button>`;
              }

              const card = document.createElement('div');
              card.className = 'community-card';
              card.setAttribute('onclick', `handleCommunityClick('${communityDoc.id}','${escapeHtml(data.name)}','${userStatus}')`);
              card.innerHTML = `
                <div class="community-avatar">${escapeHtml((data.name || '?')[0].toUpperCase())}</div>
                <div class="community-info">
                  <div class="community-name">
                    ${escapeHtml(data.name || '')}
                    ${data.type === 'private' ? '<span class="private-badge">Private</span>' : '<span class="public-badge">Public</span>'}
                    ${data.createdBy === currentUsername ? '<span class="creator-badge">Creator</span>' : ''}
                  </div>
                  <div class="community-description">${escapeHtml(data.description || 'No description')}</div>
                  <div class="community-stats"><span>👥 ${memberCount}</span> <span>🟢 ${onlineCount} online</span></div>
                  ${badge}
                </div>
                <div class="community-action">${action}</div>
              `;
              return card;
            })
            .catch(err => {
              console.error('Error processing community:', err);
              return null;
            })
        );
      });

      const cards = await Promise.all(promises);
      list.innerHTML = '';
      cards.forEach(card => { if (card) list.appendChild(card); });
      if (!list.hasChildNodes()) {
        list.innerHTML = '<div class="error-message">No communities available</div>';
      }

    }, (error) => {
      console.error('Communities listener error:', error);
      list.innerHTML = '<div class="error-message">Failed to load communities</div>';
    });
  } catch (error) {
    console.error('Error setting up communities listener:', error);
    list.innerHTML = '<div class="error-message">Error initializing communities</div>';
  }
}

async function getCommunityStats(id, data) {
  try {
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120000);

    // Fetch member list and user's own status in parallel
    const membersPromise = getDocs(collection(db, "communities", id, "members"));

    let userStatus = userStatusCache.get(id);
    let userStatusPromise;

    if (userStatus === undefined) {
      userStatusPromise = getDoc(doc(db, "communities", id, "members", currentUid))
        .then(async (snap) => {
          if (snap.exists()) return snap.data().role || 'member';
          const reqSnap = await getDocs(query(
            collection(db, "communities", id, "requests"),
            where("userId", "==", currentUid),
            where("status", "==", "pending")
          ));
          if (!reqSnap.empty) return 'pending';
          const bannedSnap = await getDoc(doc(db, "communities", id, "banned", currentUid));
          return bannedSnap.exists() ? 'banned' : 'none';
        });
    } else {
      userStatusPromise = Promise.resolve(userStatus);
    }

    const [membersSnap, resolvedStatus] = await Promise.all([membersPromise, userStatusPromise]);
    userStatusCache.set(id, resolvedStatus);

    let memberCount = 0, onlineCount = 0;
    membersSnap.forEach(d => {
      const dta = d.data();
      if (['creator', 'admin', 'member'].includes(dta.role)) {
        memberCount++;
        if (dta.online === true && dta.lastSeen && new Date(dta.lastSeen) > twoMinAgo) onlineCount++;
      }
    });

    return { memberCount, onlineCount, userStatus: resolvedStatus };
  } catch (error) {
    console.error("Error getting community stats:", error);
    return { memberCount: 0, onlineCount: 0, userStatus: 'none' };
  }
}

window.handleCommunityClick = function(id, name, status) {
  if (['creator', 'admin', 'member'].includes(status)) {
    window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(name)}`;
  } else {
    showGlobalBanner(status === 'pending' ? 'pending' : status === 'banned' ? 'banned' : 'join');
  }
};

function showGlobalBanner(type) {
  ['globalJoinBanner', 'globalPendingBanner', 'globalBannedBanner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const bannerId = type === 'join' ? 'globalJoinBanner' : type === 'pending' ? 'globalPendingBanner' : 'globalBannedBanner';
  const banner = document.getElementById(bannerId);
  if (banner) {
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 3000);
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

  if (!name) { alert('Community name required'); return; }

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

    userStatusCache.set(ref.id, 'creator');
    hideCreateCommunityModal();
    window.location.href = `community-chat.html?communityId=${ref.id}&name=${encodeURIComponent(name)}`;
  } catch (error) {
    console.error('Create community error:', error);
    alert('Failed to create community');
  }
};

window.joinCommunity = async function(id, type) {
  try {
    const memberRef = doc(db, "communities", id, "members", currentUid);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      const commDoc = await getDoc(doc(db, "communities", id));
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(commDoc.data().name)}`;
      return;
    }

    const pendingSnap = await getDocs(query(
      collection(db, "communities", id, "requests"),
      where("userId", "==", currentUid),
      where("status", "==", "pending")
    ));
    if (!pendingSnap.empty) { alert('You already have a pending request'); return; }

    const bannedSnap = await getDoc(doc(db, "communities", id, "banned", currentUid));
    if (bannedSnap.exists()) { alert('You are banned from this community'); return; }

    const commDoc = await getDoc(doc(db, "communities", id));
    if (!commDoc.exists()) { alert('Community not found'); return; }

    const data = commDoc.data();

    if (data.type === 'public') {
      await setDoc(memberRef, {
        username: currentUsername, role: 'member', status: 'member',
        joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), online: true
      });
      userStatusCache.set(id, 'member');
      window.location.href = `community-chat.html?communityId=${id}&name=${encodeURIComponent(data.name)}`;
    } else {
      await addDoc(collection(db, "communities", id, "requests"), {
        userId: currentUid, username: currentUsername,
        status: 'pending', requestedAt: new Date().toISOString()
      });
      userStatusCache.set(id, 'pending');

      // Update DOM immediately — no refresh needed
      const allBtns = document.querySelectorAll('.join-btn');
      let btn = null;
      allBtns.forEach(b => {
        if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(id)) btn = b;
      });
      if (btn) {
        const card = btn.closest('.community-card');
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.setAttribute('onclick', `event.stopPropagation(); cancelRequest('${id}')`);
        btn.replaceWith(cancelBtn);
        const info = card && card.querySelector('.community-info');
        if (info && !info.querySelector('.pending-badge')) {
          const badge = document.createElement('span');
          badge.className = 'pending-badge';
          badge.textContent = 'Request Pending';
          info.appendChild(badge);
        }
        if (card) card.setAttribute('onclick', `handleCommunityClick('${id}','${escapeHtml(data.name)}','pending')`);
      }
    }
  } catch (error) {
    console.error('Join community error:', error);
    alert('Failed to join community');
  }
};

window.cancelRequest = async function(id) {
  userStatusCache.delete(id);
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

window.addEventListener('beforeunload', () => {
  if (unsubscribeCommunities) unsubscribeCommunities();
});
