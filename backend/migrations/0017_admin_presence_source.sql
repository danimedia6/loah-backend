alter table public.venue_presence_sessions
  alter column access_token_id drop not null;

alter table public.venue_presence_sessions
  add column if not exists source text;

alter table public.venue_presence_sessions
  alter column source set default 'qr';

update public.venue_presence_sessions
set source = 'qr'
where source is null;

alter table public.venue_presence_sessions
  alter column source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'venue_presence_sessions_source_check'
      and conrelid = 'public.venue_presence_sessions'::regclass
  ) then
    alter table public.venue_presence_sessions
      add constraint venue_presence_sessions_source_check
      check (source in ('qr', 'venue_admin'));
  end if;
end;
$$;

comment on column public.venue_presence_sessions.source is
  'Origin of the presence session. qr means validated by a QR token; venue_admin means automatic presence for the authenticated admin of the same venue.';
