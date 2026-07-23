# Google Meet auto-creation — Setup Guide

The Schedule Interview modal currently uses a placeholder `{{MeetingLink}}` token in the email body. To wire **real Google Meet** auto-creation (a unique meet.google.com URL minted per interview), follow these steps.

## Prerequisites

You already have:
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env` (used by next-auth Google login).

You'll add:
- A wider OAuth scope (`https://www.googleapis.com/auth/calendar.events`).
- Refresh-token persistence in the next-auth JWT.
- The `googleapis` npm package.
- A small server util that calls `calendar.events.insert` with `conferenceData.createRequest`.

## Step 1 — Google Cloud setup (10 min, in your Google Cloud Console)

1. Open https://console.cloud.google.com → pick (or create) the project that owns `GOOGLE_CLIENT_ID`.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen**
   - Add the scope `https://www.googleapis.com/auth/calendar.events`.
   - Make sure your HR users' Google accounts are listed as **Test users** (if the app is still in Testing) or publish the app.
4. **APIs & Services → Credentials → OAuth 2.0 Client IDs** → open the one you're using → confirm the redirect URI matches your existing next-auth callback (`https://your-host/api/auth/callback/google`).

No new credentials needed — same client ID/secret keeps working with the wider scope.

## Step 2 — Install the API client

```powershell
npm install googleapis
```

## Step 3 — Persist the Google access token in the next-auth JWT

Open `src/lib/auth.ts`. Find the GoogleProvider config and the existing `jwt` callback (if any). Patch:

```ts
GoogleProvider({
  clientId:     process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: [
        "openid", "email", "profile",
        "https://www.googleapis.com/auth/calendar.events",
      ].join(" "),
      access_type: "offline",   // refresh_token
      prompt: "consent",        // re-prompt so we get a refresh_token even on subsequent logins
    },
  },
}),

// In the `callbacks` block, add a `jwt` callback that stores tokens:
async jwt({ token, account }) {
  if (account) {
    token.googleAccessToken  = account.access_token;
    token.googleRefreshToken = account.refresh_token;
    token.googleExpiresAt    = (account.expires_at ?? 0) * 1000;
  }
  return token;
},
async session({ session, token }) {
  (session as any).googleAccessToken  = token.googleAccessToken;
  (session as any).googleRefreshToken = token.googleRefreshToken;
  (session as any).googleExpiresAt    = token.googleExpiresAt;
  return session;
},
```

**Important:** existing HR users will need to **sign out and sign back in** so Google re-prompts and grants the new Calendar scope. The token only carries the scope that was approved at sign-in time.

## Step 4 — Add the Meet creation helper

Create `src/lib/google/calendar.ts`:

```ts
import { google } from "googleapis";

interface CreateMeetArgs {
  accessToken:   string;
  refreshToken?: string;
  summary:       string;
  description?:  string;
  startISO:      string;
  endISO:        string;
  attendees:     { email: string; displayName?: string }[];
  timeZone?:     string;
}

export async function createGoogleMeetEvent(a: CreateMeetArgs) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token:  a.accessToken,
    refresh_token: a.refreshToken,
  });
  const cal = google.calendar({ version: "v3", auth: oauth2 });

  const event = await cal.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    requestBody: {
      summary:     a.summary,
      description: a.description,
      start: { dateTime: a.startISO, timeZone: a.timeZone ?? "Asia/Kolkata" },
      end:   { dateTime: a.endISO,   timeZone: a.timeZone ?? "Asia/Kolkata" },
      attendees: a.attendees,
      conferenceData: {
        createRequest: {
          requestId: `nbm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  // Google returns hangoutLink at the top level + entryPoints in
  // conferenceData. Prefer hangoutLink.
  const url = (event.data.hangoutLink as string | undefined) ??
              event.data.conferenceData?.entryPoints?.[0]?.uri ?? null;
  return { eventId: event.data.id, meetingUrl: url };
}
```

## Step 5 — Wire into the schedule action

In `src/app/api/hr/hiring/candidates/[id]/route.ts`, find `action === "scheduleInterview"` and (after the Interview INSERT) call the helper to mint a Meet link, then UPDATE the row's `location` column:

```ts
// After the INSERT that returns the new interview id...
if (kind === "online") {
  const tokens = (session as any);
  if (tokens.googleAccessToken) {
    try {
      const { meetingUrl } = await createGoogleMeetEvent({
        accessToken:  tokens.googleAccessToken,
        refreshToken: tokens.googleRefreshToken,
        summary:      title,
        description:  note ?? "",
        startISO:     scheduledAt.toISOString(),
        endISO:       new Date(scheduledAt.getTime() + durationMinutes * 60_000).toISOString(),
        attendees: [
          { email: candidateEmail, displayName: candidateName },
          // + panel emails
        ],
      });
      if (meetingUrl) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Interview" SET "location" = $1 WHERE "id" = $2`,
          meetingUrl, inserted[0].id,
        );
      }
    } catch (e) {
      console.error("[schedule] Google Meet creation failed:", e);
      // Interview row stays — HR can paste a link manually.
    }
  }
}
```

## Step 6 — Replace the `{{MeetingLink}}` placeholder

In `ScheduleInterviewModal.tsx`, the email body uses `{{MeetingLink}}`. The backend can resolve this server-side after `createGoogleMeetEvent` returns:

```ts
// In the sendEmail action handler (already exists) — when we receive
// a body containing the literal token `{{MeetingLink}}` and the
// candidate has a fresh interview row with a `location` URL, swap it.
```

Cleanest path: have the schedule action send the email itself once the Meet URL is generated, so the body merge happens server-side.

## Optional — token refresh

If the access token has expired, the `googleapis` client auto-refreshes when a `refresh_token` is set on the OAuth2 client. If you see "invalid_grant" errors, the refresh token may be stale (revoked, or the user removed the app). Force a re-login.

---

**Until you finish steps 1–4**, the Schedule Interview modal works fine — HR just pastes a manually-created Meet URL into the "Meeting link" field. The interview row, the email send, and the activity log all behave correctly.
