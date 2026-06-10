import { auth, db, requestNotificationPermission } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getGlobalSettings } from "./app-settings.js";

window.switchTab = function(tab) {
  document.getElementById('loginTab').classList.remove('active');
  document.getElementById('signupTab').classList.remove('active');
  document.getElementById('loginForm').classList.remove('active');
  document.getElementById('signupForm').classList.remove('active');

  if (tab === 'login') {
    document.getElementById('loginTab').classList.add('active');
    document.getElementById('loginForm').classList.add('active');
  } else {
    document.getElementById('signupTab').classList.add('active');
    document.getElementById('signupForm').classList.add('active');
  }
};

// SECURITY: Only allow safe username characters to prevent injection
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function isValidPassword(password) {
  return password.length >= 8;
}

function makeEmail(username) {
  return username.toLowerCase() + "@temp.com";
}

// SECURITY: Show errors in DOM using textContent (safe), not alert() with raw Firebase messages
function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function clearError(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

window.handleSignup = async function() {
  clearError('signupError');
  const username = document.getElementById('signupUserId').value.trim();
  const password = document.getElementById('signupPassword').value;
  const btn = document.getElementById('signupBtn');

  if (!username) {
    showError('signupError', 'Please enter a username');
    return;
  }
  if (!isValidUsername(username)) {
    showError('signupError', 'Username must be 3–30 characters: letters, numbers, or underscores only');
    return;
  }
  if (!isValidPassword(password)) {
    showError('signupError', 'Password must be at least 8 characters');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const email = makeEmail(username);
    const gSettings = await getGlobalSettings();
    if (gSettings.signupsEnabled === false) {
      showError('signupError', 'Registration is currently disabled by the admin.');
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    let fcmTokens = [];
    try {
      const token = await requestNotificationPermission();
      if (token) fcmTokens = [token];
    } catch (notifError) {
      // Non-fatal: notifications are optional
    }

    await setDoc(doc(db, "users", userCredential.user.uid), {
      username: username,
      email: email,
      createdAt: new Date().toISOString(),
      online: true,
      lastSeen: new Date().toISOString(),
      blockedUsers: [],
      fcmTokens: fcmTokens,
      verified: false,
      isAdmin: false,
      banned: false,
      disabled: false,
      approved: gSettings.requireApproval ? false : true
    });

    window.location.href = 'dashboard.html';
  } catch (error) {
    // SECURITY: Map error codes to safe messages — never expose raw error.message
    if (error.code === 'auth/email-already-in-use') {
      showError('signupError', 'Username already taken');
    } else if (error.code === 'auth/weak-password') {
      showError('signupError', 'Password is too weak');
    } else if (error.code === 'auth/network-request-failed') {
      showError('signupError', 'Network error. Please try again.');
    } else {
      showError('signupError', 'Signup failed. Please try again.');
    }
    console.error('Signup error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
};

window.handleLogin = async function() {
  clearError('loginError');
  const username = document.getElementById('loginUserId').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');

  if (!username || !password) {
    showError('loginError', 'Please fill all fields');
    return;
  }

  // SECURITY: Validate format before building the email address
  if (!isValidUsername(username)) {
    showError('loginError', 'Invalid username or password');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const email = makeEmail(username);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    // Check banned/disabled before allowing access
    const userDoc = await getDoc(doc(db, "users", userCredential.user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.banned) {
        await signOut(auth);
        showError('loginError', 'Your account has been suspended');
        return;
      }
      if (userData.disabled) {
        await signOut(auth);
        showError('loginError', 'Your account has been disabled');
        return;
      }
      if (userData.approved === false) {
        await signOut(auth);
        showError('loginError', 'Your account is pending admin approval.');
        return;
      }
      const lSettings = await getGlobalSettings();
      if (lSettings.maintenanceMode === true && !userData.isAdmin) {
        await signOut(auth);
        showError('loginError', 'The app is under maintenance. Please try again later.');
        return;
      }
    }

    try {
      const token = await requestNotificationPermission();
      const updateData = { online: true, lastSeen: new Date().toISOString() };
      if (token) updateData.fcmTokens = arrayUnion(token);
      await updateDoc(doc(db, "users", userCredential.user.uid), updateData);
    } catch (notifError) {
      // Non-fatal
      await updateDoc(doc(db, "users", userCredential.user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    }

    window.location.href = 'dashboard.html';
  } catch (error) {
    // SECURITY: Single generic message for all auth failures prevents username enumeration
    if (
      error.code === 'auth/user-not-found' ||
      error.code === 'auth/wrong-password' ||
      error.code === 'auth/invalid-login-credentials' ||
      error.code === 'auth/invalid-credential'
    ) {
      showError('loginError', 'Invalid username or password');
    } else if (error.code === 'auth/too-many-requests') {
      showError('loginError', 'Too many attempts. Please wait before trying again.');
    } else if (error.code === 'auth/network-request-failed') {
      showError('loginError', 'Network error. Please try again.');
    } else {
      showError('loginError', 'Login failed. Please try again.');
    }
    console.error('Login error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
};
