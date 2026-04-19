import { NextRequest, NextResponse } from "next/server";
import { createEvent, listEvents } from "@/lib/google/calendar";
import type { GoogleCalendarEvent } from "@/lib/google/calendar";
import { loadIcalEvents } from "@/lib/ical/fetch";
import { getStoredTokens } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params are required (ISO 8601)" },
      { status: 400 }
    );
  }

  const hasGoogle = !!(await getStoredTokens());
  const googlePromise: Promise<GoogleCalendarEvent[]> = hasGoogle
    ? listEvents(start, end).catch((e) => {
        console.warn("[calendar] google fetch failed:", e);
        return [];
      })
    : Promise.resolve([]);
  const icalPromise = loadIcalEvents(start, end).catch((e) => {
    console.warn("[calendar] ical fetch failed:", e);
    return [] as GoogleCalendarEvent[];
  });

  try {
    const [googleEvents, icalEvents] = await Promise.all([
      googlePromise,
      icalPromise,
    ]);
    const events = [...googleEvents, ...icalEvents];
    return NextResponse.json({ events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    summary?: string;
    description?: string | null;
    start?: string;
    end?: string;
    timeZone?: string;
  } | null;

  if (!body?.summary || !body.start || !body.end) {
    return NextResponse.json(
      { error: "summary, start, end are required" },
      { status: 400 }
    );
  }

  try {
    const event = await createEvent({
      summary: body.summary,
      description: body.description,
      start: body.start,
      end: body.end,
      timeZone: body.timeZone,
    });
    return NextResponse.json({ event });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "not_connected") {
      return NextResponse.json({ error: "not_connected" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
