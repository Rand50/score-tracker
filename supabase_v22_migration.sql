-- =============================================================================
-- TallyIt (Score Tracker) — v22 Migration (Idempotent)
-- Target Supabase project: lezfdnqqfejqyxqwlcfg
-- Safe to run multiple times in the Supabase SQL Editor (after v20 migration).
-- Adds:
--   1. Requester Built Notifications on public.game_requests:
--      - dismissed_at timestamptz column
--      - Updated submit_game_request(p_game_name, p_website_url, p_requester_email) [anon + auth]
--      - get_my_built_notifications() [auth]
--      - dismiss_built_notification(p_id uuid) [auth]
--   2. Community-Published Variations:
--      - public.community_variations table + RLS
--      - publish_custom_variation(...) [anon + auth]
--      - list_community_variations(p_game_key default null) [anon + auth]
--      - moderate_community_variation(p_id uuid, p_is_hidden boolean) [admin-only]
--   3. Updated get_admin_stats() including community_variations (latest 50, incl. hidden)
-- =============================================================================

create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated;

-- Ensure admin guard exists even if run standalone
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt()->>'email', '')) = 'randw50@gmail.com';
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Requester Built Notifications (extends public.game_requests)
-- -----------------------------------------------------------------------------
alter table public.game_requests
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_game_requests_built_notif_uid
  on public.game_requests (requester_id, updated_at desc)
  where status = 'built' and dismissed_at is null;

create index if not exists idx_game_requests_built_notif_email
  on public.game_requests (lower(requester_email), updated_at desc)
  where status = 'built' and dismissed_at is null and requester_email is not null;

-- Drop old 2-arg signature so PostgREST never hits ambiguous overload (PGRST203)
drop function if exists public.submit_game_request(text, text);

create or replace function public.submit_game_request(
  p_game_name text,
  p_website_url text default null,
  p_requester_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_game_name, ''));
  v_url text := nullif(trim(coalesce(p_website_url, '')), '');
  v_uid uuid := auth.uid();
  v_jwt_email text := nullif(lower(trim(coalesce(auth.jwt()->>'email', ''))), '');
  v_supplied_email text := nullif(lower(trim(coalesce(p_requester_email, ''))), '');
  v_email text;
  v_row public.game_requests%rowtype;
begin
  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please enter a game name (at least 2 characters).');
  end if;

  if length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'Game name must be 120 characters or fewer.');
  end if;

  if v_url is not null then
    if length(v_url) > 500 then
      return jsonb_build_object('ok', false, 'error', 'Website link is too long (max 500 characters).');
    end if;

    if v_url !~* '^https?://' then
      if v_url ~* '^[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' then
        v_url := 'https://' || v_url;
      else
        return jsonb_build_object('ok', false, 'error', 'Website link must start with http:// or https://.');
      end if;
    end if;
  end if;

  -- Signed-in users auto-capture their verified JWT email; guests may optionally supply one
  if v_jwt_email is not null then
    v_email := v_jwt_email;
  elsif v_supplied_email is not null then
    if length(v_supplied_email) > 254 or v_supplied_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
      return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address or leave it blank.');
    end if;
    v_email := v_supplied_email;
  else
    v_email := null;
  end if;

  insert into public.game_requests (game_name, website_url, requester_id, requester_email, status)
  values (v_name, v_url, v_uid, v_email, 'new')
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'id', v_row.id,
      'game_name', v_row.game_name,
      'website_url', v_row.website_url,
      'requester_email', v_row.requester_email,
      'status', v_row.status,
      'dismissed_at', v_row.dismissed_at,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function public.submit_game_request(text, text, text) from public;
grant execute on function public.submit_game_request(text, text, text) to anon, authenticated;

-- Fetch undismissed "built" notifications for the signed-in user
create or replace function public.get_my_built_notifications()
returns table (
  id uuid,
  game_name text,
  website_url text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(lower(trim(coalesce(auth.jwt()->>'email', ''))), '');
begin
  if v_uid is null and v_email is null then
    return;
  end if;

  return query
  select
    r.id,
    r.game_name,
    r.website_url,
    r.status,
    r.created_at,
    r.updated_at
  from public.game_requests r
  where r.status = 'built'
    and r.dismissed_at is null
    and (
      (v_uid is not null and r.requester_id = v_uid)
      or (v_email is not null and lower(coalesce(r.requester_email, '')) = v_email)
    )
  order by r.updated_at desc, r.created_at desc
  limit 25;
end;
$$;

revoke all on function public.get_my_built_notifications() from public;
grant execute on function public.get_my_built_notifications() to authenticated;

-- Dismiss one built notification if owned by the signed-in caller
create or replace function public.dismiss_built_notification(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(lower(trim(coalesce(auth.jwt()->>'email', ''))), '');
  v_dismissed_at timestamptz;
begin
  if v_uid is null and v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Authentication required.');
  end if;

  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing notification id.');
  end if;

  update public.game_requests r
  set dismissed_at = now()
  where r.id = p_id
    and r.status = 'built'
    and (
      (v_uid is not null and r.requester_id = v_uid)
      or (v_email is not null and lower(coalesce(r.requester_email, '')) = v_email)
    )
  returning r.dismissed_at into v_dismissed_at;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Notification not found or not owned by caller.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'dismissed_at', v_dismissed_at
  );
end;
$$;

revoke all on function public.dismiss_built_notification(uuid) from public;
grant execute on function public.dismiss_built_notification(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Community-Published Variations (public.community_variations)
-- -----------------------------------------------------------------------------
create table if not exists public.community_variations (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (length(trim(game_key)) between 1 and 60),
  slug text not null check (length(trim(slug)) between 1 and 120),
  name text not null check (length(trim(name)) between 2 and 80),
  tagline text check (tagline is null or length(tagline) <= 160),
  differences jsonb not null default '[]'::jsonb check (jsonb_typeof(differences) = 'array'),
  scoring_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring_overrides) = 'object'),
  author_id uuid references auth.users(id) on delete set null,
  author_name text check (author_name is null or length(author_name) <= 60),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_community_variations_game_slug
  on public.community_variations (game_key, slug);

create index if not exists idx_community_variations_visible_game
  on public.community_variations (game_key, created_at desc)
  where is_hidden = false;

create index if not exists idx_community_variations_created_at
  on public.community_variations (created_at desc);

alter table public.community_variations enable row level security;

drop policy if exists "community_variations_public_select" on public.community_variations;
create policy "community_variations_public_select" on public.community_variations
  for select to anon, authenticated
  using (is_hidden = false or public.is_admin());

drop policy if exists "community_variations_admin_update" on public.community_variations;
create policy "community_variations_admin_update" on public.community_variations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "community_variations_admin_delete" on public.community_variations;
create policy "community_variations_admin_delete" on public.community_variations
  for delete to authenticated
  using (public.is_admin());

-- Publish a community variation (callable by BOTH anon and authenticated)
create or replace function public.publish_custom_variation(
  p_game_key text,
  p_name text,
  p_tagline text default null,
  p_differences jsonb default '[]'::jsonb,
  p_scoring_overrides jsonb default '{}'::jsonb,
  p_author_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game text := lower(trim(coalesce(p_game_key, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_tagline text := nullif(trim(coalesce(p_tagline, '')), '');
  v_diffs jsonb := coalesce(p_differences, '[]'::jsonb);
  v_overrides jsonb := coalesce(p_scoring_overrides, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_author text := nullif(trim(coalesce(p_author_name, '')), '');
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
  v_row public.community_variations%rowtype;
begin
  if length(v_game) < 1 or length(v_game) > 60 then
    return jsonb_build_object('ok', false, 'error', 'Invalid game key.');
  end if;

  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Variation name must be at least 2 characters.');
  end if;

  if length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Variation name must be 80 characters or fewer.');
  end if;

  if v_tagline is not null and length(v_tagline) > 160 then
    return jsonb_build_object('ok', false, 'error', 'Tagline must be 160 characters or fewer.');
  end if;

  if jsonb_typeof(v_diffs) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Differences must be a JSON array.');
  end if;

  if jsonb_array_length(v_diffs) > 20 then
    return jsonb_build_object('ok', false, 'error', 'Please keep rule differences to 20 items or fewer.');
  end if;

  if jsonb_typeof(v_overrides) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'Scoring overrides must be a JSON object.');
  end if;

  if v_author is null and v_uid is not null then
    select nullif(trim(p.display_name), '')
    into v_author
    from public.profiles p
    where p.id = v_uid;
  end if;

  if v_author is not null and length(v_author) > 60 then
    v_author := left(v_author, 60);
  end if;

  -- Generate URL-safe unique slug per game_key
  v_base_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'variation';
  end if;
  v_base_slug := left(v_base_slug, 96);
  v_slug := v_base_slug;

  while exists (
    select 1 from public.community_variations cv
    where cv.game_key = v_game and cv.slug = v_slug
  ) loop
    v_suffix := v_suffix + 1;
    if v_suffix > 50 then
      v_slug := left(v_base_slug, 88) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
    v_slug := left(v_base_slug, 108) || '-' || v_suffix::text;
  end loop;

  insert into public.community_variations (
    game_key,
    slug,
    name,
    tagline,
    differences,
    scoring_overrides,
    author_id,
    author_name,
    is_hidden
  )
  values (
    v_game,
    v_slug,
    v_name,
    v_tagline,
    v_diffs,
    v_overrides,
    v_uid,
    v_author,
    false
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'variation', jsonb_build_object(
      'id', v_row.id,
      'game_key', v_row.game_key,
      'slug', v_row.slug,
      'name', v_row.name,
      'tagline', v_row.tagline,
      'differences', v_row.differences,
      'scoring_overrides', v_row.scoring_overrides,
      'author_id', v_row.author_id,
      'author_name', v_row.author_name,
      'is_hidden', v_row.is_hidden,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function public.publish_custom_variation(text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.publish_custom_variation(text, text, text, jsonb, jsonb, text) to anon, authenticated;

-- List visible community variations (callable by BOTH anon and authenticated)
create or replace function public.list_community_variations(
  p_game_key text default null
)
returns table (
  id uuid,
  game_key text,
  slug text,
  name text,
  tagline text,
  differences jsonb,
  scoring_overrides jsonb,
  author_id uuid,
  author_name text,
  is_hidden boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cv.id,
    cv.game_key,
    cv.slug,
    cv.name,
    cv.tagline,
    cv.differences,
    cv.scoring_overrides,
    cv.author_id,
    cv.author_name,
    cv.is_hidden,
    cv.created_at
  from public.community_variations cv
  where cv.is_hidden = false
    and (
      p_game_key is null
      or trim(p_game_key) = ''
      or cv.game_key = lower(trim(p_game_key))
    )
  order by cv.created_at desc
  limit 200;
$$;

revoke all on function public.list_community_variations(text) from public;
grant execute on function public.list_community_variations(text) to anon, authenticated;

-- Admin moderation RPC: hide or restore a community variation (randw50@gmail.com ONLY)
create or replace function public.moderate_community_variation(
  p_id uuid,
  p_is_hidden boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.community_variations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing variation id.');
  end if;

  update public.community_variations
  set is_hidden = coalesce(p_is_hidden, true)
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Community variation not found.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'variation', jsonb_build_object(
      'id', v_row.id,
      'game_key', v_row.game_key,
      'slug', v_row.slug,
      'name', v_row.name,
      'tagline', v_row.tagline,
      'differences', v_row.differences,
      'scoring_overrides', v_row.scoring_overrides,
      'author_id', v_row.author_id,
      'author_name', v_row.author_name,
      'is_hidden', v_row.is_hidden,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function public.moderate_community_variation(uuid, boolean) from public;
grant execute on function public.moderate_community_variation(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Updated get_admin_stats() — adds community_variations (latest 50, incl. hidden)
-- -----------------------------------------------------------------------------
create or replace function public.get_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals jsonb;
  v_by_game jsonb;
  v_by_variation jsonb;
  v_daily_30d jsonb;
  v_recent_requests jsonb;
  v_community_variations jsonb;
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_plays', (select count(*) from public.game_play_events),
    'plays_7d', (select count(*) from public.game_play_events where created_at >= v_now - interval '7 days'),
    'plays_30d', (select count(*) from public.game_play_events where created_at >= v_now - interval '30 days'),
    'shared_games_total', (select count(*) from public.games),
    'shared_games_7d', (select count(*) from public.games where created_at >= v_now - interval '7 days'),
    'shared_games_30d', (select count(*) from public.games where created_at >= v_now - interval '30 days'),
    'users_total', (select count(*) from public.profiles),
    'users_7d', (select count(*) from public.profiles where created_at >= v_now - interval '7 days'),
    'users_30d', (select count(*) from public.profiles where created_at >= v_now - interval '30 days'),
    'friendships_accepted', (select count(*) from public.friendships where status = 'accepted'),
    'friendships_pending', (select count(*) from public.friendships where status = 'pending'),
    'groups_total', (select count(*) from public.groups),
    'game_requests_total', (select count(*) from public.game_requests),
    'game_requests_new', (select count(*) from public.game_requests where status = 'new'),
    'community_variations_total', (select count(*) from public.community_variations),
    'community_variations_visible', (select count(*) from public.community_variations where is_hidden = false)
  ) into v_totals;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_by_game
  from (
    select
      e.game_key,
      count(*)::bigint as play_count,
      count(*) filter (where e.created_at >= v_now - interval '7 days')::bigint as plays_7d,
      count(*) filter (where e.created_at >= v_now - interval '30 days')::bigint as plays_30d,
      round(avg(e.player_count)::numeric, 1) as avg_players
    from public.game_play_events e
    group by e.game_key
    order by play_count desc, e.game_key asc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_by_variation
  from (
    select
      e.game_key,
      e.variation_key,
      count(*)::bigint as play_count,
      count(*) filter (where e.created_at >= v_now - interval '7 days')::bigint as plays_7d,
      count(*) filter (where e.created_at >= v_now - interval '30 days')::bigint as plays_30d
    from public.game_play_events e
    group by e.game_key, e.variation_key
    order by play_count desc, e.game_key asc, e.variation_key asc
  ) t;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'play_count', coalesce(c.play_count, 0)::bigint
      )
      order by d.day asc
    ),
    '[]'::jsonb
  )
  into v_daily_30d
  from generate_series(
    (v_now at time zone 'UTC')::date - 29,
    (v_now at time zone 'UTC')::date,
    interval '1 day'
  ) as d(day)
  left join (
    select
      (created_at at time zone 'UTC')::date as day,
      count(*)::bigint as play_count
    from public.game_play_events
    where created_at >= (((v_now at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC')
    group by 1
  ) c on c.day = d.day;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_recent_requests
  from (
    select
      r.id,
      r.game_name,
      r.website_url,
      r.requester_id,
      r.requester_email,
      r.status,
      r.dismissed_at,
      r.created_at,
      r.updated_at
    from public.game_requests r
    order by r.created_at desc
    limit 50
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_community_variations
  from (
    select
      cv.id,
      cv.game_key,
      cv.slug,
      cv.name,
      cv.tagline,
      cv.differences,
      cv.scoring_overrides,
      cv.author_id,
      cv.author_name,
      cv.is_hidden,
      cv.created_at
    from public.community_variations cv
    order by cv.created_at desc
    limit 50
  ) t;

  return jsonb_build_object(
    'generated_at', v_now,
    'totals', v_totals,
    'by_game', v_by_game,
    'by_variation', v_by_variation,
    'daily_plays_30d', v_daily_30d,
    'recent_game_requests', v_recent_requests,
    'community_variations', v_community_variations
  );
end;
$$;

revoke all on function public.get_admin_stats() from public;
grant execute on function public.get_admin_stats() to authenticated;

-- Explicit table grants (RLS governs row visibility and write permissions)
grant select on public.community_variations to anon, authenticated;
grant insert, update, delete on public.community_variations to authenticated;
