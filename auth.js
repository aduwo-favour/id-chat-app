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

/* ===============================
   SIGN UP
=================================*/
window.signup = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const userId = document.getElementById("userId").value.trim();

  if (!email || !password || !userId) {
    alert("Fill all fields");
    return;
  }

  try {
    // 🔎 Check if userId already exists
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      alert("User ID already taken");
      return;
    }

    // 🔐 Create auth account
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = userCredential.user;

    // 💾 Save user profile in Firestore
    await setDoc(doc(db, "users", user.uid), {
      userId: userId,
      email: email,
      createdAt: serverTimestamp()
    });

    alert("Signup successful!");
    window.location.href = "dashboard.html";

  } catch (error) {
    console.error(error);
    alert(error.message);
  }
};

/* ===============================
   LOGIN
=================================*/
window.login = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    alert("Fill all fields");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";

  } catch (error) {
    console.error(error);
    alert("Invalid email or password");
  }
};
