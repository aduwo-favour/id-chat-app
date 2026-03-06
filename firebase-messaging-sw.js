// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyBEPEEQR63z_Dym50j3mS46ZyzPgMLbsi0",
  authDomain: "chat-messaging-abaa9.firebaseapp.com",
  projectId: "chat-messaging-abaa9",
  storageBucket: "chat-messaging-abaa9.appspot.com",
  appId: "1:625429860180:web:6719187a4eaa0be53d82c1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('Received background message: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png'  // Optional: add an icon
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
