-- Task card fields on events
create type workspace as enum ('personal', 'atlan', 'landit', 'general');
create type task_priority as enum ('high', 'medium', 'low');
create type task_status as enum ('inbox', 'active', 'done', 'dismissed');

alter table events
  add column workspace workspace,
  add column priority task_priority,
  add column due_date timestamptz,
  add column notes text,
  add column links text[] not null default '{}',
  add column task_status task_status not null default 'inbox';

create index idx_events_task_status on events (task_status);
create index idx_events_workspace on events (workspace);
create index idx_events_priority on events (priority);
create index idx_events_due_date on events (due_date);
