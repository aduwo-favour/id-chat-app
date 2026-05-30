import { auth, db, requestNotificationPermission } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

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

// SECURITY: Restrict username characters to alphanumeric + underscore only.
// This prevents injection via the derived email and limits attack surface.
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

// SECURITY: Stronger password policy
function isValidPassword(password) {
  return password.length >= 8;
}

function makeEmail(username) {
  // Username is already validated to be alphanumeric+underscore, safe to use directly
  return username.toLowerCase() + "@temp.com";
}

// SECURITY: Show errors in the DOM instead of alert() to prevent UI-redressing
// and allow proper escaping. Never insert raw error messages from Firebase into innerHTML.
function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message; // textContent, not innerHTML — safe
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

  // SECURITY: Validate username format strictly
  if (!username) {
    showError('signupError', 'Please enter a username');
    return;
  }
  if (!isValidUsername(username)) {
    showError('signupError', 'Username must be 3–30 characters and contain only letters, numbers, or underscores');
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
      disabled: false
    });

    window.location.href = 'dashboard.html';
  } catch (error) {
    // SECURITY: Map error codes to safe, generic messages.
    // Never expose raw error.message from Firebase to the user — it can leak internals.
    if (error.code === 'auth/email-already-in-use') {
      showError('signupError', 'Username already taken');
    } else if (error.code === 'auth/weak-password') {
      showError('signupError', 'Password is too weak');
    } else if (error.code === 'auth/network-request-failed') {
      showError('signupError', 'Network error. Please try again.');
    } else {
      showError('signupError', 'Signup failed. Please try again.');
    }
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

  // SECURITY: Validate username before constructing the email address
  if (!isValidUsername(username)) {
    showError('loginError', 'Invalid username or password');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const email = makeEmail(username);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    // Check if account is banned or disabled before proceeding
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js");
    const userDoc = await getDoc(doc(db, "users", userCredential.user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.banned) {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js");
        await signOut(auth);
        showError('loginError', 'Your account has been suspended');
        return;
      }
      if (userData.disabled) {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js");
        await signOut(auth);
        showError('loginError', 'Your account has been disabled');
        return;
      }
    }

    try {
      const token = await requestNotificationPermission();
      if (token) {
        const userRef = doc(db, "users", userCredential.user.uid);
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(token),
          online: true,
          lastSeen: new Date().toISOString()
        });
      } else {
        await updateDoc(doc(db, "users", userCredential.user.uid), {
          online: true,
          lastSeen: new Date().toISOString()
        });
      }
    } catch (notifError) {
      // Non-fatal: still proceed
      await updateDoc(doc(db, "users", userCredential.user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      }).catch(() => {});
    }

    window.location.href = 'dashboard.html';
  } catch (error) {
    // SECURITY: Use a single generic message for all auth failures to prevent
    // username enumeration attacks.
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
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
};
