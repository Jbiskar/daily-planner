-- Idempotency for source-driven ingestion (Granola, Slack, Notion, etc.).
-- The Granola ingestion handler relies on ON CONFLICT (source, source_id) to
-- dedupe both archive rows (source_id = note.id) and task cards
-- (source_id = note.id || '#' || action_item_index).
alter table events
  add constraint events_source_source_id_key unique (source, source_id);
