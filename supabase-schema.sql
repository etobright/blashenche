create table if not exists public.blashenche_users (
  sub text primary key,
  name text,
  email text,
  picture text,
  login_count integer not null default 0,
  session_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.blashenche_events (
  id bigint generated always as identity primary key,
  type text not null,
  sub text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists blashenche_events_created_at_idx
  on public.blashenche_events (created_at desc);

create index if not exists blashenche_users_last_seen_at_idx
  on public.blashenche_users (last_seen_at desc);

create table if not exists public.blashenche_feedback (
  id bigint generated always as identity primary key,
  name text,
  email text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists blashenche_feedback_created_at_idx
  on public.blashenche_feedback (created_at desc);
