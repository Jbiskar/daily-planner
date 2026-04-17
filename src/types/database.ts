// Generated types for Supabase schema
// Run `npm run db:types` to regenerate from live schema

export type EventSource =
  | "notion"
  | "slack"
  | "google_calendar"
  | "granola"
  | "voice_note"
  | "manual";

export type EventCategory =
  | "meeting"
  | "task"
  | "decision"
  | "blocker"
  | "update"
  | "idea"
  | "followup"
  | "note";

export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type UpdateStatus = "draft" | "approved" | "sent" | "failed";
export type UpdateFormat = "markdown" | "slack" | "email" | "plain";
export type DocType = "general" | "prd" | "meeting_notes" | "slack_thread" | "design_doc" | "runbook";

export type Workspace =
  | "personal"
  | "atlan"
  | "landit"
  | "consulting"
  | "general";
export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "inbox" | "active" | "done" | "dismissed";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Stakeholder {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  org: string | null;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectStakeholder {
  project_id: string;
  stakeholder_id: string;
  role_in_project: string | null;
}

export interface Event {
  id: string;
  project_id: string | null;
  source: EventSource;
  source_id: string | null;
  category: EventCategory | null;
  title: string;
  body: string | null;
  raw_payload: Record<string, unknown> | null;
  occurred_at: string | null;
  classified_at: string | null;
  classification_confidence: number | null;
  stakeholder_ids: string[];
  metadata: Record<string, unknown>;
  workspace: Workspace | null;
  priority: TaskPriority | null;
  due_date: string | null;
  notes: string | null;
  links: string[];
  task_status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  prompt_template: string | null;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ContextDoc {
  id: string;
  project_id: string;
  title: string;
  content: string;
  doc_type: DocType;
  source_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpdateHistory {
  id: string;
  project_id: string;
  stakeholder_id: string | null;
  title: string;
  body: string;
  format: UpdateFormat;
  status: UpdateStatus;
  event_ids: string[];
  sent_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
