import { NextRequest, NextResponse } from "next/server";
import { granolaGet, type GranolaListResponse, type GranolaNote } from "@/lib/granola";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron authenticates incoming requests with a shared secret header
// (either the platform's `Authorization: Bearer $CRON_SECRET` or our own).
function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev: no secret configured
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret");
  return header === expected;
}

function isoMidnightUtc(offsetDays = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const apiKey = process.env.DAILY_PLANNER_API_KEY ?? "";

  // Look back 36 hours to catch meetings that ended late last night.
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const until = isoMidnightUtc(1);

  const results: Array<{
    note_id: string;
    ok: boolean;
    action_items?: number;
    error?: string;
  }> = [];
  let scanned = 0;

  try {
    let cursor: string | null = null;
    do {
      const list: GranolaListResponse = await granolaGet<GranolaListResponse>(
        `/v1/notes?created_after=${encodeURIComponent(since)}&created_before=${encodeURIComponent(until)}&page_size=30${cursor ? `&cursor=${cursor}` : ""}`
      );
      const notes = list.notes ?? [];
      scanned += notes.length;

      for (const summary of notes) {
        try {
          const note = await granolaGet<GranolaNote>(
            `/v1/notes/${summary.id}`
          );
          const ingestRes = await fetch(`${appUrl}/api/webhooks/granola`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              note,
              mode: "daily_review",
              excludeExistingActionItems: true,
            }),
          });
          const data = (await ingestRes.json().catch(() => ({}))) as {
            ok?: boolean;
            action_items?: number;
            error?: string;
          };
          results.push({
            note_id: note.id,
            ok: !!data.ok,
            action_items: data.action_items,
            error: data.error,
          });
        } catch (e) {
          results.push({
            note_id: summary.id,
            ok: false,
            error: e instanceof Error ? e.message : "unknown",
          });
        }
        // Stay under Granola's 5 req/sec limit.
        await new Promise((r) => setTimeout(r, 260));
      }

      cursor = list.cursor ?? null;
    } while (cursor);

    const totalAdded = results.reduce(
      (sum, r) => sum + (r.action_items ?? 0),
      0
    );
    return NextResponse.json({
      ok: true,
      window: { since, until },
      scanned,
      total_new_action_items: totalAdded,
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
