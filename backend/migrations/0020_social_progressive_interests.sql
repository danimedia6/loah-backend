-- Block 5.3: progressive interest system.
-- Likes remain unilateral. Mutual interests are stored separately and never create chat.

create table if not exists public.social_profile_likes (
  id bigserial primary key,
  venue_id bigint not null references public.venues(id) on update cascade on delete cascade,
  sender_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  receiver_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  photo_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profile_likes_no_self_like check (sender_id <> receiver_id),
  constraint social_profile_likes_unique_pair unique (venue_id, sender_id, receiver_id)
);

create index if not exists idx_social_profile_likes_sender
  on public.social_profile_likes(sender_id);

create index if not exists idx_social_profile_likes_receiver
  on public.social_profile_likes(receiver_id);

create index if not exists idx_social_profile_likes_venue_receiver
  on public.social_profile_likes(venue_id, receiver_id);

create table if not exists public.social_mutual_interests (
  id bigserial primary key,
  venue_id bigint not null references public.venues(id) on update cascade on delete cascade,
  user_a_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  user_b_id bigint not null references public.usuarios(id_usuario) on delete cascade,
  level text not null,
  source_type text not null,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_mutual_interests_ordered_pair check (user_a_id < user_b_id),
  constraint social_mutual_interests_level_check check (level in ('story_mutual', 'profile_mutual')),
  constraint social_mutual_interests_source_type_check check (source_type in ('story_reaction', 'profile_like', 'gallery_like')),
  constraint social_mutual_interests_unique_pair_level unique (venue_id, user_a_id, user_b_id, level)
);

create index if not exists idx_social_mutual_interests_user_a
  on public.social_mutual_interests(user_a_id);

create index if not exists idx_social_mutual_interests_user_b
  on public.social_mutual_interests(user_b_id);

create index if not exists idx_social_mutual_interests_venue_level
  on public.social_mutual_interests(venue_id, level);

comment on table public.social_profile_likes is
  'Unilateral profile/gallery interest signals. One active sender to receiver like per venue.';

comment on table public.social_mutual_interests is
  'Matched progressive social interest by normalized user pair and venue. Does not create chat.';
