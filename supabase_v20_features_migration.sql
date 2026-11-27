-- =============================================================================
-- TallyIt (Score Tracker) — v20 Features Migration (Idempotent)
-- Target Supabase project: lezfdnqqfejqyxqwlcfg
-- Safe to run multiple times in the Supabase SQL Editor.
-- Adds:
--   1. game_requests + submit_game_request(p_game_name, p_website_url) [anon + auth]
--   2. game_play_events + record_game_play(...) + get_variation_popularity(...) [anon + auth]
--   3. Private Admin Stats for randw50@gmail.com:
--      is_admin(), get_admin_stats(), update_game_request_status(p_id, p_status)
-- =============================================================================

create extension if not exists pgcrypto;

-- Ensure anon and authenticated can invoke public RPCs
grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Admin Guard (strictly randw50@gmail.com via verified Supabase JWT email)
-- -----------------------------------------------------------------------------
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
-- 2. Game Requests ("Request a Game" form: Name + optional Website link)
-- -----------------------------------------------------------------------------
create table if not exists public.game_requests (
  id uuid primary key default gen_random_uuid(),
  game_name text not null check (length(trim(game_name)) between 2 and 120),
  website_url text,
  requester_id uuid references auth.users(id) on delete set null,
  requester_email text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'built', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_game_requests_created_at
  on public.game_requests (created_at desc);

create index if not exists idx_game_requests_status
  on public.game_requests (status, created_at desc);

alter table public.game_requests enable row level security;

-- Only admin can directly select/update game_requests (keeps requester emails private)
drop policy if exists "game_requests_admin_select" on public.game_requests;
create policy "game_requests_admin_select" on public.game_requests
  for select to authenticated
  using (public.is_admin());

drop policy if exists "game_requests_admin_update" on public.game_requests;
create policy "game_requests_admin_update" on public.game_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Public submission RPC (callable by BOTH authenticated users and anon guests)
create or replace function public.submit_game_request(
  p_game_name text,
  p_website_url text default null
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
  v_email text := nullif(lower(trim(coalesce(auth.jwt()->>'email', ''))), '');
  v_row public.game_requests%rowtype;
begin
  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please enter a game name (at least 2 characters).');
  end if;
  if length(v_name) > 120 then
    v_name := left(v_name, 120);
  end if;

  if v_url is not null then
    if length(v_url) > 500 then
      return jsonb_build_object('ok', false, 'error', 'Website link is too long (max 500 characters).');
    end if;
    -- Auto-prefix https:// if user typed a bare domain like boardgamegeek.com/...
    if v_url !~* '^https?://' then
      if v_url ~* '^[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' then
        v_url := 'https://' || v_url;
      else
        return jsonb_build_object('ok', false, 'error', 'Website link must start with http:// or https://.');
      end if;
    end if;
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
      'status', v_row.status,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function public.submit_game_request(text, text) from public;
grant execute on function public.submit_game_request(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Game Play Events & Variation Popularity Tally
-- -----------------------------------------------------------------------------
create table if not exists public.game_play_events (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (length(trim(game_key)) between 1 and 80),
  variation_key text not null default 'standard' check (length(trim(variation_key)) between 1 and 120),
  player_count integer not null default 2 check (player_count between 1 and 50),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_play_events_game_var
  on public.game_play_events (game_key, variation_key);

create index if not exists idx_game_play_events_created_at
  on public.game_play_events (created_at desc);

alter table public.game_play_events enable row level security;

-- Only admin can read raw event rows directly (public reads use aggregated RPC)
drop policy if exists "game_play_events_admin_select" on public.game_play_events;
create policy "game_play_events_admin_select" on public.game_play_events
  for select to authenticated
  using (public.is_admin());

-- Record a play event (callable by BOTH authenticated users and anon guests)
create or replace function public.record_game_play(
  p_game_key text,
  p_variation_key text default 'standard',
  p_player_count int default 2
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game text := lower(trim(coalesce(p_game_key, '')));
  v_var text := trim(coalesce(p_variation_key, ''));
  v_players int := coalesce(p_player_count, 2);
  v_row public.game_play_events%rowtype;
begin
  if length(v_game) < 1 then
    return jsonb_build_object('ok', false, 'error', 'Missing game_key.');
  end if;
  if length(v_game) > 80 then
    v_game := left(v_game, 80);
  end if;

  if length(v_var) < 1 then
    v_var := 'standard';
  elsif length(v_var) > 120 then
    v_var := left(v_var, 120);
  end if;

  if v_players < 1 then
    v_players := 1;
  elsif v_players > 50 then
    v_players := 50;
  end if;

  insert into public.game_play_events (game_key, variation_key, player_count, user_id)
  values (v_game, v_var, v_players, auth.uid())
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', v_row.id,
      'game_key', v_row.game_key,
      'variation_key', v_row.variation_key,
      'player_count', v_row.player_count,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function public.record_game_play(text, text, int) from public;
grant execute on function public.record_game_play(text, text, int) to anon, authenticated;

-- Aggregated popularity counts per game + variation (callable by anon + auth)
create or replace function public.get_variation_popularity(
  p_game_key text default null
)
returns table (
  game_key text,
  variation_key text,
  play_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.game_key,
    e.variation_key,
    count(*)::bigint as play_count
  from public.game_play_events e
  where (nullif(lower(trim(coalesce(p_game_key, ''))), '') is null
         or e.game_key = lower(trim(p_game_key)))
  group by e.game_key, e.variation_key
  order by play_count desc, e.game_key asc, e.variation_key asc;
$$;

revoke all on function public.get_variation_popularity(text) from public;
grant execute on function public.get_variation_popularity(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Private Admin Stats & Request Triage RPCs (randw50@gmail.com ONLY)
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
    'game_requests_new', (select count(*) from public.game_requests where status = 'new')
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
      r.created_at,
      r.updated_at
    from public.game_requests r
    order by r.created_at desc
    limit 50
  ) t;

  return jsonb_build_object(
    'generated_at', v_now,
    'totals', v_totals,
    'by_game', v_by_game,
    'by_variation', v_by_variation,
    'daily_plays_30d', v_daily_30d,
    'recent_game_requests', v_recent_requests
  );
end;
$$;

revoke all on function public.get_admin_stats() from public;
grant execute on function public.get_admin_stats() to authenticated;

create or replace function public.update_game_request_status(
  p_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.game_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing request id.');
  end if;

  if v_status not in ('new', 'reviewing', 'planned', 'built', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'Invalid status. Use: new, reviewing, planned, built, or declined.');
  end if;

  update public.game_requests
  set status = v_status,
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Game request not found.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'id', v_row.id,
      'game_name', v_row.game_name,
      'website_url', v_row.website_url,
      'requester_email', v_row.requester_email,
      'status', v_row.status,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    )
  );
end;
$$;

revoke all on function public.update_game_request_status(uuid, text) from public;
grant execute on function public.update_game_request_status(uuid, text) to authenticated;

-- Explicit table grants (RLS still restricts direct access to admin only)
grant select, insert, update on public.game_requests to authenticated;
grant select, insert on public.game_play_events to authenticated;
