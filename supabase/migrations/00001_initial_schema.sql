-- Daily Planner: Initial Schema
-- Tables: projects, stakeholders, events, skills, context_docs, update_history

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- PROJECTS
-- A project is a top-level container for related work.
-- ============================================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  color text, -- hex color for UI
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_status on projects (status);

-- ============================================================
-- STAKEHOLDERS
-- People associated with one or more projects.
-- A stakeholder can span multiple projects (join table below).
-- ============================================================
create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text, -- e.g. 'engineering manager', 'designer', 'exec sponsor'
  org text, -- company or team name
  avatar_url text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_stakeholders_email on stakeholders (email);

-- Join table: which stakeholders belong to which projects
create table project_stakeholders (
  project_id uuid not null references projects(id) on delete cascade,
  stakeholder_id uuid not null references stakeholders(id) on delete cascade,
  role_in_project text, -- e.g. 'lead', 'reviewer', 'informed'
  primary key (project_id, stakeholder_id)
);

-- ============================================================
-- EVENTS
-- Raw ingested items from any source (webhook, voice note, manual).
-- Claude classifies these and routes them to a project.
-- ============================================================
create type event_source as enum (
  'notion',
  'slack',
  'google_calendar',
  'granola',
  'voice_note',
  'manual'
);

create type event_category as enum (
  'meeting',
  'task',
  'decision',
  'blocker',
  'update',
  'idea',
  'followup',
  'note'
);

create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  source event_source not null,
  source_id text, -- original ID from the source system
  category event_category,
  title text not null,
  body text, -- full content / transcription
  raw_payload jsonb, -- original webhook payload for debugging
  occurred_at timestamptz, -- when the event actually happened
  classified_at timestamptz, -- when Claude classified it
  classification_confidence real, -- 0.0–1.0
  stakeholder_ids uuid[] default '{}', -- mentioned / involved stakeholders
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_events_project on events (project_id);
create index idx_events_source on events (source);
create index idx_events_category on events (category);
create index idx_events_occurred on events (occurred_at desc);
create index idx_events_created on events (created_at desc);

-- ============================================================
-- SKILLS
-- Reusable "skills" or capabilities that Claude can invoke
-- when classifying or drafting updates (prompt templates, tools).
-- ============================================================
create table skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  prompt_template text, -- the system/user prompt template
  input_schema jsonb, -- expected input shape
  output_schema jsonb, -- expected output shape
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- CONTEXT_DOCS
-- Reference documents attached to a project that Claude can
-- use when classifying events or drafting updates.
-- ============================================================
create table context_docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  content text not null,
  doc_type text not null default 'general' check (doc_type in ('general', 'prd', 'meeting_notes', 'slack_thread', 'design_doc', 'runbook')),
  source_url text,
  embedding vector(1536), -- for semantic search (requires pgvector)
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_context_docs_project on context_docs (project_id);
create index idx_context_docs_type on context_docs (doc_type);

-- ============================================================
-- UPDATE_HISTORY
-- Drafts and sent stakeholder updates, generated by Claude.
-- ============================================================
create table update_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stakeholder_id uuid references stakeholders(id) on delete set null,
  title text not null,
  body text not null, -- markdown content
  format text not null default 'markdown' check (format in ('markdown', 'slack', 'email', 'plain')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed')),
  event_ids uuid[] default '{}', -- events summarized in this update
  sent_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_update_history_project on update_history (project_id);
create index idx_update_history_status on update_history (status);
create index idx_update_history_stakeholder on update_history (stakeholder_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- Auto-set updated_at on every row modification.
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated before update on projects for each row execute function set_updated_at();
create trigger trg_stakeholders_updated before update on stakeholders for each row execute function set_updated_at();
create trigger trg_events_updated before update on events for each row execute function set_updated_at();
create trigger trg_skills_updated before update on skills for each row execute function set_updated_at();
create trigger trg_context_docs_updated before update on context_docs for each row execute function set_updated_at();
create trigger trg_update_history_updated before update on update_history for each row execute function set_updated_at();

-- ============================================================
-- SEED: Default classification skill
-- ============================================================
insert into skills (name, description, prompt_template) values (
  'classify_event',
  'Classify an incoming event and route it to the correct project',
  E'You are a project intelligence assistant. Given an incoming event, determine:\n1. Which project it belongs to (from the list provided)\n2. The event category: meeting, task, decision, blocker, update, idea, followup, note\n3. A confidence score (0.0–1.0)\n4. Which stakeholders are mentioned or involved\n\nRespond with JSON: { "project_id": "...", "category": "...", "confidence": 0.95, "stakeholder_ids": [...], "title": "...", "summary": "..." }'
),
(
  'draft_update',
  'Draft a stakeholder update summarizing recent project events',
  E'You are a project intelligence assistant. Given a list of recent events for a project, draft a concise stakeholder update.\n\nThe update should:\n- Lead with the most important items\n- Group by category (decisions, blockers, progress)\n- Be written in a professional but concise tone\n- Include action items if any\n\nRespond with JSON: { "title": "...", "body": "..." }'
);
