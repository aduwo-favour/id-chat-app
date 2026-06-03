# Chat Notifier (free push, no Blaze plan)

Sends FCM push notifications without Firebase Cloud Functions / Blaze.
Deploy this small folder as its own Vercel project.

## What's in here
- `api/notify.js` — the serverless endpoint that sends the push
- `package.json` — declares the `firebase-admin` dependency

## One-time setup

1. **Get a service-account key**
   Firebase Console → ⚙ Project Settings → **Service accounts** →
   **Generate new private key**. A `.json` file downloads. Open it and copy
   ALL of its contents.

2. **Deploy to Vercel**
   - Put this `notifier-vercel` folder in its own GitHub repo (or drag-drop in Vercel).
   - In Vercel, import it as a new project. No build settings needed.
   - Project → **Settings → Environment Variables** → add:
       - Name:  `FIREBASE_SERVICE_ACCOUNT`
       - Value: paste the ENTIRE contents of the service-account JSON file
   - Deploy.

3. **Copy your URL**
   After deploy you'll get something like `https://chat-notifier-xyz.vercel.app`.
   Your endpoint is that URL + `/api/notify`.

4. **Point the app at it**
   In your chat app, open `push-notify.js` and set:
   ```js
   const NOTIFY_ENDPOINT = "https://chat-notifier-xyz.vercel.app/api/notify";
   ```

That's it. The service-account key lives only in Vercel's server environment —
it is never sent to the browser.

## Security notes
- The endpoint verifies the caller's Firebase ID token, so only signed-in
  users of YOUR app can trigger sends.
- For private chats it checks the caller is a participant; for communities it
  checks the caller is a member. This stops abuse.
- You can restrict CORS by replacing `*` in `api/notify.js` with your app's
  exact origin (e.g. `https://id-chat-app.vercel.app`).
