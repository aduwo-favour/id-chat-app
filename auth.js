import { auth, db } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

window.signUp = async function() {
  const userId = document.getElementById("userId").value;
  const password = document.getElementById("password").value;

  if (!userId || !password) {
    alert("Fill all fields");
    return;
  }

  const email = userId + "@chatapp.com";

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    await setDoc(doc(db, "users", userCredential.user.uid), {
      userId: userId,
      createdAt: new Date()
    });

    alert("Account created!");
    window.location.href = "dashboard.html";

  } catch (error) {
    alert(error.message);
  }
}

window.login = async function() {
  const userId = document.getElementById("userId").value;
  const password = document.getElementById("password").value;

  const email = userId + "@chatapp.com";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (error) {
    alert("Invalid ID or password");
  }
}