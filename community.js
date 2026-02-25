import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, 
  query, 
  onSnapshot,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  getDocs,
  serverTimestamp,
  orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;

// Go back
window.goBack = function() {
  window.location.href = 'dashboard.html';
};

// Check authentication
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUid = user.uid;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    loadCommunities();
  }
});

// Load all communities
function loadCommunities() {
  const communitiesQuery = query(
    collection(db, "communities"),
    orderBy("createdAt", "desc")
  );

  onSnapshot(communitiesQuery, async (snapshot) => {
    const communitiesList = document.getElementById('communitiesList');
    
    if (snapshot.empty) {
      communitiesList.innerHTML = '<div class="no-communities">No communities yet. Create the first one!</div>';
      return;
    }

    let communitiesHTML = '';
    const communityPromises = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const promise = getCommunityStats(doc.id, data).then(stats => {
        const memberCount = stats.memberCount;
        const onlineCount = stats.onlineCount;
        const userStatus = stats.userStatus; // 'member', 'pending', 'banned', 'none'
        
        let actionButton = '';
        let statusBadge = '';
        
        if (userStatus === 'member') {
          actionButton = `<button onclick="joinCommunity('${doc.id}')" class="join-btn entered">âœ“ Joined</button>`;
        } else if (userStatus === 'pending') {
          statusBadge = '<span class="pending-badge">Request Pending</span>';
          actionButton = `<button onclick="cancelRequest('${doc.id}')" class="cancel-btn">Cancel</button>`;
        } else if (userStatus === 'banned') {
          statusBadge = '<span class="banned-badge">Banned</span>';
          actionButton = '';
        } else {
          actionButton = `<button onclick="joinCommunity('${doc.id}')" class="join-btn">Request to Join</button>`;
        }

        return `
          <div class="community-card" onclick="openCommunity('${doc.id}', '${data.name}')">
            <div class="community-avatar">${data.name[0].toUpperCase()}</div>
            <div class="community-info">
              <div class="community-name">
                ${data.name}
                ${data.createdBy === currentUsername ? '<span class="creator-badge">Creator</span>' : ''}
              </div>
              <div class="community-description">${data.description || 'No description'}</div>
              <div class="community-stats">
                <span>ðŸ‘¥ ${memberCount} members</span>
                <span class="online-dot">ðŸŸ¢ ${onlineCount} online</span>
              </div>
              ${statusBadge}
            </div>
            <div class="community-action" onclick="event.stopPropagation()">
              ${actionButton}
            </div>
          </div>
        `;
      });
      
      communityPromises.push(promise);
    });

    const communityCards = await Promise.all(communityPromises);
    communitiesList.innerHTML = communityCards.join('');
  });
}

// Get community stats
async function getCommunityStats(communityId, communityData) {
  try {
    // Get all members
    const membersRef = collection(db, "communities", communityId, "members");
    const membersSnap = await getDocs(membersRef);
    
    let memberCount = 0;
    let onlineCount = 0;
    let userStatus = 'none';
    
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    
    membersSnap.forEach(doc => {
      const data = doc.data();
      if (data.status === 'member' || data.status === 'admin' || data.status === 'creator') {
        memberCount++;
        
        // Check if online (last seen within 5 minutes)
        if (data.lastSeen) {
          const lastSeen = new Date(data.lastSeen);
          if (lastSeen > fiveMinutesAgo) {
            onlineCount++;
          }
        }
      }
      
      // Check current user's status
      if (doc.id === currentUid) {
        userStatus = data.status || 'pending';
      }
    });
    
    return { memberCount, onlineCount, userStatus };
  } catch (error) {
    console.error("Error getting community stats:", error);
    return { memberCount: 0, onlineCount: 0, userStatus: 'none' };
  }
}

// Show create community modal
window.showCreateCommunityModal = function() {
  document.getElementById('createCommunityModal').classList.remove('hidden');
};

// Hide create community modal
window.hideCreateCommunityModal = function() {
  document.getElementById('createCommunityModal').classList.add('hidden');
  document.getElementById('communityName').value = '';
  document.getElementById('communityDescription').value = '';
};

// Create community
window.createCommunity = async function() {
  const name = document.getElementById('communityName').value.trim();
  const description = document.getElementById('communityDescription').value.trim();
  const type = document.getElementById('communityType').value;

  if (!name) {
    alert('Community name is required');
    return;
  }

  try {
    console.log("Creating community:", name);
    
    // Create community document
    const communityRef = await addDoc(collection(db, "communities"), {
      name: name,
      description: description,
      type: type,
      createdBy: currentUsername,
      createdByUid: currentUid,
      createdAt: new Date().toISOString(),
      settings: {
        allowMemberInvites: false,
        requireApproval: type === 'private'
      }
    });

    console.log("Community created with ID:", communityRef.id);

    // Add creator as member with creator role
    await setDoc(doc(db, "communities", communityRef.id, "members", currentUid), {
      username: currentUsername,
      role: 'creator',
      status: 'creator',
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      online: true
    });

    console.log("Creator added to members with role: creator");

    alert('Community created successfully!');
    hideCreateCommunityModal();
    
    // Open the community
    window.location.href = `community-chat.html?communityId=${communityRef.id}&name=${encodeURIComponent(name)}`;

  } catch (error) {
    console.error("Create community error:", error);
    alert('Failed to create community: ' + error.message);
  }
};

// Join/Request to join community
window.joinCommunity = async function(communityId) {
  try {
    // Check if already has pending request
    const requestsRef = collection(db, "communities", communityId, "requests");
    const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
    const existingSnap = await getDocs(q);
    
    if (!existingSnap.empty) {
      alert('You already have a pending request');
      return;
    }

    // Get community details
    const communityDoc = await getDoc(doc(db, "communities", communityId));
    const communityData = communityDoc.data();

    if (communityData.type === 'public') {
      // Auto-approve for public communities
      await setDoc(doc(db, "communities", communityId, "members", currentUid), {
        username: currentUsername,
        role: 'member',
        status: 'member',
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        online: true
      });
      
      alert('You joined the community!');
      window.location.href = `community-chat.html?communityId=${communityId}&name=${encodeURIComponent(communityData.name)}`;
      
    } else {
      // Create request for private communities
      await addDoc(collection(db, "communities", communityId, "requests"), {
        userId: currentUid,
        username: currentUsername,
        status: 'pending',
        requestedAt: new Date().toISOString()
      });
      
      alert('Join request sent!');
    }

  } catch (error) {
    console.error("Join community error:", error);
    alert('Failed to join community');
  }
};

// Cancel join request
window.cancelRequest = async function(communityId) {
  try {
    const requestsRef = collection(db, "communities", communityId, "requests");
    const q = query(requestsRef, where("userId", "==", currentUid), where("status", "==", "pending"));
    const snapshot = await getDocs(q);
    
    snapshot.forEach(async (doc) => {
      await deleteDoc(doc.ref);
    });
    
    alert('Request cancelled');
    
  } catch (error) {
    console.error("Cancel request error:", error);
  }
};

// Open community
window.openCommunity = function(communityId, name) {
  window.location.href = `community-chat.html?communityId=${communityId}&name=${encodeURIComponent(name)}`;
};
      
