-- Parenthesis Venue V2: isolate products and tables by venue.
-- Preflight confirmed the current data belongs to venue 1.

alter table public.productos
  add column if not exists venue_id bigint;

update public.productos
set venue_id = 1
where venue_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'productos_venue_id_fkey'
      and conrelid = 'public.productos'::regclass
  ) then
    alter table public.productos
      add constraint productos_venue_id_fkey
      foreign key (venue_id) references public.venues(id)
      on update cascade
      on delete restrict;
  end if;
end $$;

alter table public.productos
  alter column venue_id set not null;

create index if not exists idx_productos_venue_id
  on public.productos(venue_id);

create index if not exists idx_productos_venue_disponible
  on public.productos(venue_id, disponible);

create index if not exists idx_productos_venue_categoria
  on public.productos(venue_id, id_categoria);

alter table public.mesas
  add column if not exists venue_id bigint;

update public.mesas
set venue_id = 1
where venue_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mesas_venue_id_fkey'
      and conrelid = 'public.mesas'::regclass
  ) then
    alter table public.mesas
      add constraint mesas_venue_id_fkey
      foreign key (venue_id) references public.venues(id)
      on update cascade
      on delete restrict;
  end if;
end $$;

alter table public.mesas
  alter column venue_id set not null;

create index if not exists idx_mesas_venue_id
  on public.mesas(venue_id);
