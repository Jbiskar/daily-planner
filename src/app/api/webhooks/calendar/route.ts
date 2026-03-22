import { NextRequest, NextResponse } from "next/server";
import { ingestAndClassify } from "@/lib/classify";
import { requireApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  try {
    const payload = await req.json();

    // Google Calendar push notification or forwarded event data
    const title =
      payload.summary ??
      payload.event?.summary ??
      "Untitled calendar event";

    const attendees = (payload.attendees ?? payload.event?.attendees ?? [])
      .map((a: { email?: string; displayName?: string }) => a.displayName ?? a.email)
      .join(", ");

    const body = [
      payload.description ?? payload.event?.description ?? "",
      attendees ? `Attendees: ${attendees}` : "",
      payload.location ?? payload.event?.location
        ? `Location: ${payload.location ?? payload.event?.location}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const event = await ingestAndClassify(
      "google_calendar",
      title,
      body,
      payload,
      payload.id ?? payload.event?.id,
      payload.start?.dateTime ?? payload.event?.start?.dateTime
    );

    return NextResponse.json({ ok: true, event_id: event.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
