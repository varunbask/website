# Google Calendar setup (owner)

The portal's Google Calendar sync needs a Google Cloud project that you own. Do these steps once, in this order, before tutors and students connect. Nothing here can be done by the portal for you.

## 1. Google Cloud project

1. Open https://console.cloud.google.com and sign in with the Google account that will own the project. The live project, `vp-education-group-portal`, is owned by bvarun2004@gmail.com.
2. Create a project named **VP Education Group portal**.
3. Go to **APIs and services**, then **Library**. Enable the **Google Calendar API**.

## 2. OAuth consent screen

In **APIs and services**, go to **OAuth consent screen** (shown as **Google Auth Platform** in newer consoles).

- **User type:** External.
- **App name:** VP Education Group.
- **User support email and developer contact:** the business address.
- **App domain:**
  - Home page: `https://www.varunbaskaran.com`
  - Privacy policy: `https://www.varunbaskaran.com/privacy.html`. Google requires one before verification.
- **Authorized domain:** `varunbaskaran.com`.
- **Scopes:** add exactly these:
  - `openid`
  - `.../auth/userinfo.email`
  - `https://www.googleapis.com/auth/calendar.app.created` lets the portal create its own calendar and manage the events on it.
  - `https://www.googleapis.com/auth/calendar.events.readonly` lets the portal show a tutor's personal events in their own portal calendar. They are only read, never stored.
- **Test users:** while the app is in Testing, add the Google address of every tutor and student who will connect.

## 3. OAuth client

In **APIs and services**, go to **Credentials**, then **Create credentials**, then **OAuth client ID**.

- **Application type:** Web application.
- **Name:** Portal.
- **Authorized redirect URI:** `https://www.varunbaskaran.com/api/google/callback`.

Copy the **Client ID** and **Client secret**. The secret is a password: keep it out of chat, email and the repository.

## 4. Vercel environment variables

In Vercel, open the **website** project, then **Settings**, then **Environment Variables**. Add these for Production:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID |
| `GOOGLE_CLIENT_SECRET` | the Client secret (mark it Sensitive) |
| `GOOGLE_TOKEN_KEY` | a new random key: run `openssl rand -base64 32` and paste the output (mark it Sensitive) |
| `SITE_URL` | `https://www.varunbaskaran.com` |

**Do not change `GOOGLE_TOKEN_KEY` after tutors connect.** The portal encrypts their Google access with it, so changing it means every tutor has to reconnect.

Until these are set, the Google parts of the portal show "Google Calendar is not set up yet." and everything else works as before.

## 5. Database changes, before merging

Apply the pending migrations to the live project in this order, then merge the pull request:

1. `20261001200000_sessions.sql`
2. `20261001200100_lesson_materials.sql`
3. `20261002120000_google_calendar.sql`

From the `client-portal` worktree:

```bash
npx supabase db push
```

Then run the live database access tests. They create and remove a few throwaway accounts:

```bash
npm run test:rls
```

## 6. Testing, then going live

- **While the app is in Testing:**
  - only the listed test users can connect;
  - Google stops the connection every 7 days, so tutors have to reconnect weekly.
- **To go live:**
  - Go to **OAuth consent screen**, then **Publish app**.
  - Then either run unverified or submit the app for verification.
- **Running unverified:**
  - People see a "Google hasn't verified this app" screen and click **Advanced** to continue.
  - Google allows at most 100 users that way.
- **Verification:** Google reviews the privacy policy and a short screen recording of the connect flow, which can take a few weeks. After that the warning goes away.

## How it works, briefly

- **Tutors:** each tutor turns on **Google Calendar** on the portal calendar. The portal makes a **VP Education sessions** calendar in their Google account and keeps it in step with their portal sessions, both ways:
  - A move or cancellation in either place shows up in the other.
  - An event the tutor creates in that calendar with a student invited becomes a portal session.
- **Students:** they click **Get Google Calendar invites**, and their tutors' sessions arrive as Google invites that update themselves.
- **Who can change sessions:** students can only view. Parents are not invited, and keep seeing sessions in the portal.
- **Keeping up to date:** Google tells the portal about changes within seconds. A daily job renews that link and catches anything missed, and opening the calendar also syncs.
