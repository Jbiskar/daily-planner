import { NextRequest, NextResponse } from "next/server";
import { ingestAndClassify } from "@/lib/classify";
import { requireApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  try {
    const payload = await req.json();

    // Granola sends meeting transcripts / notes
    const title =
      payload.title ??
      payload.meeting_title ??
      "Granola meeting notes";

    const body =
      payload.transcript ??
      payload.notes ??
      payload.summary ??
      JSON.stringify(payload);

    const event = await ingestAndClassify(
      "granola",
      title,
      body,
      payload,
      payload.id ?? payload.meeting_id,
      payload.started_at ?? payload.date
    );

    return NextResponse.json({ ok: true, event_id: event.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
