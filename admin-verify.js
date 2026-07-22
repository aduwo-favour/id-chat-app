import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  collection, getDocs, doc, updateDoc, getDoc, query, orderBy, where,
  deleteDoc, writeBatch, setDoc, addDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Server-side hard-delete (Auth account + user doc) via the notifier admin endpoint.
const ADMIN_DELETE_ENDPOINT = "https://id-notifier.vercel.app/api/admin-delete-user";
async function hardDeleteAuthUser(targetUid) {
  const idToken = await auth.currentUser.getIdToken();
  const r = await fetch(ADMIN_DELETE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, targetUid }),
  });
  if (!r.ok) {
    const msg = await r.json().catch(() => ({}));
    throw new Error(msg.error || "Server delete failed");
  }
}


let currentUsername = null;
let currentUid = null;
let isAdmin = false;

// SECURITY: Central escapeHtml used everywhere instead of raw string interpolation
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const panelId = tab.dataset.tab + 'Panel';
    document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
    document.getElementById(panelId)?.classList.add('active');
    if (tab.dataset.tab === 'users') loadUsers();
    if (tab.dataset.tab === 'chats') loadChats();
    if (tab.dataset.tab === 'communities') loadCommunities();
    if (tab.dataset.tab === 'settings') loadSettings();
  });
});

window.goBack = () => { window.location.href = 'dashboard.html'; };

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUid = user.uid;
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    currentUsername = userDoc.data().username;
    isAdmin = userDoc.data().isAdmin || false;
    const statusEl = document.getElementById('adminStatus');
    if (isAdmin) {
      if (statusEl) statusEl.textContent = '✅ Admin logged in';
      loadUsers();
      loadSettings();

      // LIVE: keep admin lists in sync without manual refresh (e.g. new signups)
      const activeTab = () => document.querySelector('.admin-tab.active')?.dataset.tab;
      onSnapshot(collection(db, "users"), () => { if (activeTab() === 'users') loadUsers(document.getElementById('userSearch')?.value || ''); });
      onSnapshot(collection(db, "chats"), () => { if (activeTab() === 'chats') loadChats(document.getElementById('chatSearch')?.value || ''); });
      onSnapshot(collection(db, "communities"), () => { if (activeTab() === 'communities') loadCommunities(document.getElementById('communitySearch')?.value || ''); });

      // Watch for real-time demotion — if another admin removes this user's
      // admin rights while the panel is open, redirect them immediately
      onSnapshot(doc(db, "users", user.uid), (snap) => {
        if (!snap.exists()) { window.location.href = 'dashboard.html'; return; }
        const data = snap.data();
        if (!data.isAdmin || data.banned || data.disabled || data.deleted) {
          alert('Your admin access has been revoked. Redirecting.');
          window.location.href = 'dashboard.html';
        }
      });
    } else {
      if (statusEl) statusEl.textContent = '⛔ Not authorized';
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 2000);
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
    tbody.innerHTML = '';

    let found = false;
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.deleted) return; // skip permanently deleted users
      if (search && !data.username?.toLowerCase().includes(search.toLowerCase())) return;
      found = true;

      const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A';
      const lastSeen = data.lastSeen ? new Date(data.lastSeen).toLocaleString() : 'Never';

      const tr = document.createElement('tr');

      // SECURITY: Build table cells with textContent/DOM APIs, not string interpolation,
      // so usernames containing HTML/script cannot inject into the admin panel.
      const cells = [
        data.username || '',
        data.email || 'N/A',
        '', // status badges (built below)
        created,
        lastSeen,
        '' // actions (built below)
      ];

      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i === 2) {
          // Status badges - these are fixed strings, safe as innerHTML
          if (data.isAdmin)    td.insertAdjacentHTML('beforeend', '<span class="badge admin">Admin</span> ');
          if (data.verified)   td.insertAdjacentHTML('beforeend', '<span class="badge verified">Verified</span> ');
          if (data.banned)     td.insertAdjacentHTML('beforeend', '<span class="badge banned">Banned</span> ');
          if (data.disabled)   td.insertAdjacentHTML('beforeend', '<span class="badge disabled">Disabled</span> ');
          if (data.approved === false) td.insertAdjacentHTML('beforeend', '<span class="badge banned">Pending</span> ');
          if (!td.textContent.trim()) td.textContent = 'Active';
        } else if (i === 5) {
          // Action buttons — wire up via addEventListener, not onclick="..." with user data
          const logBtn = makeBtn('📋 Log', 'action-btn view small', () => viewUserActivity(docSnap.id));
          const adminBtn = makeBtn(data.isAdmin ? 'Demote' : 'Make Admin', 'action-btn edit small', () => toggleAdmin(docSnap.id, data.isAdmin));
          const verifyBtn = makeBtn(data.verified ? 'Unverify' : 'Verify', 'action-btn edit small', () => toggleVerified(docSnap.id, data.verified));
          const banBtn = makeBtn(data.banned ? 'Unban' : 'Ban', 'action-btn ban small', () => toggleBan(docSnap.id, data.username, data.banned));
          const delBtn = makeBtn('🗑️ Delete', 'action-btn delete small', () => deleteUser(docSnap.id, data.username));
          const btns = [logBtn, adminBtn, verifyBtn, banBtn, delBtn];
          if (data.approved === false) {
            btns.unshift(makeBtn('❌ Decline', 'action-btn ban small', () => declineUser(docSnap.id, data.username)));
            btns.unshift(makeBtn('✅ Approve', 'action-btn edit small', () => approveUser(docSnap.id)));
          }
          btns.forEach(b => td.appendChild(b));
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    if (!found) {
      tbody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
    }
  } catch (error) {
    // SECURITY: Never expose raw error.message in the DOM
    tbody.innerHTML = '<tr><td colspan="6">Error loading users. Check console.</td></tr>';
    console.error('loadUsers error:', error);
  }
}

function makeBtn(label, className, handler) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

window.toggleAdmin = async (userId, currentStatus) => {
  try {
    await updateDoc(doc(db, "users", userId), { isAdmin: !currentStatus });

    // If the current logged-in admin just demoted themselves, redirect away
    if (userId === currentUid && currentStatus === true) {
      alert('You have been demoted. Redirecting to dashboard.');
      window.location.href = 'dashboard.html';
      return;
    }

    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed to update admin status'); }
};

window.toggleVerified = async (userId, currentStatus) => {
  try {
    await updateDoc(doc(db, "users", userId), {
      verified: !currentStatus,
      verifiedAt: !currentStatus ? new Date().toISOString() : null,
      verifiedBy: !currentStatus ? currentUsername : null
    });
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed to update verification'); }
};

window.toggleBan = async (userId, username, currentBanned) => {
  try {
    await updateDoc(doc(db, "users", userId), {
      banned: !currentBanned,
      bannedAt: !currentBanned ? new Date().toISOString() : null,
      bannedBy: !currentBanned ? currentUsername : null
    });
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed to update ban status'); }
};

window.deleteUser = async (userId, username) => {
  if (!confirm(`Permanently DELETE user "${username}"? This will wipe their account and all their chats. Cannot be undone.`)) return;
  try {
    const batch = writeBatch(db);

    // Delete all chats they are a participant in
    const chatsSnap = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", username)));
    for (const chatDoc of chatsSnap.docs) {
      const msgsSnap = await getDocs(collection(db, "chats", chatDoc.id, "messages"));
      msgsSnap.forEach(m => batch.delete(m.ref));
      batch.delete(chatDoc.ref);
    }

    // Delete any pending requests sent to or from them
    const reqSentSnap = await getDocs(query(collection(db, "requests"), where("from", "==", username)));
    reqSentSnap.forEach(r => batch.delete(r.ref));
    const reqReceivedSnap = await getDocs(query(collection(db, "requests"), where("to", "==", username)));
    reqReceivedSnap.forEach(r => batch.delete(r.ref));

    await batch.commit();

    // Hard-delete the Auth account + user doc via the server (Admin SDK).
    try {
      await hardDeleteAuthUser(userId);
    } catch (e) {
      // Fallback: if the server endpoint is unavailable, mark as deleted so they
      // still vanish from the list and can't log in.
      console.error('hard delete failed, falling back to soft delete:', e);
      await updateDoc(doc(db, "users", userId), {
        deleted: true, banned: true, disabled: true,
        username: '[deleted]', email: '[deleted]', fcmTokens: [], blockedUsers: []
      });
      await deleteDoc(doc(db, "users", userId, "private", "meta")).catch(() => {});
      alert(`User "${username}" removed (Auth account could not be deleted — check the notifier).`);
      loadUsers(document.getElementById('userSearch').value);
      return;
    }

    alert(`User "${username}" has been permanently deleted (account + data).`);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) {
    alert('Failed to delete user. Check console.');
    console.error('deleteUser error:', error);
  }
};

window.viewUserActivity = async (userId) => {
  const modal = document.getElementById('userActivityModal');
  const content = document.getElementById('userActivityContent');
  content.textContent = 'Loading...';
  modal.classList.remove('hidden');
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    const data = userDoc.data();
    content.innerHTML = '';

    // SECURITY: Build DOM nodes with textContent, not string interpolation
    const fields = [
      ['Username', data.username],
      ['Email', data.email || 'N/A'],
      ['Created', data.createdAt ? new Date(data.createdAt).toLocaleString() : 'N/A'],
      ['Last Seen', data.lastSeen ? new Date(data.lastSeen).toLocaleString() : 'N/A'],
      ['Online', data.online ? 'Yes' : 'No'],
      ['Verified', data.verified ? 'Yes' : 'No'],
      ['Admin', data.isAdmin ? 'Yes' : 'No'],
      ['Banned', data.banned ? 'Yes' : 'No'],
      ['Blocked Users', data.blockedUsers?.length || 0],
    ];

    fields.forEach(([label, value]) => {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = label + ': ';
      p.appendChild(strong);
      p.appendChild(document.createTextNode(String(value)));
      content.appendChild(p);
    });
  } catch (error) {
    content.textContent = 'Error loading activity.';
  }
};

// -------------------- CHAT MODERATION --------------------
async function loadChats(search = '') {
  const tbody = document.getElementById('chatsList');
  tbody.innerHTML = '<tr><td colspan="5">Loading chats...</td></tr>';
  try {
    const chatsRef = collection(db, "chats");
    const snap = await getDocs(chatsRef);
    tbody.innerHTML = '';
    let found = false;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const participants = data.participants?.join(', ') || 'N/A';
      if (search && !participants.toLowerCase().includes(search.toLowerCase())) continue;
      found = true;

      const msgsSnap = await getDocs(collection(db, "chats", docSnap.id, "messages"));

      const tr = document.createElement('tr');
      [
        docSnap.id,
        participants,
        data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A',
        String(msgsSnap.size),
      ].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      actionsTd.appendChild(makeBtn('View', 'action-btn view small', () => viewChatMessages(docSnap.id)));
      actionsTd.appendChild(makeBtn('Delete', 'action-btn delete small', () => deleteChat(docSnap.id)));
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    }

    if (!found) tbody.innerHTML = '<tr><td colspan="5">No chats found</td></tr>';
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5">Error loading chats. Check console.</td></tr>';
    console.error('loadChats error:', error);
  }
}

window.viewChatMessages = async (chatId) => {
  const modal = document.getElementById('chatMessagesModal');
  const content = document.getElementById('chatMessagesContent');
  content.textContent = 'Loading messages...';
  modal.classList.remove('hidden');
  window.currentChatId = chatId;
  try {
    const msgsRef = collection(db, "chats", chatId, "messages");
    const q = query(msgsRef, orderBy("timestamp", "desc"));
    const snap = await getDocs(q);

    content.innerHTML = '';
    const listDiv = document.createElement('div');
    listDiv.className = 'message-list';

    snap.forEach(d => {
      const data = d.data();
      const time = data.timestamp ? new Date(data.timestamp).toLocaleString() : '';

      const itemDiv = document.createElement('div');
      itemDiv.className = 'message-item';

      const infoDiv = document.createElement('div');
      const senderSpan = document.createElement('span');
      senderSpan.className = 'message-sender';
      senderSpan.textContent = data.sender || 'Unknown';   // textContent — safe

      const timeSpan = document.createElement('span');
      timeSpan.className = 'message-time';
      timeSpan.textContent = time;

      const textDiv = document.createElement('div');
      if (data.deletedForEveryone) {
        const em = document.createElement('em');
        em.textContent = 'Deleted';
        textDiv.appendChild(em);
      } else {
        textDiv.textContent = data.text || '';              // textContent — safe
      }

      infoDiv.appendChild(senderSpan);
      infoDiv.appendChild(timeSpan);
      infoDiv.appendChild(textDiv);

      const actDiv = document.createElement('div');
      actDiv.appendChild(makeBtn('Delete', 'action-btn delete small', () => deleteMessage(chatId, d.id)));

      itemDiv.appendChild(infoDiv);
      itemDiv.appendChild(actDiv);
      listDiv.appendChild(itemDiv);
    });

    content.appendChild(listDiv.childElementCount ? listDiv : Object.assign(document.createElement('p'), { textContent: 'No messages' }));
  } catch (error) {
    content.textContent = 'Error loading messages.';
  }
};

window.deleteMessage = async (chatId, msgId) => {
  if (!confirm('Delete this message?')) return;
  try {
    await updateDoc(doc(db, "chats", chatId, "messages", msgId), {
      deletedForEveryone: true,
      text: ''
    });
    viewChatMessages(chatId);
  } catch (error) { alert('Failed to delete message'); }
};

window.clearChat = async () => {
  if (!window.currentChatId) return;
  if (!confirm('Delete ALL messages in this chat? This cannot be undone.')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "chats", window.currentChatId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    viewChatMessages(window.currentChatId);
  } catch (error) { alert('Failed to clear chat'); }
};

window.deleteChat = async (chatId) => {
  if (!confirm('Delete this entire chat (including messages)?')) return;
  try {
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "chats", chatId, "messages"));
    msgs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, "chats", chatId));
    await batch.commit();
    loadChats(document.getElementById('chatSearch').value);
  } catch (error) { alert('Failed to delete chat'); }
};

// -------------------- COMMUNITY MANAGEMENT --------------------
async function loadCommunities(search = '') {
  const tbody = document.getElementById('communitiesList');
  tbody.innerHTML = '<tr><td colspan="6">Loading communities...</td></tr>';
  try {
    const commRef = collection(db, "communities");
    const snap = await getDocs(commRef);
    tbody.innerHTML = '';
    let found = false;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (search && !data.name?.toLowerCase().includes(search.toLowerCase())) continue;
      found = true;

      const membersSnap = await getDocs(collection(db, "communities", docSnap.id, "members"));

      const tr = document.createElement('tr');
      [
        data.name || '',
        data.type || 'public',
        data.createdBy || 'N/A',
        String(membersSnap.size),
        data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A',
      ].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      actionsTd.appendChild(makeBtn('Manage', 'action-btn view small', () => manageCommunity(docSnap.id)));
      actionsTd.appendChild(makeBtn('Delete', 'action-btn delete small', () => deleteCommunity(docSnap.id)));
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    }

    if (!found) tbody.innerHTML = '<tr><td colspan="6">No communities found</td></tr>';
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6">Error loading communities. Check console.</td></tr>';
    console.error('loadCommunities error:', error);
  }
}

window.manageCommunity = async (communityId) => {
  const modal = document.getElementById('communityManageModal');
  const content = document.getElementById('communityManageContent');
  content.textContent = 'Loading...';
  modal.classList.remove('hidden');
  try {
    const commDoc = await getDoc(doc(db, "communities", communityId));
    const data = commDoc.data();

    // SECURITY: Build with DOM APIs, not innerHTML with user data
    content.innerHTML = '';

    const h4 = document.createElement('h4');
    h4.textContent = data.name || '';
    content.appendChild(h4);

    [
      ['Description', data.description || 'N/A'],
      ['Type', data.type],
      ['Created by', data.createdBy],
    ].forEach(([label, val]) => {
      const p = document.createElement('p');
      p.innerHTML = `<strong>${escapeHtml(label)}:</strong> `;
      p.appendChild(document.createTextNode(val || ''));
      content.appendChild(p);
    });

    content.insertAdjacentHTML('beforeend', '<hr><h5>Members</h5>');
    const membersDiv = document.createElement('div');
    membersDiv.id = 'communityMembersList';
    content.appendChild(membersDiv);

    content.insertAdjacentHTML('beforeend', '<hr><h5>Pending Requests</h5>');
    const reqDiv = document.createElement('div');
    reqDiv.id = 'communityRequestsList';
    content.appendChild(reqDiv);

    const membersSnap = await getDocs(collection(db, "communities", communityId, "members"));
    const ul = document.createElement('ul');
    membersSnap.forEach(m => {
      const li = document.createElement('li');
      li.textContent = `${m.data().username} (${m.data().role})`;
      ul.appendChild(li);
    });
    membersDiv.appendChild(ul);

    const reqSnap = await getDocs(collection(db, "communities", communityId, "requests"));
    if (reqSnap.empty) {
      reqDiv.textContent = 'No pending requests';
    } else {
      reqSnap.forEach(r => {
        const rdata = r.data();
        const div = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = `${rdata.username} - requested ${new Date(rdata.requestedAt).toLocaleString()} `;
        div.appendChild(span);
        div.appendChild(makeBtn('Approve', '', () => approveRequest(communityId, r.id, rdata.userId, rdata.username)));
        div.appendChild(makeBtn('Decline', '', () => declineRequest(communityId, r.id)));
        reqDiv.appendChild(div);
      });
    }
  } catch (error) {
    console.error('manageCommunity load error:', error);
    content.textContent = 'Error loading community: ' + (error && error.message ? error.message : 'unknown error');
  }
};

window.approveRequest = async (communityId, reqId, userId, username) => {
  try {
    await setDoc(doc(db, "communities", communityId, "members", userId), {
      username, role: 'member', joinedAt: new Date().toISOString(), online: true
    });
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    manageCommunity(communityId);
  } catch (error) { alert('Failed to approve request'); }
};

window.declineRequest = async (communityId, reqId) => {
  try {
    await deleteDoc(doc(db, "communities", communityId, "requests", reqId));
    manageCommunity(communityId);
  } catch (error) { alert('Failed to decline request'); }
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
    loadCommunities(document.getElementById('communitySearch').value);
  } catch (error) { alert('Failed to delete community'); }
};

// -------------------- SETTINGS --------------------
const SETTINGS_DOC = 'globalSettings';

async function loadSettings() {
  try {
    const settingsRef = doc(db, "settings", SETTINGS_DOC);
    const snap = await getDoc(settingsRef);
    const settings = snap.exists() ? snap.data() : {};
    document.getElementById('toggleFileUploads').checked = settings.fileUploads ?? true;
    document.getElementById('toggleVoiceNotes').checked = settings.voiceNotes ?? true;
    document.getElementById('toggleReactions').checked = settings.reactions ?? true;
    document.getElementById('toggleCommunityCreation').checked = settings.communityCreation ?? true;
    document.getElementById('toggleAutoFlag').checked = settings.autoFlag ?? false;
    document.getElementById('toggleApproval').checked = settings.requireApproval ?? false;
    document.getElementById('toggleSignups').checked = settings.signupsEnabled ?? true;
    document.getElementById('toggleMaintenance').checked = settings.maintenanceMode ?? false;
    document.getElementById('inputMaxLength').value = settings.maxMessageLength ?? 2000;
    document.getElementById('inputAnnouncement').value = settings.announcement ?? '';
    document.getElementById('inputBannedWords').value = Array.isArray(settings.bannedWords) ? settings.bannedWords.join(', ') : '';
  } catch (error) {
    console.error('Failed to load settings', error);
  }
}

// Save announcement (text) and banned words (comma/newline list -> array)
window.saveAnnouncement = async () => {
  const val = document.getElementById('inputAnnouncement').value.trim();
  await window.updateSetting('announcement', val);
  alert('Announcement saved');
};
window.saveMaxLength = async () => {
  const n = parseInt(document.getElementById('inputMaxLength').value, 10);
  await window.updateSetting('maxMessageLength', (!n || n < 1) ? 2000 : n);
  alert('Max length saved');
};
window.saveBannedWords = async () => {
  const words = document.getElementById('inputBannedWords').value
    .split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
  await window.updateSetting('bannedWords', words);
  alert('Banned words saved');
};

window.updateSetting = async (key, value) => {
  try {
    const settingsRef = doc(db, "settings", SETTINGS_DOC);
    await setDoc(settingsRef, { [key]: value }, { merge: true });
  } catch (error) {
    alert('Failed to update setting');
  }
};

// Clean up the backlog: hard-delete (Auth + doc) every user already marked deleted.
window.purgeDeletedUsers = async () => {
  if (!confirm('Permanently delete ALL already-removed accounts from Firebase (Auth + data)? This cannot be undone.')) return;
  try {
    const snap = await getDocs(query(collection(db, "users"), where("deleted", "==", true)));
    if (snap.empty) { alert('No deleted accounts to purge.'); return; }
    let ok = 0, fail = 0;
    for (const d of snap.docs) {
      try { await hardDeleteAuthUser(d.id); ok++; }
      catch (e) { console.error('purge failed for', d.id, e); fail++; }
    }
    alert(`Purge complete. Removed: ${ok}. Failed: ${fail}.` + (fail ? ' Check the notifier is deployed.' : ''));
    loadUsers(document.getElementById('userSearch').value);
  } catch (e) {
    console.error('purge error:', e);
    alert('Purge failed. Check console.');
  }
};

window.declineUser = async (userId, username) => {
  if (!confirm(`Decline and permanently delete the registration for "${username}"? This removes their account from Firebase.`)) return;
  try {
    await hardDeleteAuthUser(userId);
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) {
    console.error('decline hard-delete failed:', error);
    // Fallback to soft delete so they at least disappear and can't log in
    try {
      await updateDoc(doc(db, "users", userId), { deleted: true });
      loadUsers(document.getElementById('userSearch').value);
      alert('Declined (Auth account could not be deleted — check the notifier).');
    } catch (e2) { alert('Failed to decline user'); }
  }
};

window.approveUser = async (userId) => {
  try {
    await updateDoc(doc(db, "users", userId), { approved: true });
    loadUsers(document.getElementById('userSearch').value);
  } catch (error) { alert('Failed to approve user'); }
};

// -------------------- SEARCH HANDLERS --------------------
document.getElementById('userSearch').addEventListener('input', (e) => loadUsers(e.target.value));
document.getElementById('chatSearch').addEventListener('input', (e) => loadChats(e.target.value));
document.getElementById('communitySearch').addEventListener('input', (e) => loadCommunities(e.target.value));

// -------------------- UTILS --------------------
window.hideModal = (id) => document.getElementById(id)?.classList.add('hidden');

window.loadUsers = loadUsers;
window.loadChats = loadChats;
window.loadCommunities = loadCommunities;
window.loadSettings = loadSettings;
