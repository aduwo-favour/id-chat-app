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

function makeEmail(userId) {
  return userId + "@chatapp.com";
}

window.signup = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!userId || !password) {
    alert("Please fill all fields");
    return;
  }

  try {
    // Check if userId already exists
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      alert("User ID already taken");
      return;
    }

    const email = makeEmail(userId);

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await setDoc(doc(db, "users", userCredential.user.uid), {
      userId: userId,
      createdAt: serverTimestamp()
    });

    alert("Account created successfully!");
    window.location.href = "dashboard.html";

  } catch (error) {
    console.error(error);

    if (error.code === "auth/weak-password") {
      alert("Password should be at least 6 characters");
    } else {
      alert("Signup failed. Try again.");
    }
  }
};

window.login = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!userId || !password) {
    alert("Please fill all fields");
    return;
  }

  try {
    const email = makeEmail(userId);

    await signInWithEmailAndPassword(auth, email, password);

    window.location.href = "dashboard.html";

  } catch (error) {
    console.error(error);

    if (error.code === "auth/user-not-found") {
      alert("User ID does not exist");
    } else if (error.code === "auth/wrong-password") {
      alert("Incorrect password");
    } else if (error.code === "auth/invalid-credential") {
      alert("Incorrect User ID or Password");
    } else {
      alert("Login failed. Please try again.");
    }
  }
};
