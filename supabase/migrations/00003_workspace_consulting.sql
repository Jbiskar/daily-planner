-- Replace 'general' with 'consulting' as a first-class workspace
alter type workspace add value if not exists 'consulting';

-- Existing auto-classified 'general' rows were a catch-all; null them so the
-- user can re-categorize into the new four-way taxonomy.
update events set workspace = null where workspace = 'general';
