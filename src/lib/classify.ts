import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  EventCategory,
  Event,
  Workspace,
  TaskPriority,
} from "@/types/database";
import type { GranolaNote, GranolaAttendee } from "@/lib/granola";
import { jakeEmails } from "@/lib/granola";

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

interface ClassificationResult {
  project_id: string | null;
  category: EventCategory;
  confidence: number;
  stakeholder_ids: string[];
  title: string;
  summary: string;
  workspace: Workspace | null;
  priority: TaskPriority | null;
  due_date: string | null;
}

/**
 * Classify a raw event using Claude. Fetches active projects and stakeholders
 * from Supabase so Claude can route the event to the right project.
 */
export async function classifyEvent(
  rawText: string,
  source: Event["source"],
  rawPayload?: Record<string, unknown>
): Promise<ClassificationResult> {
  const supabase = createServiceClient();

  // Fetch active projects and stakeholders for context
  const [{ data: projects }, { data: stakeholders }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description")
      .in("status", ["active", "paused"]),
    supabase
      .from("stakeholders")
      .select("id, name, email, role, org"),
  ]);

  const projectList = (projects ?? [])
    .map((p) => `- ${p.name} (${p.id}): ${p.description ?? "no description"}`)
    .join("\n");

  const stakeholderList = (stakeholders ?? [])
    .map((s) => `- ${s.name} (${s.id}): ${s.role ?? ""} ${s.org ? `@ ${s.org}` : ""}`.trim())
    .join("\n");

  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a project intelligence assistant. Given an incoming event, determine:
1. Which project it belongs to (from the list provided), or null if no match
2. The event category: meeting, task, decision, blocker, update, idea, followup, note
3. A confidence score (0.0–1.0)
4. Which stakeholders are mentioned or involved (by ID from the list)
5. A short title
6. A one-line summary

Also determine:
- workspace — one of: personal, atlan, landit, consulting, or null if genuinely unclear.
  Jake's work buckets: Atlan is his day job (weekday 9–5, meetings, Granola notes). Landit (Just Land It / JLI) is his startup, nights and weekends. Consulting is paid client / freelance work outside Atlan and Landit. Personal = non-work. If you can't confidently pick one, return null rather than guessing.
- priority — one of: high, medium, low. Infer from urgency signals ("ASAP", "blocker", soft language).
- due_date — ISO 8601 timestamp or null. Parse relative dates like "by Friday", "next Tuesday", "EOD", "tomorrow morning".

Active projects:
${projectList || "(none yet)"}

Known stakeholders:
${stakeholderList || "(none yet)"}

Respond ONLY with JSON:
{ "project_id": "uuid-or-null", "category": "...", "confidence": 0.95, "stakeholder_ids": ["..."], "title": "...", "summary": "...", "workspace": "...", "priority": "...", "due_date": "ISO-8601-or-null" }`,
    messages: [
      {
        role: "user",
        content: `Source: ${source}\n\nContent:\n${rawText}${
          rawPayload ? `\n\nRaw payload (for additional context):\n${JSON.stringify(rawPayload, null, 2).slice(0, 2000)}` : ""
        }`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      project_id: parsed.project_id || null,
      category: parsed.category,
      confidence: parsed.confidence,
      stakeholder_ids: parsed.stakeholder_ids ?? [],
      title: parsed.title,
      summary: parsed.summary,
      workspace: parsed.workspace ?? null,
      priority: parsed.priority ?? null,
      due_date: parsed.due_date ?? null,
    };
  } catch {
    // Fallback if Claude doesn't return valid JSON
    return {
      project_id: null,
      category: "note",
      confidence: 0.3,
      stakeholder_ids: [],
      title: rawText.slice(0, 80),
      summary: rawText.slice(0, 200),
      workspace: null,
      priority: null,
      due_date: null,
    };
  }
}

/**
 * Ingest + classify: store the raw event, classify it, then update with classification.
 */
export async function ingestAndClassify(
  source: Event["source"],
  title: string,
  body: string,
  rawPayload?: Record<string, unknown>,
  sourceId?: string,
  occurredAt?: string
): Promise<Event> {
  const supabase = createServiceClient();

  // 1. Insert raw event (unclassified)
  const { data: event, error: insertError } = await supabase
    .from("events")
    .insert({
      source,
      source_id: sourceId ?? null,
      title,
      body,
      raw_payload: rawPayload ?? null,
      occurred_at: occurredAt ?? new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !event) {
    throw new Error(`Failed to insert event: ${insertError?.message}`);
  }

  // 2. Classify with Claude
  const classification = await classifyEvent(body || title, source, rawPayload);

  // 3. Update event with classification
  const { data: classified, error: updateError } = await supabase
    .from("events")
    .update({
      project_id: classification.project_id,
      category: classification.category,
      title: classification.title,
      classification_confidence: classification.confidence,
      classified_at: new Date().toISOString(),
      stakeholder_ids: classification.stakeholder_ids,
      workspace: classification.workspace,
      priority: classification.priority,
      due_date: classification.due_date,
    })
    .eq("id", event.id)
    .select()
    .single();

  if (updateError || !classified) {
    throw new Error(`Failed to update classification: ${updateError?.message}`);
  }

  return classified as Event;
}

export interface ExtractedActionItem {
  title: string;
  priority: TaskPriority | null;
  due_date: string | null;
  notes: string | null;
  stakeholder_emails: string[];
}

interface ExtractActionItemsOptions {
  excludeTitles?: string[];
}

export async function extractActionItems(
  note: GranolaNote,
  options: ExtractActionItemsOptions = {}
): Promise<ExtractedActionItem[]> {
  const summary = note.summary_markdown?.trim();
  if (!summary) return [];

  const attendeeLines = (note.attendees ?? [])
    .map((a: GranolaAttendee) => {
      const name = a.name ?? "(unnamed)";
      const email = a.email ?? "(no email)";
      return `- ${name} <${email}>`;
    })
    .join("\n");

  const emails = jakeEmails();
  const jakeIdentity =
    emails.length > 0
      ? `Jake's emails: ${emails.join(", ")}. Any attendee at one of those addresses IS Jake.`
      : "Jake's emails were not configured. Use best judgment.";

  const excludePreamble =
    options.excludeTitles && options.excludeTitles.length > 0
      ? `Items already extracted from this meeting (do NOT duplicate):\n${options.excludeTitles
          .map((t) => `- ${t}`)
          .join("\n")}\n\nReturn only new items.\n\n`
      : "";

  const system = `You are reading meeting notes. Extract ONLY action items that Jake is responsible for completing — either solo or as a co-owner. Skip items assigned exclusively to someone else.

${jakeIdentity}

For each action item, return:
- title: short imperative phrase ("Send Q3 deck to Sarah"). 8 words or less when possible.
- priority: "high" | "medium" | "low" based on urgency signals. "ASAP", "blocker", "before the demo" → high. "when you have time", "eventually" → low. Default medium.
- due_date: ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss-07:00) or null. Parse "by Friday", "EOD", "next week", "tomorrow morning" relative to the meeting date (${note.calendar_event?.scheduled_start_time ?? note.created_at ?? "unknown"}). Null if no date is implied.
- notes: 1–3 sentences describing what specifically needs to happen, including any context or co-owner. If Jake is co-owner with someone, mention them here.
- stakeholder_emails: array of attendee emails relevant to this action (exclude Jake's own email).

Respond with ONLY a JSON array. No preamble. Return [] if there are no action items for Jake.`;

  const user = `${excludePreamble}Meeting: ${note.title}
Meeting time: ${note.calendar_event?.scheduled_start_time ?? note.created_at ?? "(unknown)"}
Attendees:
${attendeeLines || "(no attendees listed)"}

Summary:
${summary}`;

  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is Record<string, unknown> =>
          typeof p === "object" && p !== null
      )
      .map((p) => ({
        title: typeof p.title === "string" ? p.title.trim() : "",
        priority: isPriority(p.priority) ? p.priority : null,
        due_date: typeof p.due_date === "string" ? p.due_date : null,
        notes: typeof p.notes === "string" ? p.notes : null,
        stakeholder_emails: Array.isArray(p.stakeholder_emails)
          ? p.stakeholder_emails
              .filter((e): e is string => typeof e === "string")
              .map((e) => e.trim().toLowerCase())
          : [],
      }))
      .filter((a) => a.title.length > 0);
  } catch {
    return [];
  }
}

function isPriority(v: unknown): v is TaskPriority {
  return v === "high" || v === "medium" || v === "low";
}
