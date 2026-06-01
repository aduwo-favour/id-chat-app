// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js');

// Initialize Firebase in service worker
firebase.initializeApp({
  apiKey: "AIzaSyBEPEEQR63z_Dym50j3mS46ZyzPgMLbsi0",
  authDomain: "chat-messaging-abaa9.firebaseapp.com",
  projectId: "chat-messaging-abaa9",
  storageBucket: "chat-messaging-abaa9.appspot.com",
  messagingSenderId: "625429860180",
  appId: "1:625429860180:web:6719187a4eaa0be53d82c1"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message: ', payload);

  // Messages are sent data-only (see functions/index.js) so the browser
  // never auto-displays a second notification. Read from data first, then
  // fall back to a notification payload for backwards compatibility.
  const d = payload.data || {};
  const notificationTitle = d.title || payload.notification?.title || 'New Message';
  const notificationBody = d.body || payload.notification?.body || 'You have a new message';
  const notificationIcon = d.icon || payload.notification?.icon || '/icon-192.png';
  
  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: '/badge.png',
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'Open Chat' },
      { action: 'close', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200],
    requireInteraction: true,
    silent: false
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  // Default action (click or 'open')
  const data = event.notification.data || {};
  let urlToOpen = '/';
  if (data.type === 'community' && data.communityId) {
    urlToOpen = `/community-chat.html?communityId=${data.communityId}` +
      (data.communityName ? `&name=${encodeURIComponent(data.communityName)}` : '');
  } else if (data.chatId) {
    urlToOpen = `/chat.html?chatId=${data.chatId}&user=${encodeURIComponent(data.sender || '')}`;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window/tab open with the target URL
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // If not, open a new window/tab
        return clients.openWindow(urlToOpen);
      })
  );
});

// Handle service worker installation
self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  return self.clients.claim();
});
