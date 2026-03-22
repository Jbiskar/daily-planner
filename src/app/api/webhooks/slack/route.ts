import { NextRequest, NextResponse } from "next/server";
import { ingestAndClassify } from "@/lib/classify";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Slack URL verification challenge
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Handle event callbacks
    const slackEvent = payload.event;
    if (!slackEvent) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const title = `Slack: ${slackEvent.type} in #${slackEvent.channel ?? "unknown"}`;
    const body = slackEvent.text ?? slackEvent.message?.text ?? "";

    const event = await ingestAndClassify(
      "slack",
      title,
      body,
      payload,
      slackEvent.ts ?? slackEvent.event_ts,
      slackEvent.ts
        ? new Date(parseFloat(slackEvent.ts) * 1000).toISOString()
        : undefined
    );

    return NextResponse.json({ ok: true, event_id: event.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
