import { getValidAccessToken } from "@/lib/google/oauth";

export type CalendarEventSource = "google" | "atlan" | "personal";

export interface GoogleCalendarEvent {
  id: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  status: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizerEmail: string | null;
  attendees: Array<{ email: string; responseStatus: string | null }>;
  source: CalendarEventSource;
}

interface GoogleApiEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
}

function normalize(e: GoogleApiEvent): GoogleCalendarEvent {
  const startDt = e.start?.dateTime ?? e.start?.date ?? null;
  const endDt = e.end?.dateTime ?? e.end?.date ?? null;
  const allDay = !e.start?.dateTime && !!e.start?.date;
  return {
    id: e.id,
    summary: e.summary ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    htmlLink: e.htmlLink ?? null,
    status: e.status ?? null,
    start: startDt,
    end: endDt,
    allDay,
    organizerEmail: e.organizer?.email ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({
        email: a.email as string,
        responseStatus: a.responseStatus ?? null,
      })),
    source: "google",
  };
}

export async function listEvents(
  timeMin: string,
  timeMax: string
): Promise<GoogleCalendarEvent[]> {
  const auth = await getValidAccessToken();
  if (!auth) throw new Error("not_connected");

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Calendar list failed: ${res.status} ${await res.text()}`
    );
  }
  const body = (await res.json()) as { items?: GoogleApiEvent[] };
  return (body.items ?? []).map(normalize);
}

export interface CreateEventInput {
  summary: string;
  description?: string | null;
  start: string;
  end: string;
  timeZone?: string;
}

export async function createEvent(
  input: CreateEventInput
): Promise<GoogleCalendarEvent> {
  const auth = await getValidAccessToken();
  if (!auth) throw new Error("not_connected");

  const payload = {
    summary: input.summary,
    description: input.description ?? undefined,
    start: {
      dateTime: input.start,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
    end: {
      dateTime: input.end,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Calendar create failed: ${res.status} ${await res.text()}`
    );
  }
  return normalize((await res.json()) as GoogleApiEvent);
}
