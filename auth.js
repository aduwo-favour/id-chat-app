import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

/* ============================= */
/*  AUTO REDIRECT IF LOGGED IN   */
/* ============================= */

onAuthStateChanged(auth, (user) => {
  if (user && window.location.pathname.includes("index.html")) {
    window.location.href = "dashboard.html";
  }
});

/* ============================= */
/*          SIGN UP              */
/* ============================= */

window.signUp = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value;

  if (!userId || !password) {
    alert("Please fill all fields");
    return;
  }

  if (password.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  const email = userId + "@chatapp.com";

  try {
    await setPersistence(auth, browserLocalPersistence);

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await setDoc(doc(db, "users", userCredential.user.uid), {
      userId: userId,
      createdAt: new Date()
    });

    window.location.href = "dashboard.html";

  } catch (error) {
    alert(error.message);
  }
};

/* ============================= */
/*            LOGIN              */
/* ============================= */

window.login = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value;

  if (!userId || !password) {
    alert("Please fill all fields");
    return;
  }

  const email = userId + "@chatapp.com";

  try {
    await setPersistence(auth, browserLocalPersistence);

    await signInWithEmailAndPassword(auth, email, password);

    window.location.href = "dashboard.html";

  } catch (error) {
    alert("Invalid ID or password");
  }
};
