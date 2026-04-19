# Granola Ingestion — Build Plan

Ingest Granola meeting notes into the Daily Planner across three flows: historic backfill (once), per-meeting (ongoing), and daily safety-net review. Each meeting can spawn 0–N task cards — one per action item assigned to Jake.

**Prerequisite:** complete `TASK_CARDS_PLAN.md` first. This plan assumes the `events` table has `workspace`, `priority`, `due_date`, `notes`, `links`, and `task_status` columns, and that Inbox → Active → Done staging is working.

## API essentials

- Base: `https://public-api.granola.ai`
- Auth: `Authorization: Bearer grn_...` (key lives in `.env.local` as `GRANOLA_API_KEY`, already stubbed)
- `GET /v1/notes?created_after=<ISO>&cursor=<c>&page_size=30` — list
- `GET /v1/notes/{id}?include=transcript` — detail (summary_markdown + attendees + calendar_event + transcript)
- Rate limits: 5 req/sec sustained, 25 burst/5s — throttle to 4 req/sec to stay safe
- Only returns notes with a generated AI summary (no in-progress races)

## Decisions already made

- **No webhooks** (API doesn't support them). All flows are **polling-based**.
- **One task card per action item**, not per meeting. Meetings themselves are stored as archive rows with `task_status='dismissed'`.
- **Workspace inference is rule-based** (by attendee email domain), not a Claude call. `@atlan.com` → atlan; `@justlandit.com` → landit; personal Gmail → personal; mixed/unknown → general.
- **Dedupe key:** `source='granola'`, `source_id=note.id` for archive rows; `source_id=note.id + '#' + action_item_index` for task cards. No schema change needed — uses existing `(source, source_id)` uniqueness pattern.
- **Transcript not stored in DB.** Only `summary_markdown` goes into `body`. Transcripts re-fetched on demand when user clicks a task detail.

## Shared ingestion handler

Upgrade `src/app/api/webhooks/granola/route.ts` to accept a detailed Granola note payload (not just a webhook signature). This handler is called by all three flows (Flow 1 via script, Flows 2 and 3 via n8n).

Responsibilities:
1. Upsert attendees → `stakeholders` table (by email). Collect `stakeholder_ids[]`.
2. Upsert archive row: `events` with `source='granola'`, `source_id=note.id`, `title=note.title`, `body=note.summary_markdown`, `raw_payload=note`, `occurred_at=calendar_event.scheduled_start_time`, `stakeholder_ids`, `task_status='dismissed'`, `workspace=<inferred>`.
3. Call Claude with the action-item extraction prompt (below). Expect JSON array.
4. For each action item, insert a task card: `source='granola'`, `source_id='${note.id}#${idx}'`, `task_status='inbox'`, `workspace=<inferred>`, the stakeholders from step 1, `links=[note.web_url]`, plus title/priority/due_date/notes from Claude.
5. For Flow 3 (daily review), accept an `excludeExistingActionItems: true` flag that fetches existing task cards from this `note.id` first and passes their titles to Claude in the system prompt so Claude only proposes NEW items.

Use `ON CONFLICT (source, source_id) DO UPDATE` for idempotent replays.

## Action-item extraction prompt (for `src/lib/classify.ts`, new function `extractActionItems`)

```
You are reading meeting notes. Extract ONLY action items that Jake (owner email: {{jakeEmail}}) is responsible for completing — not items assigned to others.

For each action item, return:
- title: short imperative phrase ("Send Q3 deck to Sarah")
- priority: "high" | "medium" | "low" based on urgency signals ("ASAP", "blocker", "when you have time")
- due_date: ISO 8601 or null — parse "by Friday", "EOD", "next week", etc.
- notes: 1–3 sentences on what specifically needs to happen and any context
- stakeholder_emails: array of attendee emails relevant to this specific action

Meeting: {{note.title}}
Attendees: {{attendees}}
Summary: {{summary_markdown}}

Respond with ONLY a JSON array: [{ "title": "...", "priority": "...", "due_date": "...", "notes": "...", "stakeholder_emails": ["..."] }]. Return [] if there are no action items for Jake.
```

For Flow 3, prepend: `Items already extracted from this meeting (do NOT duplicate):\n{{existing_titles}}\n\nReturn only new items.`

## Flow 1 — Historic backfill (one-shot)

### 1a. Raw ingestion script

Create `scripts/backfill-granola.ts`:

```ts
// Pseudo-outline
const sixMonthsAgo = new Date(Date.now() - 180 * 86400 * 1000).toISOString();
let cursor: string | null = null;
const throttle = rateLimit({ interval: 250 }); // 4 req/sec

do {
  const list = await granolaGet(`/v1/notes?created_after=${sixMonthsAgo}&page_size=30${cursor ? `&cursor=${cursor}` : ''}`);
  for (const summary of list.notes) {
    await throttle();
    const note = await granolaGet(`/v1/notes/${summary.id}`); // skip transcript to halve calls
    await fetch('http://localhost:3000/api/webhooks/granola', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY },
      body: JSON.stringify({ note, mode: 'backfill' })
    });
  }
  cursor = list.cursor;
} while (list.hasMore);
```

Run with `npx tsx scripts/backfill-granola.ts`. Expect 10–20 min for ~900–1800 notes.

**Backfill mode difference:** pass `mode: 'backfill'` to the handler — it should **skip action-item extraction** and only create the archive row. This keeps the Inbox from flooding with 6 months of ToDos. Archive remains searchable.

### 1b. Historic synthesized summary

Create a second script `scripts/granola-historic-digest.ts`:
- Group archive events by month (6 buckets).
- For each bucket: send summaries (not transcripts) to Claude with prompt: *"Identify key themes, major decisions, recurring stakeholders, projects, dangling action items that were never closed. Output markdown."*
- Combine the 6 monthly digests into one meta-summary with a final Claude call.
- Store the meta-summary in `context_docs` (create a project named "Historic digest — last 6 months" first to satisfy FK). `doc_type='general'`.

Later, render at `/dashboard/history` (new page, out of scope for this doc — add when ready).

## Flow 2 — Per-meeting (ongoing)

**n8n workflow** (Jake's stack):

| Node | Config |
|------|--------|
| Schedule Trigger | every 15 minutes |
| HTTP Request | `GET https://public-api.granola.ai/v1/notes?updated_after={{$node["Schedule Trigger"].json["staticData"]["lastPoll"] || ISO(now - 15min)}}` with `Authorization: Bearer {{$env.GRANOLA_API_KEY}}` |
| Split In Batches | size 1 |
| HTTP Request | `GET /v1/notes/{{$json.id}}?include=transcript` |
| HTTP Request | `POST {{$env.APP_URL}}/api/webhooks/granola` body: `{ note: $json, mode: 'live' }` with `x-api-key` |
| Set | update Static Data `lastPoll = now` |

**Alternative** (no n8n): `src/app/api/cron/granola-poll/route.ts` hit by Vercel Cron with `*/15 * * * *` — same logic inline. Recommend n8n if you want retry/observability; inline if you want one codebase.

Handler mode `'live'` = full treatment (archive row + task card extraction).

## Flow 3 — Daily review (safety net)

**n8n workflow** at 6pm daily (preference confirmed? if not, swap timing):

| Node | Config |
|------|--------|
| Schedule Trigger | `0 18 * * *` |
| HTTP Request | `GET /v1/notes?created_after={{ISO(todayMidnight)}}` |
| Loop batch | fetch detail for each |
| HTTP Request | `POST /api/cron/granola-daily-review` with `{ notes: [...] }` |

Create `src/app/api/cron/granola-daily-review/route.ts`:
- For each note, look up existing task cards where `source_id LIKE '${note.id}#%'`.
- Pass their titles to the action-item prompt (Flow 3 variant) as "already extracted".
- Insert any new ones with `metadata.source_flow='daily_review'` so you can filter them in the UI.

Post a summary to Slack optionally (you already have Slack webhooks): *"Daily review: scanned X meetings, found Y new action items, added to Inbox."*

## Files to create

1. `scripts/backfill-granola.ts` — Flow 1a
2. `scripts/granola-historic-digest.ts` — Flow 1b
3. `src/app/api/cron/granola-daily-review/route.ts` — Flow 3 handler
4. `src/lib/granola.ts` — shared: `granolaGet(path)`, `inferWorkspace(attendees)`, `upsertAttendees(attendees)`, `extractActionItems(note, options)`
5. `src/lib/classify.ts` — add `extractActionItems()` function using the prompt above. Keep it separate from `classifyEvent()`; different job.

## Files to modify

1. `src/app/api/webhooks/granola/route.ts` — replace stub with the full handler described in "Shared ingestion handler". Accept `{ note, mode: 'live' | 'backfill' }` body.
2. `.env.local` — confirm `GRANOLA_API_KEY` is populated; add `APP_URL` for n8n callbacks if not present.
3. `src/types/database.ts` — no changes needed (reusing metadata JSONB).

## Open design decisions to confirm before building

1. **Daily review timing:** 6pm (EOD) or 7am next morning (with coffee)?
2. **Flow 1c — dangling TODOs sweep:** should backfill also extract unfinished action items from the last 6 months into a "maybe do" Inbox batch, or archive-only? My rec: archive-only. Anything important would have resurfaced.
3. **Jake's email identification:** Claude needs to know which attendee is Jake to assign action items correctly. Store `JAKE_EMAILS=jake@atlan.com,jake@justlandit.com,<personal>@gmail.com` in `.env.local` and pass into the extractor prompt.
4. **Priority of action-item extraction** when conflict: if a meeting has one item assigned to Jake as co-owner with Sarah, does it count? Rec: yes, include but note co-owner in `notes`.

## Verification before calling it done

**Flow 2 (build first):**
- Manually trigger the n8n workflow after a test meeting ends in Granola.
- Confirm: one archive row in events with `task_status='dismissed'`, `source='granola'`, `source_id=not_...`.
- Confirm: 0–N task cards in Inbox with `source_id='not_...#0'`, etc.
- Confirm: stakeholders table populated from attendees.
- Confirm: link in task points to `note.web_url`.
- Confirm: replay doesn't create duplicates (idempotency).

**Flow 3 (build second):**
- Run the daily review handler manually against today's meetings.
- Confirm: no duplicates of Flow 2 items.
- Confirm: new items (if any) land in Inbox with `metadata.source_flow='daily_review'`.

**Flow 1 (build last):**
- Run backfill script against a 7-day window first to sanity-check.
- Confirm: all meetings appear as archive rows, no Inbox spam.
- Then run full 6-month backfill.
- Then generate historic digest and review output quality before productionizing a page.

## Build order

1. `src/lib/granola.ts` helpers + `extractActionItems()` in classify.ts — no external dependencies, easy to unit test.
2. `/api/webhooks/granola` handler — wire Flow 2's "live" mode. Test with a single real meeting from Granola.
3. n8n workflow for Flow 2 — 15-min polling.
4. `/api/cron/granola-daily-review` + n8n workflow for Flow 3.
5. `scripts/backfill-granola.ts` with 7-day smoke test → then full 6-month run.
6. `scripts/granola-historic-digest.ts` — last, since it's the most tokens.

## Context pointers for Claude

- `TASK_CARDS_PLAN.md` — must be implemented first; defines the task_status, workspace, priority columns this plan writes into.
- `src/lib/classify.ts` — existing classifier patterns to mirror.
- `src/app/api/voice/route.ts` — reference implementation of "ingest → classify → respond" flow.
- `supabase/migrations/00001_initial_schema.sql` — stakeholders and events table definitions.
- `.env.local` — `GRANOLA_API_KEY` already present; do not commit.
