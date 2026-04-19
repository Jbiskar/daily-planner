import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { extractActionItems } from "@/lib/classify";
import {
  inferWorkspace,
  upsertAttendees,
  type GranolaNote,
} from "@/lib/granola";

type IngestMode = "live" | "backfill" | "daily_review";

interface IngestBody {
  note?: GranolaNote;
  mode?: IngestMode;
  excludeExistingActionItems?: boolean;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const note = body.note;
  if (!note || !note.id || !note.title) {
    return NextResponse.json(
      { error: "Missing note.id or note.title in body" },
      { status: 400 }
    );
  }

  const mode: IngestMode = body.mode ?? "live";
  const supabase = createServiceClient();

  try {
    const workspace = inferWorkspace(note.attendees ?? []);
    const { ids: stakeholderIds, byEmail } = await upsertAttendees(
      note.attendees ?? []
    );

    const occurredAt =
      note.calendar_event?.scheduled_start_time ?? note.created_at ?? null;

    const { data: archive, error: archiveError } = await supabase
      .from("events")
      .upsert(
        {
          source: "granola",
          source_id: note.id,
          title: note.title,
          body: note.summary_markdown ?? null,
          raw_payload: note as unknown as Record<string, unknown>,
          occurred_at: occurredAt,
          stakeholder_ids: stakeholderIds,
          workspace,
          task_status: "dismissed",
          category: "meeting",
          links: note.web_url ? [note.web_url] : [],
        },
        { onConflict: "source,source_id" }
      )
      .select()
      .single();

    if (archiveError || !archive) {
      throw new Error(
        `Failed to upsert archive row: ${archiveError?.message ?? "unknown"}`
      );
    }

    if (mode === "backfill") {
      return NextResponse.json({
        ok: true,
        mode,
        archive_id: archive.id,
        action_items: 0,
      });
    }

    let excludeTitles: string[] | undefined;
    if (
      mode === "daily_review" ||
      body.excludeExistingActionItems ||
      mode === "live"
    ) {
      const { data: existing } = await supabase
        .from("events")
        .select("title, source_id")
        .eq("source", "granola")
        .like("source_id", `${note.id}#%`);
      if (existing && existing.length > 0) {
        excludeTitles = existing.map((e) => e.title as string);
      }
    }

    const actionItems = await extractActionItems(note, { excludeTitles });

    let inserted = 0;
    for (let i = 0; i < actionItems.length; i++) {
      const item = actionItems[i];
      const related = (item.stakeholder_emails ?? [])
        .map((e) => byEmail[e.toLowerCase()])
        .filter((id): id is string => !!id);

      const metadata: Record<string, unknown> = {
        source_flow: mode,
        granola_note_id: note.id,
        action_index: i,
      };

      const sourceId = `${note.id}#${i}`;

      const { error: insertError } = await supabase.from("events").upsert(
        {
          source: "granola",
          source_id: sourceId,
          title: item.title,
          body: item.notes ?? null,
          raw_payload: item as unknown as Record<string, unknown>,
          occurred_at: occurredAt,
          stakeholder_ids: related,
          workspace,
          task_status: "inbox",
          priority: item.priority,
          due_date: item.due_date,
          notes: item.notes,
          links: note.web_url ? [note.web_url] : [],
          category: "task",
          metadata,
        },
        { onConflict: "source,source_id" }
      );
      if (insertError) {
        console.warn(
          `[granola] task upsert failed for ${sourceId}:`,
          insertError.message
        );
        continue;
      }
      inserted++;
    }

    return NextResponse.json({
      ok: true,
      mode,
      archive_id: archive.id,
      action_items: inserted,
      workspace,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[granola] ingest failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

