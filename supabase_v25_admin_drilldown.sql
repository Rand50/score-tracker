-- =============================================================================
-- TallyIt (Score Tracker) — v25 Admin Drill-down (Idempotent)
-- Run AFTER supabase_v24_player_linking.sql (and v20 + v22 + social). Safe to run repeatedly.
--
-- Admin-only (public.is_admin() => JWT email randw50@gmail.com) read RPCs that back
-- every stat box on the admin page. Each box's list is defined so its `total`
-- reconciles with the matching count in get_admin_stats():
--
--   box (kpi / card)            RPC                                  reconciles with get_admin_stats().totals
--   All-Time Games              admin_list_plays(p_window='all')     total_plays
--   Last 7 Days / Last 30 Days  admin_list_plays(p_window='7d'|'30d') plays_7d / plays_30d
--   Registered Users            admin_list_users                     users_total (+ users_7d / users_30d via p_signup)
--   Game Requests / n new       admin_list_game_requests             game_requests_total / game_requests_new (p_status='new')
--   Friends & Groups            admin_list_friendships + admin_list_groups   friendships_accepted + groups_total
--   Most Played Games           admin_list_game_breakdown            by_game rows
--   Most Popular Variations     admin_list_variation_breakdown       by_variation rows
--   Daily Plays (30d)           admin_list_daily_plays               daily_plays_30d rows
--   Community Variations        admin_list_community_variations      community_variations_total / _visible
--   (not displayed today)       admin_list_shared_games              shared_games_total / _7d / _30d
--   Game detail                 admin_get_shared_game(p_game_id)     participants of one shared game
--   Generic                     admin_drilldown(p_box, ...)          dispatcher over all of the above
--
-- Every list RPC returns jsonb { ok:true, rows:[...], total, limit, offset, has_more }.
-- Common args: p_search text (ilike), p_limit int (default 50, clamped 1..200),
--              p_offset int (default 0), p_sort text (allow-listed column), p_dir text ('asc'|'desc').
-- Non-admins: raise exception 'forbidden' using errcode = '42501'. anon has no EXECUTE at all.
-- Nothing here writes data.
-- =============================================================================

grant usage on schema public to anon, authenticated;

-- Defensive: make sure the admin guard exists (same body as v20/v22)
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
-- 0. Internal helpers (not callable by API roles)
-- -----------------------------------------------------------------------------
create or replace function public._v25_like(p_search text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_search, '')), '') is null then null
    else '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;

create or replace function public._v25_limit(p_limit int)
returns int
language sql
immutable
set search_path = public
as $$ select least(greatest(coalesce(p_limit, 50), 1), 200); $$;

create or replace function public._v25_offset(p_offset int)
returns int
language sql
immutable
set search_path = public
as $$ select greatest(coalesce(p_offset, 0), 0); $$;

-- SQL fragment limiting a timestamp column to a rolling window ('7d' | '30d' | anything else = all time)
create or replace function public._v25_since(p_window text, p_col text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(btrim(p_window), 'all'))
    when '7d'  then ' and ' || p_col || ' >= now() - interval ''7 days'' '
    when '30d' then ' and ' || p_col || ' >= now() - interval ''30 days'' '
    else ''
  end;
$$;

-- ORDER BY clause from an allow-listed sort column (never interpolates caller text)
create or replace function public._v25_order(
  p_sort text, p_dir text, p_allowed text[], p_default_sort text, p_default_dir text, p_tiebreak text
)
returns text
language sql
immutable
set search_path = public
as $$
  select quote_ident(s.col) || ' ' || s.dir || ' nulls last, ' || p_tiebreak
  from (
    select
      case when lower(coalesce(p_sort, '')) = any (p_allowed) then lower(p_sort) else p_default_sort end as col,
      case when lower(coalesce(p_dir, '')) in ('asc', 'desc') then lower(p_dir) else p_default_dir end as dir
  ) s;
$$;

-- Runs a base query (which may reference $1 = ilike pattern or NULL) and pages it.
create or replace function public._v25_page(
  p_base text, p_order text, p_pat text, p_limit int, p_offset int
)
returns jsonb
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_limit int := public._v25_limit(p_limit);
  v_offset int := public._v25_offset(p_offset);
  v_total bigint;
  v_rows jsonb;
begin
  execute format('select count(*) from (%s) b', p_base) into v_total using p_pat;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - ''_rn'' order by t._rn), ''[]''::jsonb) from ('
    || 'select b.*, row_number() over (order by %s) as _rn from (%s) b order by _rn limit %s offset %s) t',
    p_order, p_base, v_limit, v_offset
  ) into v_rows using p_pat;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + jsonb_array_length(v_rows)) < v_total
  );
end;
$fn$;

revoke all on function public._v25_like(text) from public, anon, authenticated;
revoke all on function public._v25_limit(int) from public, anon, authenticated;
revoke all on function public._v25_offset(int) from public, anon, authenticated;
revoke all on function public._v25_since(text, text) from public, anon, authenticated;
revoke all on function public._v25_order(text, text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public._v25_page(text, text, text, int, int) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Registered Users  (count = profiles, same as users_total / users_7d / users_30d)
--    p_signup: 'all'|'7d'|'30d' (by profiles.created_at); p_active: 'all'|'7d'|'30d' (by last_active_at)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_signup text default 'all',
  p_active text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      p.id,
      p.display_name,
      coalesce(p.email, au.email) as email,
      p.friend_code,
      p.created_at as signed_up_at,
      au.last_sign_in_at,
      greatest(au.last_sign_in_at, pl.last_play_at, sg.last_game_at) as last_active_at,
      coalesce(pl.plays, 0)::int as plays,
      coalesce(sg.shared_games, 0)::int as shared_games,
      greatest(coalesce(pl.plays, 0), coalesce(sg.shared_games, 0))::int as games_played,
      coalesce(fr.friend_count, 0)::int as friend_count
    from public.profiles p
    left join auth.users au on au.id = p.id
    left join lateral (
      select count(*) as plays, max(e.created_at) as last_play_at
      from public.game_play_events e where e.user_id = p.id
    ) pl on true
    left join lateral (
      select count(*) as shared_games, max(x.created_at) as last_game_at
      from (
        select g.id, g.created_at from public.games g where g.created_by = p.id
        union
        select g.id, g.created_at from public.game_participants gp
          join public.games g on g.id = gp.game_id where gp.user_id = p.id
      ) x
    ) sg on true
    left join lateral (
      select count(*) as friend_count from public.friendships f
      where f.status = 'accepted' and (f.requester_id = p.id or f.addressee_id = p.id)
    ) fr on true
    where ($1::text is null
        or p.display_name ilike $1::text or p.email ilike $1::text
        or au.email ilike $1::text or p.friend_code ilike $1::text)
  $q$
  || public._v25_since(p_signup, 'p.created_at')
  || public._v25_since(p_active, 'greatest(au.last_sign_in_at, pl.last_play_at, sg.last_game_at)');

  v_order := public._v25_order(p_sort, p_dir,
    array['display_name','email','signed_up_at','last_sign_in_at','last_active_at','games_played','plays','shared_games','friend_count'],
    'signed_up_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 2. Game plays  (count = game_play_events; All-Time / 7d / 30d boxes; also the
--    drill-in for a top-game, top-variation or a chart day)
--    p_window 'all'|'7d'|'30d'; p_game_key; p_variation_key; p_date (UTC day)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_plays(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_window text default 'all',
  p_game_key text default null,
  p_variation_key text default null,
  p_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      e.id,
      e.game_key,
      e.variation_key,
      e.player_count,
      e.user_id,
      p.display_name as user_name,
      coalesce(p.email, au.email) as user_email,
      e.created_at
    from public.game_play_events e
    left join public.profiles p on p.id = e.user_id
    left join auth.users au on au.id = e.user_id
    where ($1::text is null
        or e.game_key ilike $1::text or e.variation_key ilike $1::text
        or p.display_name ilike $1::text or p.email ilike $1::text or au.email ilike $1::text)
  $q$
  || public._v25_since(p_window, 'e.created_at')
  || case when nullif(btrim(coalesce(p_game_key, '')), '') is null then ''
          else format(' and e.game_key = %L ', lower(btrim(p_game_key))) end
  || case when nullif(btrim(coalesce(p_variation_key, '')), '') is null then ''
          else format(' and e.variation_key = %L ', btrim(p_variation_key)) end
  || case when p_date is null then ''
          else format(' and (e.created_at at time zone ''UTC'')::date = %L::date ', p_date) end;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','game_key','variation_key','player_count','user_name','user_email'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 3. Game Requests  (count = game_requests; Game Requests box + "n new")
--    p_status: all|new|reviewing|planned|built|declined (aliases: added=built, dismissed=declined)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_game_requests(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), 'all'));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_status := case v_status when 'added' then 'built' when 'dismissed' then 'declined' else v_status end;
  if v_status not in ('all', 'new', 'reviewing', 'planned', 'built', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_base := $q$
    select
      r.id,
      r.game_name,
      r.website_url,
      r.requester_id,
      r.requester_email,
      p.display_name as requester_name,
      r.status,
      r.dismissed_at,
      r.created_at,
      r.updated_at
    from public.game_requests r
    left join public.profiles p on p.id = r.requester_id
    where ($1::text is null
        or r.game_name ilike $1::text or r.website_url ilike $1::text
        or r.requester_email ilike $1::text or p.display_name ilike $1::text)
  $q$
  || case when v_status = 'all' then '' else format(' and r.status = %L ', v_status) end;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','updated_at','game_name','status','requester_email','requester_name'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 4. Friends & Groups box = accepted friendships + groups  (two lists)
--    4a. friendships (default p_status='accepted' = friendships_accepted; 'pending' = friendships_pending)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_friendships(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_status text default 'accepted'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), 'accepted'));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_status not in ('all', 'accepted', 'pending', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_base := $q$
    select
      f.id,
      f.status,
      f.requester_id,
      rp.display_name as requester_name,
      rp.email as requester_email,
      f.addressee_id,
      ap.display_name as addressee_name,
      ap.email as addressee_email,
      f.created_at,
      f.updated_at
    from public.friendships f
    left join public.profiles rp on rp.id = f.requester_id
    left join public.profiles ap on ap.id = f.addressee_id
    where ($1::text is null
        or rp.display_name ilike $1::text or rp.email ilike $1::text
        or ap.display_name ilike $1::text or ap.email ilike $1::text)
  $q$
  || case when v_status = 'all' then '' else format(' and f.status = %L ', v_status) end;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','updated_at','status','requester_name','addressee_name'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

--    4b. groups (count = groups_total)
create or replace function public.admin_list_groups(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      g.id,
      g.name,
      g.created_by,
      o.display_name as owner_name,
      o.email as owner_email,
      (select count(*) from public.group_members m where m.group_id = g.id)::int as member_count,
      (select count(*) from public.games gm where gm.group_id = g.id)::int as games_count,
      to_jsonb(coalesce(g.guest_names, '{}'::text[])) as guest_names,
      g.created_at
    from public.groups g
    left join public.profiles o on o.id = g.created_by
    where ($1::text is null
        or g.name ilike $1::text or o.display_name ilike $1::text or o.email ilike $1::text
        or exists (select 1 from unnest(coalesce(g.guest_names, '{}'::text[])) gn where gn ilike $1::text))
  $q$;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','name','owner_name','member_count','games_count'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Most Played Games  (rows = get_admin_stats().by_game: one per game_key)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_game_breakdown(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      e.game_key,
      count(*)::bigint as play_count,
      count(*) filter (where e.created_at >= now() - interval '7 days')::bigint as plays_7d,
      count(*) filter (where e.created_at >= now() - interval '30 days')::bigint as plays_30d,
      round(avg(e.player_count)::numeric, 1) as avg_players,
      count(distinct e.user_id)::bigint as unique_players,
      min(e.created_at) as first_played_at,
      max(e.created_at) as last_played_at
    from public.game_play_events e
    where ($1::text is null or e.game_key ilike $1::text)
    group by e.game_key
  $q$;

  v_order := public._v25_order(p_sort, p_dir,
    array['game_key','play_count','plays_7d','plays_30d','avg_players','unique_players','first_played_at','last_played_at'],
    'play_count', 'desc', 'game_key asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 6. Most Popular Variations  (rows = get_admin_stats().by_variation)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_variation_breakdown(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_game_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      e.game_key,
      e.variation_key,
      count(*)::bigint as play_count,
      count(*) filter (where e.created_at >= now() - interval '7 days')::bigint as plays_7d,
      count(*) filter (where e.created_at >= now() - interval '30 days')::bigint as plays_30d,
      round(avg(e.player_count)::numeric, 1) as avg_players,
      max(e.created_at) as last_played_at
    from public.game_play_events e
    where ($1::text is null or e.game_key ilike $1::text or e.variation_key ilike $1::text)
  $q$
  || case when nullif(btrim(coalesce(p_game_key, '')), '') is null then ''
          else format(' and e.game_key = %L ', lower(btrim(p_game_key))) end
  || ' group by e.game_key, e.variation_key ';

  v_order := public._v25_order(p_sort, p_dir,
    array['game_key','variation_key','play_count','plays_7d','plays_30d','avg_players','last_played_at'],
    'play_count', 'desc', 'game_key asc, variation_key asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 7. Daily Plays (30d chart)  rows = one per UTC day incl. zero days, newest first.
--    p_days 1..365 (default 30). Day cells drill into admin_list_plays(p_date => day).
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_daily_plays(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := format($q$
    select
      to_char(d.day, 'YYYY-MM-DD') as "date",
      coalesce(c.play_count, 0)::bigint as play_count,
      coalesce(c.unique_players, 0)::bigint as unique_players
    from generate_series(
      (now() at time zone 'UTC')::date - %1$s,
      (now() at time zone 'UTC')::date,
      interval '1 day'
    ) as d(day)
    left join (
      select (created_at at time zone 'UTC')::date as day,
             count(*)::bigint as play_count,
             count(distinct user_id)::bigint as unique_players
      from public.game_play_events
      where created_at >= (((now() at time zone 'UTC')::date - %1$s)::timestamp at time zone 'UTC')
      group by 1
    ) c on c.day = d.day
    where ($1::text is null or to_char(d.day, 'YYYY-MM-DD') ilike $1::text)
  $q$, v_days - 1);

  v_order := public._v25_order(p_sort, p_dir,
    array['date','play_count','unique_players'], 'date', 'desc', '"date" asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 8. Shared games (count = games; shared_games_total / _7d / _30d) + game detail
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_shared_games(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_window text default 'all',
  p_game_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base := $q$
    select
      g.id,
      g.client_game_id,
      g.game_type,
      g.version,
      g.target,
      g.winner,
      g.created_by,
      cp.display_name as creator_name,
      cp.email as creator_email,
      g.group_id,
      gr.name as group_name,
      (select count(*) from public.game_participants x where x.game_id = g.id)::int as participant_count,
      (select count(*) from public.game_participants x where x.game_id = g.id and x.user_id is not null)::int as linked_count,
      g.started_at,
      g.ended_at,
      g.created_at
    from public.games g
    left join public.profiles cp on cp.id = g.created_by
    left join public.groups gr on gr.id = g.group_id
    where ($1::text is null
        or g.game_type ilike $1::text or g.winner ilike $1::text
        or cp.display_name ilike $1::text or cp.email ilike $1::text
        or exists (select 1 from public.game_participants x where x.game_id = g.id and x.display_name ilike $1::text))
  $q$
  || public._v25_since(p_window, 'g.created_at')
  || case when nullif(btrim(coalesce(p_game_type, '')), '') is null then ''
          else format(' and g.game_type = %L ', btrim(p_game_type)) end;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','ended_at','game_type','winner','creator_name','participant_count','linked_count'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

create or replace function public.admin_get_shared_game(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_game jsonb;
  v_parts jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
      'id', g.id, 'client_game_id', g.client_game_id, 'game_type', g.game_type, 'version', g.version,
      'target', g.target, 'winner', g.winner, 'created_by', g.created_by,
      'creator_name', cp.display_name, 'creator_email', cp.email,
      'group_id', g.group_id, 'group_name', gr.name,
      'started_at', g.started_at, 'ended_at', g.ended_at, 'created_at', g.created_at)
  into v_game
  from public.games g
  left join public.profiles cp on cp.id = g.created_by
  left join public.groups gr on gr.id = g.group_id
  where g.id = p_game_id;

  if v_game is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', gp.id, 'seat_order', gp.seat_order, 'display_name', gp.display_name,
      'score', gp.score, 'is_winner', gp.is_winner,
      'user_id', gp.user_id, 'user_name', up.display_name, 'user_email', up.email,
      'linked', gp.user_id is not null)
    order by gp.seat_order asc, gp.display_name asc, gp.id asc), '[]'::jsonb)
  into v_parts
  from public.game_participants gp
  left join public.profiles up on up.id = gp.user_id
  where gp.game_id = p_game_id;

  return jsonb_build_object('ok', true, 'game', v_game, 'participants', v_parts);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 9. Community Variations  (count = community_variations; p_visibility all|visible|hidden)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_community_variations(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_visibility text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_order text;
  v_vis text := lower(coalesce(nullif(btrim(p_visibility), ''), 'all'));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_vis not in ('all', 'visible', 'hidden') then
    return jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  end if;

  v_base := $q$
    select
      cv.id,
      cv.game_key,
      cv.slug,
      cv.name,
      cv.tagline,
      cv.differences,
      jsonb_array_length(cv.differences)::int as differences_count,
      cv.scoring_overrides,
      cv.author_id,
      cv.author_name,
      ap.email as author_email,
      cv.is_hidden,
      cv.created_at
    from public.community_variations cv
    left join public.profiles ap on ap.id = cv.author_id
    where ($1::text is null
        or cv.name ilike $1::text or cv.game_key ilike $1::text or cv.slug ilike $1::text
        or cv.tagline ilike $1::text or cv.author_name ilike $1::text or ap.email ilike $1::text)
  $q$
  || case v_vis when 'visible' then ' and cv.is_hidden = false ' when 'hidden' then ' and cv.is_hidden = true ' else '' end;

  v_order := public._v25_order(p_sort, p_dir,
    array['created_at','name','game_key','author_name','is_hidden','differences_count'],
    'created_at', 'desc', 'id asc');

  return public._v25_page(v_base, v_order, public._v25_like(p_search), p_limit, p_offset);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 10. Generic dispatcher. p_filters (jsonb) overrides per-box defaults, e.g.
--     {"window":"7d"}, {"status":"new"}, {"game_key":"catan"}, {"date":"2026-11-20"}, {"days":14}
-- -----------------------------------------------------------------------------
create or replace function public.admin_drilldown(
  p_box text,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default null,
  p_dir text default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_box text := lower(btrim(coalesce(p_box, '')));
  f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  case v_box
    when 'games_total', 'plays_total', 'plays' then
      return public.admin_list_plays(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'window', 'all'), f->>'game_key', f->>'variation_key', nullif(f->>'date', '')::date);
    when 'games_7d', 'plays_7d' then
      return public.admin_list_plays(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'window', '7d'), f->>'game_key', f->>'variation_key', nullif(f->>'date', '')::date);
    when 'games_30d', 'plays_30d' then
      return public.admin_list_plays(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'window', '30d'), f->>'game_key', f->>'variation_key', nullif(f->>'date', '')::date);
    when 'users_total', 'users' then
      return public.admin_list_users(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'signup', 'all'), coalesce(f->>'active', 'all'));
    when 'users_7d' then
      return public.admin_list_users(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'signup', '7d'), coalesce(f->>'active', 'all'));
    when 'users_30d' then
      return public.admin_list_users(p_search, p_limit, p_offset, p_sort, p_dir,
        coalesce(f->>'signup', '30d'), coalesce(f->>'active', 'all'));
    when 'active_users_7d' then
      return public.admin_list_users(p_search, p_limit, p_offset, coalesce(p_sort, 'last_active_at'), p_dir,
        coalesce(f->>'signup', 'all'), coalesce(f->>'active', '7d'));
    when 'active_users_30d' then
      return public.admin_list_users(p_search, p_limit, p_offset, coalesce(p_sort, 'last_active_at'), p_dir,
        coalesce(f->>'signup', 'all'), coalesce(f->>'active', '30d'));
    when 'requests_total', 'requests' then
      return public.admin_list_game_requests(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'status', 'all'));
    when 'requests_new' then
      return public.admin_list_game_requests(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'status', 'new'));
    when 'friendships', 'social_total', 'friends' then
      return public.admin_list_friendships(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'status', 'accepted'));
    when 'friendships_pending' then
      return public.admin_list_friendships(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'status', 'pending'));
    when 'groups' then
      return public.admin_list_groups(p_search, p_limit, p_offset, p_sort, p_dir);
    when 'top_games', 'game_breakdown' then
      return public.admin_list_game_breakdown(p_search, p_limit, p_offset, p_sort, p_dir);
    when 'top_variations', 'variation_breakdown' then
      return public.admin_list_variation_breakdown(p_search, p_limit, p_offset, p_sort, p_dir, f->>'game_key');
    when 'daily_plays' then
      return public.admin_list_daily_plays(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(nullif(f->>'days', '')::int, 30));
    when 'shared_games_total', 'shared_games' then
      return public.admin_list_shared_games(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'window', 'all'), f->>'game_type');
    when 'shared_games_7d' then
      return public.admin_list_shared_games(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'window', '7d'), f->>'game_type');
    when 'shared_games_30d' then
      return public.admin_list_shared_games(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'window', '30d'), f->>'game_type');
    when 'community_total', 'community_variations' then
      return public.admin_list_community_variations(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'visibility', 'all'));
    when 'community_visible' then
      return public.admin_list_community_variations(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'visibility', 'visible'));
    when 'community_hidden' then
      return public.admin_list_community_variations(p_search, p_limit, p_offset, p_sort, p_dir, coalesce(f->>'visibility', 'hidden'));
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_box');
  end case;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 11. Grants: authenticated only (is_admin() still enforced inside every function)
-- -----------------------------------------------------------------------------
revoke all on function public.admin_list_users(text, int, int, text, text, text, text) from public, anon;
revoke all on function public.admin_list_plays(text, int, int, text, text, text, text, text, date) from public, anon;
revoke all on function public.admin_list_game_requests(text, int, int, text, text, text) from public, anon;
revoke all on function public.admin_list_friendships(text, int, int, text, text, text) from public, anon;
revoke all on function public.admin_list_groups(text, int, int, text, text) from public, anon;
revoke all on function public.admin_list_game_breakdown(text, int, int, text, text) from public, anon;
revoke all on function public.admin_list_variation_breakdown(text, int, int, text, text, text) from public, anon;
revoke all on function public.admin_list_daily_plays(text, int, int, text, text, int) from public, anon;
revoke all on function public.admin_list_shared_games(text, int, int, text, text, text, text) from public, anon;
revoke all on function public.admin_get_shared_game(uuid) from public, anon;
revoke all on function public.admin_list_community_variations(text, int, int, text, text, text) from public, anon;
revoke all on function public.admin_drilldown(text, text, int, int, text, text, jsonb) from public, anon;

grant execute on function public.admin_list_users(text, int, int, text, text, text, text) to authenticated;
grant execute on function public.admin_list_plays(text, int, int, text, text, text, text, text, date) to authenticated;
grant execute on function public.admin_list_game_requests(text, int, int, text, text, text) to authenticated;
grant execute on function public.admin_list_friendships(text, int, int, text, text, text) to authenticated;
grant execute on function public.admin_list_groups(text, int, int, text, text) to authenticated;
grant execute on function public.admin_list_game_breakdown(text, int, int, text, text) to authenticated;
grant execute on function public.admin_list_variation_breakdown(text, int, int, text, text, text) to authenticated;
grant execute on function public.admin_list_daily_plays(text, int, int, text, text, int) to authenticated;
grant execute on function public.admin_list_shared_games(text, int, int, text, text, text, text) to authenticated;
grant execute on function public.admin_get_shared_game(uuid) to authenticated;
grant execute on function public.admin_list_community_variations(text, int, int, text, text, text) to authenticated;
grant execute on function public.admin_drilldown(text, text, int, int, text, text, jsonb) to authenticated;

-- Ask PostgREST to pick up the new functions
notify pgrst, 'reload schema';
