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

function makeEmail(username) {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '') + "@temp.com";
}

window.handleSignup = async function() {
  const username = document.getElementById('signupUserId').value.trim();
  const password = document.getElementById('signupPassword').value.trim();
  const btn = document.getElementById('signupBtn');

  if (!username || !password) {
    alert('Please fill all fields');
    return;
  }
  if (username.length < 3) {
    alert('Username must be at least 3 characters');
    return;
  }
  if (password.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const email = makeEmail(username);
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Request notification permission and get token
    let fcmTokens = [];
    try {
      const token = await requestNotificationPermission();
      if (token) fcmTokens = [token];
    } catch (notifError) {
      console.log('Notification permission not granted:', notifError);
    }
    
    await setDoc(doc(db, "users", userCredential.user.uid), {
      username: username,
      email: email,
      createdAt: new Date().toISOString(),
      online: true,
      lastSeen: new Date().toISOString(),
      blockedUsers: [],
      verified: false,
      isAdmin: false,
      fcmTokens: fcmTokens // Store FCM tokens for push notifications
    });

    alert('Account created successfully!');
    window.location.href = 'dashboard.html';
  } catch (error) {
    console.error('Signup error:', error);
    if (error.code === 'auth/email-already-in-use') {
      alert('Username already taken');
    } else if (error.code === 'auth/weak-password') {
      alert('Password too weak');
    } else {
      alert('Signup failed: ' + error.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
};

window.handleLogin = async function() {
  const username = document.getElementById('loginUserId').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const btn = document.getElementById('loginBtn');

  if (!username || !password) {
    alert('Please fill all fields');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const email = makeEmail(username);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    // Request notification permission and update token
    try {
      const token = await requestNotificationPermission();
      if (token) {
        const userRef = doc(db, "users", userCredential.user.uid);
        await updateDoc(userRef, {
          online: true,
          lastSeen: new Date().toISOString(),
          fcmTokens: arrayUnion(token) // Add new token without duplicates
        });
      } else {
        // Still update online status even if no token
        await updateDoc(doc(db, "users", userCredential.user.uid), {
          online: true,
          lastSeen: new Date().toISOString()
        });
      }
    } catch (notifError) {
      console.log('Notification setup failed:', notifError);
      // Still proceed with login even if notifications fail
      await updateDoc(doc(db, "users", userCredential.user.uid), {
        online: true,
        lastSeen: new Date().toISOString()
      });
    }
    
    window.location.href = 'dashboard.html';
  } catch (error) {
    console.error('Login error:', error);
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-login-credentials') {
      alert('Invalid username or password');
    } else {
      alert('Login failed: ' + error.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
};
