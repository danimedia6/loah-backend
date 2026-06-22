create table if not exists public.social_user_blocks (
  id bigserial primary key,
  blocker_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  blocked_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_user_blocks_no_self_block check (blocker_id <> blocked_id),
  constraint social_user_blocks_unique_pair unique (blocker_id, blocked_id)
);

create index if not exists idx_social_user_blocks_blocker on public.social_user_blocks(blocker_id);
create index if not exists idx_social_user_blocks_blocked on public.social_user_blocks(blocked_id);

create table if not exists public.social_reports (
  id bigserial primary key,
  reporter_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  reported_user_id bigint references public.usuarios(id_usuario) on delete set null,
  target_type text not null check (target_type in ('profile', 'message')),
  target_id bigint not null,
  reason text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'blocked', 'dismissed')),
  reviewed_by bigint references public.usuarios(id_usuario) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_reports_no_self_profile_report check (reported_user_id is null or reporter_id <> reported_user_id)
);

create index if not exists idx_social_reports_status_created on public.social_reports(status, created_at desc);
create index if not exists idx_social_reports_reporter on public.social_reports(reporter_id);
create index if not exists idx_social_reports_reported_user on public.social_reports(reported_user_id);
create index if not exists idx_social_reports_target on public.social_reports(target_type, target_id);