import { auth, db } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Tab switching
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

// Generate email from username
function makeEmail(username) {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '') + "@temp.com";
}

// Handle Signup
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
    console.log("Creating user with email:", email);

    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Auth user created:", userCredential.user.uid);
    
    // Create user profile in Firestore
    await setDoc(doc(db, "users", userCredential.user.uid), {
      username: username,
      email: email,
      createdAt: new Date().toISOString(),
      online: true,
      lastSeen: new Date().toISOString()
    });
    
    console.log("Firestore document created");

    alert('Account created successfully!');
    window.location.href = 'dashboard.html';

  } catch (error) {
    console.error('Signup error:', error);
    
    if (error.code === 'auth/email-already-in-use') {
      alert('Username already taken. Please choose another.');
    } else if (error.code === 'auth/weak-password') {
      alert('Password too weak. Use at least 6 characters.');
    } else {
      alert('Signup failed: ' + error.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
};

// Handle Login
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
    console.log("Logging in with email:", email);
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log("Login successful:", userCredential.user.uid);

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
