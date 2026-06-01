// functions/index.js
//
// Sends FCM push notifications when a new message is written, so the
// recipient is notified even when their browser/tab is closed or in the
// background.
//
// Two triggers:
//   1. Private chats:  chats/{chatId}/messages/{messageId}
//   2. Communities:    communities/{communityId}/messages/{messageId}
//
// Notes:
//  - Messages are sent DATA-ONLY. The service worker builds the visible
//    notification from payload.data. This avoids the browser showing a
//    second, duplicate notification on web.
//  - Dead/expired tokens are pruned from the user document automatically.

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();

// FCM multicast accepts at most 500 tokens per call.
const MAX_TOKENS_PER_CALL = 500;

function truncate(text, n = 120) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

// Look up a single user document by their username field.
async function getUserByUsername(username) {
  const snap = await db
    .collection("users")
    .where("username", "==", username)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// Send a data-only message to a list of tokens, then remove any tokens
// that came back as permanently invalid from the given user document.
async function sendToTokens({ tokens, data, userRef }) {
  const valid = [...new Set((tokens || []).filter(Boolean))];
  if (valid.length === 0) return;

  // Every data value must be a string.
  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = v == null ? "" : String(v);
  }

  const deadTokens = [];

  for (let i = 0; i < valid.length; i += MAX_TOKENS_PER_CALL) {
    const batch = valid.slice(i, i + MAX_TOKENS_PER_CALL);
    const res = await getMessaging().sendEachForMulticast({
      tokens: batch,
      data: stringData,
      // High priority so it wakes the service worker reliably.
      webpush: {
        headers: { Urgency: "high" },
      },
    });

    res.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          deadTokens.push(batch[idx]);
        } else {
          console.warn("FCM send error:", code, r.error?.message);
        }
      }
    });
  }

  if (deadTokens.length && userRef) {
    await userRef
      .update({ fcmTokens: FieldValue.arrayRemove(...deadTokens) })
      .catch((e) => console.warn("Token cleanup failed:", e.message));
  }
}

// ---------------------------------------------------------------------------
// 1) PRIVATE CHAT MESSAGES
// ---------------------------------------------------------------------------
export const onPrivateMessage = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg || msg.deletedForEveryone) return;

    const senderUsername = msg.sender;
    const chatId = event.params.chatId;

    const chatSnap = await db.collection("chats").doc(chatId).get();
    if (!chatSnap.exists) return;
    const chat = chatSnap.data();

    // Don't notify on a blocked chat.
    if (chat.isBlocked) return;

    const participants = chat.participants || [];
    const recipientUsername = participants.find((p) => p !== senderUsername);
    if (!recipientUsername) return;

    const recipientDoc = await getUserByUsername(recipientUsername);
    if (!recipientDoc) return;
    const recipient = recipientDoc.data();

    // Respect the recipient's block list.
    if ((recipient.blockedUsers || []).includes(senderUsername)) return;

    const tokens = recipient.fcmTokens || [];
    if (tokens.length === 0) return;

    await sendToTokens({
      tokens,
      userRef: recipientDoc.ref,
      data: {
        type: "private",
        title: senderUsername,
        body: truncate(msg.text),
        chatId: chatId,
        sender: senderUsername,
        icon: "/icon-192.png",
      },
    });
  }
);

// ---------------------------------------------------------------------------
// 2) COMMUNITY MESSAGES
// ---------------------------------------------------------------------------
export const onCommunityMessage = onDocumentCreated(
  "communities/{communityId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg || msg.deletedForEveryone) return;

    const communityId = event.params.communityId;
    const senderId = msg.senderId; // member doc id (uid)
    const senderUsername = msg.sender;

    const commSnap = await db.collection("communities").doc(communityId).get();
    if (!commSnap.exists) return;
    const communityName = commSnap.data().name || "Community";

    // Collect member uids (exclude sender and banned members).
    const membersSnap = await db
      .collection("communities")
      .doc(communityId)
      .collection("members")
      .get();

    const recipientUids = [];
    membersSnap.forEach((m) => {
      const data = m.data();
      if (m.id === senderId) return;
      if (data.banned) return;
      recipientUids.push(m.id);
    });
    if (recipientUids.length === 0) return;

    // Fetch each recipient's user doc and gather tokens.
    const userRefs = recipientUids.map((uid) => db.collection("users").doc(uid));
    const userDocs = await db.getAll(...userRefs);

    const data = {
      type: "community",
      title: communityName,
      body: `${senderUsername}: ${truncate(msg.text, 100)}`,
      communityId: communityId,
      communityName: communityName,
      sender: senderUsername,
      icon: "/icon-192.png",
    };

    // Send per-user so token cleanup targets the right document.
    await Promise.all(
      userDocs.map((u) => {
        if (!u.exists) return null;
        const tokens = u.data().fcmTokens || [];
        if (tokens.length === 0) return null;
        return sendToTokens({ tokens, userRef: u.ref, data });
      })
    );
  }
);
