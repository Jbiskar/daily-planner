import { NextRequest, NextResponse } from "next/server";
import { ingestAndClassify } from "@/lib/classify";
import { requireApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  try {
    const payload = await req.json();

    // Notion sends different event types; extract what we need
    const pageTitle =
      payload?.properties?.Name?.title?.[0]?.plain_text ??
      payload?.properties?.title?.title?.[0]?.plain_text ??
      "Untitled Notion event";

    const body =
      payload?.properties?.Description?.rich_text?.[0]?.plain_text ??
      JSON.stringify(payload?.properties ?? {});

    const event = await ingestAndClassify(
      "notion",
      pageTitle,
      body,
      payload,
      payload?.id,
      payload?.last_edited_time ?? payload?.created_time
    );

    return NextResponse.json({ ok: true, event_id: event.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
