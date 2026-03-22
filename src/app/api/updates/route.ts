import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

/**
 * GET /api/updates
 * List update drafts, optionally filtered by project_id.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  const supabase = createServiceClient();
  let query = supabase
    .from("update_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * POST /api/updates
 * Draft a stakeholder update for a project.
 * Body: { project_id: string, stakeholder_id?: string, since?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { project_id, stakeholder_id, since } = await req.json();

    if (!project_id) {
      return NextResponse.json(
        { ok: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Fetch project details
    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (!project) {
      return NextResponse.json(
        { ok: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Fetch recent events for this project
    const cutoff = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabase
      .from("events")
      .select("*")
      .eq("project_id", project_id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!events || events.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No recent events to summarize" },
        { status: 422 }
      );
    }

    // Fetch stakeholder if specified
    let stakeholderContext = "";
    if (stakeholder_id) {
      const { data: stakeholder } = await supabase
        .from("stakeholders")
        .select("*")
        .eq("id", stakeholder_id)
        .single();

      if (stakeholder) {
        stakeholderContext = `\nThis update is for: ${stakeholder.name} (${stakeholder.role ?? "stakeholder"}${stakeholder.org ? ` @ ${stakeholder.org}` : ""}).\nTailor the tone and detail level to their role.`;
      }
    }

    // Draft update with Claude
    const eventSummaries = events
      .map(
        (e) =>
          `[${e.category ?? "uncategorized"}] ${e.title} — ${e.body?.slice(0, 300) ?? "(no body)"}`
      )
      .join("\n\n");

    const message = await getAnthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: `You are a project intelligence assistant drafting a stakeholder update for the project "${project.name}".${stakeholderContext}

Based on the recent events below, draft a concise update that:
- Leads with the most important items (decisions, blockers)
- Groups by theme or category
- Is professional but concise
- Includes action items if any

Respond ONLY with JSON: { "title": "...", "body": "markdown content" }`,
      messages: [
        {
          role: "user",
          content: `Recent events (last ${events.length}):\n\n${eventSummaries}`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    let parsed: { title: string; body: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { title: `Update: ${project.name}`, body: text };
    }

    // Store the draft
    const { data: update, error: insertError } = await supabase
      .from("update_history")
      .insert({
        project_id,
        stakeholder_id: stakeholder_id ?? null,
        title: parsed.title,
        body: parsed.body,
        format: "markdown",
        status: "draft",
        event_ids: events.map((e) => e.id),
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to save update: ${insertError.message}`);
    }

    return NextResponse.json({ ok: true, update });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
