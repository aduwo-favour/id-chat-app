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
  return userId + "@favourjef.com";
}

window.signup = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!userId || !password) {
    alert("Fill all fields");
    return;
  }

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

  window.location.href = "dashboard.html";
};

window.login = async function () {
  const userId = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!userId || !password) {
    alert("Fill all fields");
    return;
  }

  const email = makeEmail(userId);

  await signInWithEmailAndPassword(auth, email, password);

  window.location.href = "dashboard.html";
};
