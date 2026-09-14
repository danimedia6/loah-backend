-- Block 5.1.7: allow gifts to originate from a story or directly from a social card.
-- Runtime must store the resolved venue on gifts; existing story gifts are backfilled.

alter table public.gifts
  add column if not exists venue_id bigint;

update public.gifts g
set venue_id = s.venue_id
from public.stories s
where g.story_id = s.id
  and g.venue_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gifts_venue_id_fkey'
      and conrelid = 'public.gifts'::regclass
  ) then
    alter table public.gifts
      add constraint gifts_venue_id_fkey
      foreign key (venue_id) references public.venues(id)
      on update cascade on delete restrict;
  end if;
end;
$$;

alter table public.gifts
  alter column story_id drop not null;

create index if not exists idx_gifts_venue_id
  on public.gifts(venue_id);

create index if not exists idx_gifts_direct_pending
  on public.gifts(sender_id, receiver_id, product_id, venue_id, status)
  where story_id is null and status = 'pending';

comment on column public.gifts.venue_id is
  'Venue resolved when the gift is created. For story gifts, copied from stories. For direct gifts, supplied by authenticated runtime context.';
