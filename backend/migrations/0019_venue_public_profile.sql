-- Parenthesis Venue V3.1: public venue profile fields.

alter table public.venues
  add column if not exists description text,
  add column if not exists logo_url text,
  add column if not exists cover_url text,
  add column if not exists address text,
  add column if not exists slug text,
  add column if not exists instagram text,
  add column if not exists updated_at timestamptz;

update public.venues
set slug = coalesce(
  nullif(
    trim(
      both '-' from regexp_replace(
        regexp_replace(lower(coalesce(name, 'venue-' || id::text)), '[^a-z0-9]+', '-', 'g'),
        '-+',
        '-',
        'g'
      )
    ),
    ''
  ),
  'venue-' || id::text
)
where slug is null or trim(slug) = '';

update public.venues
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.venues
  alter column slug set not null,
  alter column updated_at set not null;

create unique index if not exists venues_slug_key
  on public.venues(slug);

comment on column public.venues.description is
  'Public description shown on the venue profile.';

comment on column public.venues.logo_url is
  'Public logo image URL for the venue.';

comment on column public.venues.cover_url is
  'Public cover image URL for the venue.';

comment on column public.venues.slug is
  'Stable public identifier generated from the venue name.';
