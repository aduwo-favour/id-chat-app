import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Helper: Generate email from userId (always lowercase)
function makeEmail(userId) {
  return (userId.trim().toLowerCase() + "@chatapp.com");
}

window.signup = async function () {
  const userIdInput = document.getElementById("userId");
  const passwordInput = document.getElementById("password");
  const signupBtn = document.querySelector("button[onclick='signup()']"); // adjust selector if needed

  if (!userIdInput || !passwordInput) {
    alert("Form elements not found");
    return;
  }

  const userId = userIdInput.value.trim();
  const password = passwordInput.value.trim();

  // Basic validation
  if (!userId) return alert("Please enter a User ID");
  if (!password) return alert("Please enter a password");
  if (userId.length < 3) return alert("User ID must be at least 3 characters");
  if (password.length < 6) return alert("Password must be at least 6 characters");
  if (userId.includes(" ")) return alert("User ID cannot contain spaces");

  // Disable button to prevent double-click
  if (signupBtn) signupBtn.disabled = true;

  try {
    // Check if userId already exists
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      alert("User ID already taken. Please choose another.");
      return;
    }

    const email = makeEmail(userId);

    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // Save user profile
    await setDoc(doc(db, "users", userCredential.user.uid), {
      userId: userId,
      email: email,
      createdAt: serverTimestamp(),
      online: true,
      lastSeen: serverTimestamp()
    });

    alert("Account created successfully!");
    window.location.href = "dashboard.html";

  } catch (error) {
    console.error("Signup Error:", error);

    let msg = "Signup failed. Please try again.";

    if (error.code === "auth/email-already-in-use") {
      msg = "This User ID is already taken.";
    } else if (error.code === "auth/invalid-email") {
      msg = "Invalid User ID format.";
    } else if (error.code === "auth/weak-password") {
      msg = "Password is too weak. Use at least 6 characters.";
    }

    alert(msg);
  } finally {
    if (signupBtn) signupBtn.disabled = false;
  }
};

window.login = async function () {
  const userIdInput = document.getElementById("userId");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.querySelector("button[onclick='login()']"); // adjust selector if needed

  if (!userIdInput || !passwordInput) {
    alert("Form elements not found");
    return;
  }

  const userId = userIdInput.value.trim();
  const password = passwordInput.value.trim();

  if (!userId) return alert("Please enter User ID");
  if (!password) return alert("Please enter password");

  if (loginBtn) loginBtn.disabled = true;

  try {
    const email = makeEmail(userId);

    await signInWithEmailAndPassword(auth, email, password);

    // Update last seen / online
    if (userRef) {
      await updateDoc(userRef, {
        online: true,
        lastSeen: serverTimestamp()
      }).catch(() => {});
    }

    window.location.href = "dashboard.html";

  } catch (error) {
    console.error("Login Error:", error);

    let msg = "Login failed. Please try again.";

    if (error.code === "auth/user-not-found" || error.code === "auth/invalid-credential") {
      msg = "User ID or password is incorrect.";
    } else if (error.code === "auth/wrong-password") {
      msg = "Incorrect password.";
    } else if (error.code === "auth/too-many-requests") {
      msg = "Too many failed attempts. Try again later.";
    }

    alert(msg);
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
};
