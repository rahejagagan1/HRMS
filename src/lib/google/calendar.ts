// Google Meet auto-creation.
//
// Uses a "bot account" pattern: one Google account (typically
// no-reply@nbmediaproductions.com) is authorized ONCE via
// scripts/_get-google-meet-token.ts, and the resulting refresh_token is
// stored in GOOGLE_MEET_REFRESH_TOKEN. Every Meet event is created on
// that account's calendar; candidates + interviewers are added as
// attendees so they get the link.
//
// HR users never see a Google consent prompt — the bot account does
// all the calendar writes server-side.

import { google } from "googleapis";

interface CreateMeetArgs {
  summary:      string;
  description?: string;
  startISO:     string;
  endISO:       string;
  attendees:    { email: string; displayName?: string }[];
  timeZone?:    string;
}

interface MeetResult {
  eventId:    string | null;
  meetingUrl: string | null;
}

let cachedClient: ReturnType<typeof google.calendar> | null = null;

function getCalendarClient() {
  if (cachedClient) return cachedClient;

  const clientId     = process.env.GOOGLE_MEET_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_MEET_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_MEET_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Meet not configured — set GOOGLE_MEET_CLIENT_ID, " +
      "GOOGLE_MEET_CLIENT_SECRET and GOOGLE_MEET_REFRESH_TOKEN in .env. " +
      "Run scripts/_get-google-meet-token.ts to capture the refresh token.",
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  cachedClient = google.calendar({ version: "v3", auth: oauth2 });
  return cachedClient;
}

/**
 * Create a Google Calendar event with a Google Meet conference attached.
 * Returns the event id + Meet URL. Attendees do NOT get Google's own
 * calendar invite (sendUpdates: "none") — the app sends its own branded
 * email separately. Switch to "all" if you want Google to also mail
 * attendees the standard ICS invite.
 */
export async function createGoogleMeetEvent(a: CreateMeetArgs): Promise<MeetResult> {
  const cal = getCalendarClient();
  const calendarId = process.env.GOOGLE_MEET_CALENDAR_ID || "primary";

  const event = await cal.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: "none",
    requestBody: {
      summary:     a.summary,
      description: a.description,
      start: { dateTime: a.startISO, timeZone: a.timeZone ?? "Asia/Kolkata" },
      end:   { dateTime: a.endISO,   timeZone: a.timeZone ?? "Asia/Kolkata" },
      attendees: a.attendees,
      conferenceData: {
        createRequest: {
          // Unique per-request id required by the Calendar API.
          requestId: `nbm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const meetingUrl =
    (event.data.hangoutLink as string | undefined) ??
    event.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
    null;

  return {
    eventId:    event.data.id ?? null,
    meetingUrl: meetingUrl ?? null,
  };
}

/**
 * Cheap "is Meet auto-creation available right now" check the API route
 * uses before calling the helper. Avoids the heavier client init / token
 * round-trip when env isn't set.
 */
export function isGoogleMeetConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_MEET_CLIENT_ID &&
    process.env.GOOGLE_MEET_CLIENT_SECRET &&
    process.env.GOOGLE_MEET_REFRESH_TOKEN,
  );
}

interface UpdateMeetArgs {
  eventId:      string;
  summary?:     string;
  description?: string;
  startISO?:    string;
  endISO?:      string;
  timeZone?:    string;
}

/**
 * Patch a previously-created event — used when HR reschedules.
 * Only fields the caller passes are touched; the Meet link survives a
 * time change because we patch instead of recreating.
 */
export async function updateGoogleMeetEvent(a: UpdateMeetArgs): Promise<void> {
  const cal = getCalendarClient();
  const calendarId = process.env.GOOGLE_MEET_CALENDAR_ID || "primary";
  const body: Record<string, unknown> = {};
  if (a.summary     !== undefined) body.summary     = a.summary;
  if (a.description !== undefined) body.description = a.description;
  if (a.startISO)                  body.start       = { dateTime: a.startISO, timeZone: a.timeZone ?? "Asia/Kolkata" };
  if (a.endISO)                    body.end         = { dateTime: a.endISO,   timeZone: a.timeZone ?? "Asia/Kolkata" };
  await cal.events.patch({
    calendarId,
    eventId:    a.eventId,
    sendUpdates: "none",
    requestBody: body,
  });
}

/**
 * Hard-delete the event when HR cancels an interview. Soft-fails on
 * 404/410 (already gone) so the caller can proceed with marking the
 * row cancelled even if Google's already lost the event.
 */
export async function deleteGoogleMeetEvent(eventId: string): Promise<void> {
  const cal = getCalendarClient();
  const calendarId = process.env.GOOGLE_MEET_CALENDAR_ID || "primary";
  try {
    await cal.events.delete({ calendarId, eventId, sendUpdates: "none" });
  } catch (e: any) {
    const code = e?.code ?? e?.response?.status;
    if (code === 404 || code === 410) return; // already gone
    throw e;
  }
}
