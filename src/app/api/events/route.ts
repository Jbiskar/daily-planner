import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";

const WORKSPACES: Workspace[] = [
  "personal",
  "atlan",
  "landit",
  "consulting",
  "general",
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const supabase = createServiceClient();
  let query = supabase
    .from("events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 }
    );
  }

  const due_date =
    body.due_date === null || typeof body.due_date === "string"
      ? (body.due_date as string | null)
      : null;

  const workspace =
    body.workspace && WORKSPACES.includes(body.workspace as Workspace)
      ? (body.workspace as Workspace)
      : null;

  const notes =
    typeof body.notes === "string" && body.notes.length > 0
      ? body.notes
      : null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      title,
      source: "manual",
      task_status: "active",
      due_date,
      workspace,
      notes,
      occurred_at: due_date,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
