-- Stores OAuth tokens for Google Calendar integration.
-- Single-user app: one row per google account (keyed by email).
create table google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  access_token text not null,
  refresh_token text not null,
  scope text not null,
  token_type text not null default 'Bearer',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_google_oauth_tokens_email on google_oauth_tokens (email);
