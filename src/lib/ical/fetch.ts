import ical, { type VEvent } from "node-ical";
import type { GoogleCalendarEvent } from "@/lib/google/calendar";

export type CalendarSource = "google" | "atlan" | "personal";

export interface CalendarFeed {
  source: CalendarSource;
  url: string;
}

function envFeeds(): CalendarFeed[] {
  const feeds: CalendarFeed[] = [];
  if (process.env.ATLAN_ICAL_URL) {
    feeds.push({ source: "atlan", url: process.env.ATLAN_ICAL_URL });
  }
  if (process.env.PERSONAL_ICAL_URL) {
    feeds.push({ source: "personal", url: process.env.PERSONAL_ICAL_URL });
  }
  return feeds;
}

export function listIcalFeeds(): CalendarFeed[] {
  return envFeeds();
}

async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "daily-planner/1.0" },
  });
  if (!res.ok) {
    throw new Error(`iCal fetch failed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

interface WithinRange {
  start: Date;
  end: Date;
}

function expandEvent(
  ev: VEvent,
  range: WithinRange
): Array<{ start: Date; end: Date; recurrenceId?: Date }> {
  const durationMs =
    (ev.end?.getTime?.() ?? ev.start.getTime() + 30 * 60_000) -
    ev.start.getTime();

  if (!ev.rrule) {
    if (ev.end && ev.end < range.start) return [];
    if (ev.start > range.end) return [];
    return [{ start: ev.start, end: ev.end ?? new Date(ev.start.getTime() + durationMs) }];
  }

  const occurrences = ev.rrule.between(range.start, range.end, true);
  const exdates = ev.exdate ? Object.values(ev.exdate) : [];
  const exdateTimes = new Set(
    exdates.map((d) => (d as Date).getTime())
  );

  const results: Array<{ start: Date; end: Date; recurrenceId?: Date }> = [];
  for (const occ of occurrences) {
    if (exdateTimes.has(occ.getTime())) continue;
    results.push({
      start: occ,
      end: new Date(occ.getTime() + durationMs),
      recurrenceId: occ,
    });
  }
  return results;
}

function detectAllDay(ev: VEvent): boolean {
  // node-ical strips VALUE=DATE info but all-day events end up at midnight
  // with date-only strings in the original .ics. As a heuristic, treat an
  // event as all-day when start is at local midnight and duration is a
  // whole number of days.
  const s = ev.start;
  if (!s) return false;
  if (s.getHours() !== 0 || s.getMinutes() !== 0) return false;
  const endMs = ev.end?.getTime?.() ?? s.getTime();
  const durHours = (endMs - s.getTime()) / 3_600_000;
  return durHours > 0 && durHours % 24 === 0;
}

export async function loadIcalEvents(
  timeMin: string,
  timeMax: string
): Promise<GoogleCalendarEvent[]> {
  const feeds = envFeeds();
  if (feeds.length === 0) return [];

  const range = {
    start: new Date(timeMin),
    end: new Date(timeMax),
  };

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const ics = await fetchIcs(feed.url);
      const parsed = ical.sync.parseICS(ics);
      const out: GoogleCalendarEvent[] = [];

      for (const key of Object.keys(parsed)) {
        const item = parsed[key];
        if (!item || item.type !== "VEVENT") continue;
        const ev = item as VEvent;
        if (!ev.start) continue;

        for (const occ of expandEvent(ev, range)) {
          const allDay = detectAllDay(ev);
          const idSuffix = occ.recurrenceId
            ? `-${occ.recurrenceId.toISOString()}`
            : "";
          out.push({
            id: `${feed.source}-${ev.uid ?? key}${idSuffix}`,
            summary: typeof ev.summary === "string" ? ev.summary : null,
            description:
              typeof ev.description === "string" ? ev.description : null,
            location: typeof ev.location === "string" ? ev.location : null,
            htmlLink: null,
            status: ev.status ?? null,
            start: occ.start.toISOString(),
            end: occ.end.toISOString(),
            allDay,
            organizerEmail:
              typeof ev.organizer === "string"
                ? ev.organizer.replace(/^mailto:/i, "")
                : (ev.organizer as { val?: string } | undefined)?.val?.replace(
                    /^mailto:/i,
                    ""
                  ) ?? null,
            attendees: [],
            source: feed.source,
          } as GoogleCalendarEvent);
        }
      }
      return out;
    })
  );

  const events: GoogleCalendarEvent[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") events.push(...r.value);
    else console.warn("[ical] feed load failed:", r.reason);
  }
  return events;
}
