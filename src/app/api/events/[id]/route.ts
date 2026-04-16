import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiKey } from "@/lib/auth";
import type {
  Workspace,
  TaskPriority,
  TaskStatus,
} from "@/types/database";

const WORKSPACES: Workspace[] = ["personal", "atlan", "landit", "general"];
const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];
const STATUSES: TaskStatus[] = ["inbox", "active", "done", "dismissed"];

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ("title" in body) {
    if (typeof body.title !== "string" || body.title.length === 0) {
      return NextResponse.json(
        { error: "title must be a non-empty string" },
        { status: 400 }
      );
    }
    update.title = body.title;
  }

  if ("workspace" in body) {
    if (body.workspace !== null && !WORKSPACES.includes(body.workspace as Workspace)) {
      return NextResponse.json(
        { error: `workspace must be one of ${WORKSPACES.join(", ")} or null` },
        { status: 400 }
      );
    }
    update.workspace = body.workspace;
  }

  if ("priority" in body) {
    if (body.priority !== null && !PRIORITIES.includes(body.priority as TaskPriority)) {
      return NextResponse.json(
        { error: `priority must be one of ${PRIORITIES.join(", ")} or null` },
        { status: 400 }
      );
    }
    update.priority = body.priority;
  }

  if ("due_date" in body) {
    if (body.due_date !== null && typeof body.due_date !== "string") {
      return NextResponse.json(
        { error: "due_date must be an ISO string or null" },
        { status: 400 }
      );
    }
    update.due_date = body.due_date;
  }

  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string or null" },
        { status: 400 }
      );
    }
    update.notes = body.notes;
  }

  if ("links" in body) {
    if (
      !Array.isArray(body.links) ||
      !body.links.every((l) => typeof l === "string")
    ) {
      return NextResponse.json(
        { error: "links must be a string array" },
        { status: 400 }
      );
    }
    update.links = body.links;
  }

  if ("task_status" in body) {
    if (!STATUSES.includes(body.task_status as TaskStatus)) {
      return NextResponse.json(
        { error: `task_status must be one of ${STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    update.task_status = body.task_status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}
