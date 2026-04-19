import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  granolaGet,
  type GranolaListResponse,
  type GranolaNote,
} from "@/lib/granola";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret");
  return header === expected;
}

// Store last-poll timestamp in a single-row settings table inside the events
// metadata. Use a special events row with source='manual' and a reserved
// source_id for simplicity — avoids a new migration.
const STATE_SOURCE_ID = "__granola_live_poll_state";

async function readLastPoll(): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("events")
    .select("metadata")
    .eq("source", "manual")
    .eq("source_id", STATE_SOURCE_ID)
    .maybeSingle();
  const iso = (data?.metadata as { last_poll?: string } | undefined)?.last_poll;
  if (iso) return iso;
  // First run: look back 30 minutes.
  return new Date(Date.now() - 30 * 60 * 1000).toISOString();
}

async function writeLastPoll(iso: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("events").upsert(
    {
      source: "manual",
      source_id: STATE_SOURCE_ID,
      title: "granola live-poll state",
      task_status: "dismissed",
      metadata: { last_poll: iso },
    },
    { onConflict: "source,source_id" }
  );
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const apiKey = process.env.DAILY_PLANNER_API_KEY ?? "";
  const now = new Date().toISOString();
  const since = await readLastPoll();

  const results: Array<{ note_id: string; ok: boolean; error?: string }> = [];
  let scanned = 0;

  try {
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({
        updated_after: since,
        page_size: "30",
      });
      if (cursor) qs.set("cursor", cursor);
      const list: GranolaListResponse = await granolaGet<GranolaListResponse>(
        `/v1/notes?${qs}`
      );
      const notes = list.notes ?? [];
      scanned += notes.length;

      for (const summary of notes) {
        try {
          const note = await granolaGet<GranolaNote>(
            `/v1/notes/${summary.id}`
          );
          const res = await fetch(`${appUrl}/api/webhooks/granola`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({ note, mode: "live" }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
          };
          results.push({
            note_id: note.id,
            ok: !!data.ok,
            error: data.error,
          });
        } catch (e) {
          results.push({
            note_id: summary.id,
            ok: false,
            error: e instanceof Error ? e.message : "unknown",
          });
        }
        await new Promise((r) => setTimeout(r, 260));
      }
      cursor = list.cursor ?? null;
    } while (cursor);

    await writeLastPoll(now);
    return NextResponse.json({
      ok: true,
      window: { since, until: now },
      scanned,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "unknown",
        scanned,
        results,
      },
      { status: 500 }
    );
  }
}
