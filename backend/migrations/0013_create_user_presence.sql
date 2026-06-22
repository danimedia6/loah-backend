create table if not exists public.user_presence (
  id bigserial primary key,
  user_id bigint not null,
  table_id bigint not null,
  last_heartbeat_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_presence_user_id_fkey
    foreign key (user_id) references public.usuarios(id_usuario)
    on update cascade on delete cascade,
  constraint user_presence_table_id_fkey
    foreign key (table_id) references public.mesas(id_mesa)
    on update cascade on delete cascade
);

create index if not exists idx_user_presence_user_id on public.user_presence(user_id);
create index if not exists idx_user_presence_table_id on public.user_presence(table_id);
create index if not exists idx_user_presence_last_heartbeat_at on public.user_presence(last_heartbeat_at);

create or replace function public.set_user_presence_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_presence_updated_at on public.user_presence;
create trigger trg_user_presence_updated_at
before update on public.user_presence
for each row execute function public.set_user_presence_updated_at();