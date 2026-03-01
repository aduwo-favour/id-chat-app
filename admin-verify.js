import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  collection, getDocs, doc, updateDoc, getDoc, query, orderBy, where,
  deleteDoc, writeBatch, setDoc, addDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUsername = null;
let currentUid = null;
let isAdmin = false;

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const panelId = tab.dataset.tab + 'Panel';
    document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
    document.getElementById(panelId).classList.add('active');
    // Load data for the active tab
    if (tab.dataset.tab === 'users') loadUsers();
    if (tab.dataset.tab === 'chats') loadChats();
    if (tab.dataset.tab === 'communities') loadCommunities();
    if (tab.dataset.tab === 'settings') loadSettings();
  });
});

window.goBack = () => window.location.href = 'dashboard.html';

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    isAdmin = userDoc.data().isAdmin || false;
    if (isAdmin) {
      document.getElementById('adminStatus').innerHTML = '✅ Admin logged in';
      // Load default tab
      loadUsers();
      loadSettings(); // preload settings for toggles
    } else {
      document.getElementById('adminStatus').innerHTML = '⛔ Not authorized';
      setTimeout(() => window.location.href = 'dashboard.html', 2000);
    }
  }
});

// -------------------- USER MANAGEMENT --------------------
async function loadUsers(search = '') {
  const tbody = document.getElementById('usersList');
  tbody.innerHTML = '<tr><td colspan="6">Loading users...</td></tr>';
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("username"));
    const snap = await getDocs(q);
    let html = '';
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (search && !data.username.toLowerCase().includes(search.toLowerCase())) return;
      const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A';
      const lastSeen = data.lastSeen ? new Date(data.lastSeen).toLocaleString() : 'Never';
      const status = [];
      if (data.isAdmin) status.push('<span class="badge admin">Admin</span>');
      if (data.verified) status.push('<span class="badge verified">Verified</span>');
      if (data.banned) status.push('<span class="badge banned">Banned</span>');
      if (data.disabled) status.push('<span class="badge disabled">Disabled</span>');
      html += `
        <tr>
          <td>${data.username}</td>
          <td>${data.email || 'N/A'}</td>
          <td>${status.join(' ') || 'Active'}</td>
          <td>${created}</td>
          <td>${lastSeen}</td>
          <td>
            <button class="action-btn view small" onclick="viewUserActivity('${docSnap.id}')">📋 Log</button>
            <button class="action-btn edit small" onclick="toggleAdmin('${docSnap.id}', ${data.isAdmin})">${data.isAdmin ? 'Demote' : 'Make Admin'}</button>
            <button class="action-btn edit small" onclick="toggleVerified('${docSnap.id}', ${data.verified})">${data.verified ? 'Unverify' : 'Verify'}</button>
            <button class="action-btn ban small" onclick="toggleBan('${docSnap.id}', '${data.username}', ${data.banned})">${data.banned ? 'Unban' : 'Ban'}</button>
            <button class="action-btn delete small" onclick="deleteUser('${docSnap.id}', '${data.username}')">🗑️ Delete</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6">No users found</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
  }
}

window.toggleAdmin = async (userId, currentStatus) => {
  try {
    await updateDoc(doc(db, "users", userId), { isAdmin: !currentStatus });
    alert(`Admin status toggled`);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed: ' + error.message); }
};

window.toggleVerified = async (userId, currentStatus) => {
  try {
    await updateDoc(doc(db, "users", userId), {
      verified: !currentStatus,
      verifiedAt: !currentStatus ? new Date().toISOString() : null,
      verifiedBy: !currentStatus ? currentUsername : null
    });
    alert(`Verification toggled`);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed: ' + error.message); }
};

window.toggleBan = async (userId, username, currentBanned) => {
  try {
    await updateDoc(doc(db, "users", userId), {
      banned: !currentBanned,
      bannedAt: !currentBanned ? new Date().toISOString() : null,
      bannedBy: !currentBanned ? currentUsername : null
    });
    alert(`${username} ${currentBanned ? 'unbanned' : 'banned'}`);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed: ' + error.message); }
};

window.deleteUser = async (userId, username) => {
  if (!confirm(`Permanently delete user ${username}? This will remove all their data.`)) return;
  try {
    // Soft delete: mark as disabled and remove from auth? Not possible client-side.
    // Instead, we can mark disabled and optionally delete their messages/chats.
    await updateDoc(doc(db, "users", userId), { disabled: true, disabledAt: new Date().toISOString() });
    alert(`User ${username} disabled. (To fully delete, use Firebase Console.)`);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed: ' + error.message); }
};

window.viewUserActivity = async (userId) => {
  const modal = document.getElementById('userActivityModal');
  const content = document.getElementById('userActivityContent');
  content.innerHTML = 'Loading...';
  modal.classList.remove('hidden');
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    const data = userDoc.data();
    let html = `<p><strong>Username:</strong> ${data.username}</p>`;
    html += `<p><strong>Email:</strong> ${data.email || 'N/A'}</p>`;
    html += `<p><strong>Created:</strong> ${data.createdAt ? new Date(data.createdAt).toLocaleString() : 'N/A'}</p>`;
    html += `<p><strong>Last Seen:</strong> ${data.lastSeen ? new Date(data.lastSeen).toLocaleString() : 'N/A'}</p>`;
    html += `<p><strong>Online:</strong> ${data.online ? 'Yes' : 'No'}</p>`;
    html += `<p><strong>Verified:</strong> ${data.verified ? 'Yes' : 'No'}</p>`;
    html += `<p><strong>Admin:</strong> ${data.isAdmin ? 'Yes' : 'No'}</p>`;
    html += `<p><strong>Banned:</strong> ${data.banned ? 'Yes' : 'No'}</p>`;
    html += `<p><strong>Blocked Users:</strong> ${data.blockedUsers?.length || 0}</p>`;
    // Optionally show recent messages from this user across chats (could be heavy)
    content.innerHTML = html;
  } catch (error) {
    content.innerHTML = 'Error loading activity.';
  }
};

// -------------------- CHAT MODERATION --------------------
async function loadChats(search = '') {
  const tbody = document.getElementById('chatsList');
  tbody.innerHTML = '<tr><td colspan="5">Loading chats...</td></tr>';
  try {
    const chatsRef = collection(db, "chats");
    const snap = await getDocs(chatsRef);
    let html = '';
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const participants = data.participants?.join(', ') || 'N/A';
      if (search && !participants.toLowerCase().includes(search.toLowerCase())) continue;
      // Get message count
      const msgsSnap = await getDocs(collection(db, "chats", docSnap.id, "messages"));
      const msgCount = msgsSnap.size;
      html += `
        <tr>
          <td>${docSnap.id}</td>
          <td>${participants}</td>
          <td>${data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A'}</td>
          <td>${msgCount}</td>
          <td>
            <button class="action-btn view small" onclick="viewChatMessages('${docSnap.id}')">View</button>
            <button class="action-btn delete small" onclick="deleteChat('${docSnap.id}')">Delete</button>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = html || '<tr><td colspan="5">No chats found</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
  }
}

window.viewChatMessages = async (chatId) => {
  const modal = document.getElementById('chatMessagesModal');
  const content = document.getElementById('chatMessagesContent');
  content.innerHTML = 'Loading messages...';
  modal.classList.remove('hidden');
  // Store chatId for clear action
  window.currentChatId = chatId;
  try {
    const msgsRef = collection(db, "chats", chatId, "messages");
    const q = query(msgsRef, orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    let html = '<div class="message-list">';
    snap.forEach(d => {
      const data = d.data();
      const time = data.timestamp ? new Date(data.timestamp).toLocaleString() : '';
      const text = data.deletedForEveryone ? '<em>Deleted</em>' : data.text;
      html += `
        <div class="message-item">
          <div>
            <span class="message-sender">${data.sender || 'Unknown'}</span>
            <span class="message-time">${time}</span>
            <div>${text}</div>
          </div>
          <div>
            <button class="action-btn delete small" onclick="deleteMessage('${chatId}', '${d.id}')">Delete</button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    content.innerHTML = html || '<p>No messages</p>';
  } catch (error) {
    content.innerHTML = 'Error loading messages.';
  }
};

window.deleteMessage = async (chatId, msgId) => {
  if (!confirm('Delete this message?')) return;
  try {
    await updateDoc(doc(db, "chats", chatId, "messages", msgId), {
      deletedForEveryone: true,
      text: ''
    });
    alert('Message deleted');
    viewChatMessages(chatId); // refresh
  } catch (error) { alert('Failed'); }
};

window.clearChat = async () => {
  if (!window.currentChatId) return;
  if (!confirm('Delete ALL messages in this chat? This cannot be undone.')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "chats", window.currentChatId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    alert('Chat cleared');
    viewChatMessages(window.currentChatId);
  } catch (error) { alert('Failed'); }
};

window.deleteChat = async (chatId) => {
  if (!confirm('Delete this entire chat (including messages)?')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "chats", chatId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, "chats", chatId));
    await batch.commit();
    alert('Chat deleted');
    loadChats(document.getElementById('chatSearch').value);
  } catch (error) { alert('Failed'); }
};

// -------------------- COMMUNITY MANAGEMENT --------------------
async function loadCommunities(search = '') {
  const tbody = document.getElementById('communitiesList');
  tbody.innerHTML = '<tr><td colspan="6">Loading communities...</td></tr>';
  try {
    const commRef = collection(db, "communities");
    const snap = await getDocs(commRef);
    let html = '';
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (search && !data.name.toLowerCase().includes(search.toLowerCase())) continue;
      const membersSnap = await getDocs(collection(db, "communities", docSnap.id, "members"));
      const memberCount = membersSnap.size;
      html += `
        <tr>
          <td>${data.name}</td>
          <td>${data.type || 'public'}</td>
          <td>${data.createdBy || 'N/A'}</td>
          <td>${memberCount}</td>
          <td>${data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A'}</td>
          <td>
            <button class="action-btn view small" onclick="manageCommunity('${docSnap.id}')">Manage</button>
            <button class="action-btn delete small" onclick="deleteCommunity('${docSnap.id}')">Delete</button>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = html || '<tr><td colspan="6">No communities found</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
  }
}

window.manageCommunity = async (communityId) => {
  const modal = document.getElementById('communityManageModal');
  const content = document.getElementById('communityManageContent');
  content.innerHTML = 'Loading...';
  modal.classList.remove('hidden');
  try {
    const commDoc = await getDoc(doc(db, "communities", communityId));
    const data = commDoc.data();
    let html = `
      <h4>${data.name}</h4>
      <p><strong>Description:</strong> ${data.description || 'N/A'}</p>
      <p><strong>Type:</strong> ${data.type}</p>
      <p><strong>Created by:</strong> ${data.createdBy}</p>
      <hr>
      <h5>Members</h5>
      <div id="communityMembersList"></div>
      <hr>
      <h5>Pending Requests</h5>
      <div id="communityRequestsList"></div>
    `;
    content.innerHTML = html;

    // Load members
    const membersSnap = await getDocs(collection(db, "communities", communityId, "members"));
    let membersHtml = '<ul>';
    membersSnap.forEach(m => {
      const mdata = m.data();
      membersHtml += `<li>${mdata.username} (${mdata.role})</li>`;
    });
    membersHtml += '</ul>';
    document.getElementById('communityMembersList').innerHTML = membersHtml;

    // Load requests
    const reqSnap = await getDocs(collection(db, "communities", communityId, "requests"));
    let reqHtml = '';
    reqSnap.forEach(r => {
      const rdata = r.data();
      reqHtml += `
        <div>
          ${rdata.username} - requested ${new Date(rdata.requestedAt).toLocaleString()}
          <button onclick="approveRequest('${communityId}', '${r.id}', '${rdata.userId}', '${rdata.username}')">Approve</button>
          <button onclick="declineRequest('${communityId}', '${r.id}')">Decline</button>
        </div>
      `;
    });
    document.getElementById('communityRequestsList').innerHTML = reqHtml || 'No pending requests';
  } catch (error) {
    content.innerHTML = 'Error loading community.';
  }
};

window.approveRequest = async (communityId, reqId, userId, username) => {
  try {
    await setDoc(doc(db, "communities", communityId, "members", userId), {
      username, role: 'member', joinedAt: new Date().toISOString(), online: true
    });
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    alert('Request approved');
    manageCommunity(communityId);
  } catch (error) { alert('Failed'); }
};

window.declineRequest = async (communityId, reqId) => {
  try {
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    alert('Request declined');
    manageCommunity(communityId);
  } catch (error) { alert('Failed'); }
};

window.deleteCommunity = async (communityId) => {
  if (!confirm('Delete this community and all its data?')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "communities", communityId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    const members = await getDocs(collection(db, "communities", communityId, "members"));
    members.forEach(d => batch.delete(d.ref));
    const requests = await getDocs(collection(db, "communities", communityId, "requests"));
    requests.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, "communities", communityId));
    await batch.commit();
    alert('Community deleted');
    loadCommunities(document.getElementById('communitySearch').value);
  } catch (error) { alert('Failed'); }
};

// -------------------- SETTINGS --------------------
const SETTINGS_DOC = 'globalSettings'; // single document in a 'settings' collection

async function loadSettings() {
  try {
    const settingsRef = doc(db, "settings", SETTINGS_DOC);
    const snap = await getDoc(settingsRef);
    let settings = {};
    if (snap.exists()) settings = snap.data();
    document.getElementById('toggleFileUploads').checked = settings.fileUploads ?? true;
    document.getElementById('toggleReactions').checked = settings.reactions ?? true;
    document.getElementById('toggleCommunityCreation').checked = settings.communityCreation ?? true;
    document.getElementById('toggleAutoFlag').checked = settings.autoFlag ?? false;
    document.getElementById('toggleApproval').checked = settings.requireApproval ?? false;
  } catch (error) {
    console.error('Failed to load settings', error);
  }
}

window.updateSetting = async (key, value) => {
  try {
    const settingsRef = doc(db, "settings", SETTINGS_DOC);
    await setDoc(settingsRef, { [key]: value }, { merge: true });
    alert('Setting updated');
  } catch (error) {
    alert('Failed to update setting');
  }
};

// -------------------- SEARCH HANDLERS --------------------
document.getElementById('userSearch').addEventListener('input', (e) => loadUsers(e.target.value));
document.getElementById('chatSearch').addEventListener('input', (e) => loadChats(e.target.value));
document.getElementById('communitySearch').addEventListener('input', (e) => loadCommunities(e.target.value));

// -------------------- UTILS --------------------
window.hideModal = (id) => document.getElementById(id).classList.add('hidden');

// Make functions global for onclick handlers
window.loadUsers = loadUsers;
window.loadChats = loadChats;
window.loadCommunities = loadCommunities;
window.loadSettings = loadSettings;
