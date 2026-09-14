-- Block 5 presence foundation.
-- This migration only prepares schema. Runtime presence logic remains unchanged.

alter table public.user_presence
  add column if not exists venue_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_presence_venue_id_fkey'
      and conrelid = 'public.user_presence'::regclass
  ) then
    alter table public.user_presence
      add constraint user_presence_venue_id_fkey
      foreign key (venue_id) references public.venues(id)
      on update cascade on delete cascade;
  end if;
end;
$$;

create index if not exists idx_user_presence_venue_id
  on public.user_presence(venue_id);

do $$
begin
  if exists (
    select 1
    from public.user_presence
    where venue_id is not null
    group by user_id, venue_id
    having count(*) > 1
  ) then
    raise exception 'Cannot create unique index user_presence_user_id_venue_id_key: duplicate user_id + venue_id rows exist.';
  end if;
end;
$$;

create unique index if not exists user_presence_user_id_venue_id_key
  on public.user_presence(user_id, venue_id);

alter table public.venues
  add column if not exists timezone text not null default 'America/Bogota',
  add column if not exists weekly_hours jsonb not null default
    '{
      "mon": {"closed": false, "open": "00:00", "close": "23:59"},
      "tue": {"closed": false, "open": "00:00", "close": "23:59"},
      "wed": {"closed": false, "open": "00:00", "close": "23:59"},
      "thu": {"closed": false, "open": "00:00", "close": "23:59"},
      "fri": {"closed": false, "open": "00:00", "close": "23:59"},
      "sat": {"closed": false, "open": "00:00", "close": "23:59"},
      "sun": {"closed": false, "open": "00:00", "close": "23:59"}
    }'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'venues_weekly_hours_is_object'
      and conrelid = 'public.venues'::regclass
  ) then
    alter table public.venues
      add constraint venues_weekly_hours_is_object
      check (jsonb_typeof(weekly_hours) = 'object');
  end if;
end;
$$;

comment on column public.venues.timezone is
  'IANA timezone used by backend presence calculations. Default keeps current Colombia venues compatible.';

comment on column public.venues.weekly_hours is
  'JSON object keyed by mon,tue,wed,thu,fri,sat,sun. Each value: {"closed": boolean, "open": "HH:MM", "close": "HH:MM"}. If close is less than or equal to open, backend treats close as next day.';

create table if not exists public.venue_access_tokens (
  id bigserial primary key,
  venue_id bigint not null references public.venues(id) on update cascade on delete cascade,
  token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint venue_access_tokens_token_hash_key unique (token_hash),
  constraint venue_access_tokens_expires_after_issued check (expires_at > issued_at),
  constraint venue_access_tokens_revoked_after_issued check (revoked_at is null or revoked_at >= issued_at)
);

create index if not exists idx_venue_access_tokens_venue_id
  on public.venue_access_tokens(venue_id);

create index if not exists idx_venue_access_tokens_expires_at
  on public.venue_access_tokens(expires_at);

create index if not exists idx_venue_access_tokens_active_by_venue
  on public.venue_access_tokens(venue_id, expires_at)
  where revoked_at is null;

comment on table public.venue_access_tokens is
  'Rotating QR access tokens for venue presence validation. Store token hashes only; backend service role owns creation and validation.';

create table if not exists public.venue_presence_sessions (
  id bigserial primary key,
  user_id bigint not null references public.usuarios(id_usuario) on update cascade on delete cascade,
  venue_id bigint not null references public.venues(id) on update cascade on delete cascade,
  access_token_id bigint not null references public.venue_access_tokens(id) on update cascade on delete cascade,
  table_id bigint references public.mesas(id_mesa) on update cascade on delete set null,
  validated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  valid_until timestamptz not null,
  hard_expires_at timestamptz not null,
  status text not null default 'active',
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_presence_sessions_status_check check (status in ('active', 'expired', 'ended')),
  constraint venue_presence_sessions_valid_window_check check (valid_until <= hard_expires_at),
  constraint venue_presence_sessions_activity_window_check check (
    last_activity_at >= validated_at
    and valid_until >= last_activity_at
  ),
  constraint venue_presence_sessions_ended_at_check check (
    (status = 'ended' and ended_at is not null)
    or (status <> 'ended')
  )
);

create unique index if not exists venue_presence_sessions_one_active_per_user_venue
  on public.venue_presence_sessions(user_id, venue_id)
  where status = 'active';

create index if not exists idx_venue_presence_sessions_user_venue
  on public.venue_presence_sessions(user_id, venue_id);

create index if not exists idx_venue_presence_sessions_venue_status
  on public.venue_presence_sessions(venue_id, status);

create index if not exists idx_venue_presence_sessions_valid_until
  on public.venue_presence_sessions(valid_until);

create index if not exists idx_venue_presence_sessions_active_lookup
  on public.venue_presence_sessions(user_id, venue_id, valid_until, hard_expires_at)
  where status = 'active';

create index if not exists idx_venue_presence_sessions_access_token_id
  on public.venue_presence_sessions(access_token_id);

create or replace function public.set_venue_presence_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_venue_presence_sessions_updated_at on public.venue_presence_sessions;
create trigger trg_venue_presence_sessions_updated_at
before update on public.venue_presence_sessions
for each row execute function public.set_venue_presence_sessions_updated_at();

comment on table public.venue_presence_sessions is
  'Validated physical presence sessions created after QR validation. This becomes the backend source of truth for venue presence.';

comment on column public.venue_presence_sessions.valid_until is
  'Rolling presence expiration, normally last_activity_at plus 30 minutes, capped by hard_expires_at.';

comment on column public.venue_presence_sessions.hard_expires_at is
  'Absolute session cap, expected to be computed from venue closing time plus 30 minutes.';
