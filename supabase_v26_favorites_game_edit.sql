-- =============================================================================
-- TallyIt v26 - Favorite games (cross-device) + Past game detail & owner-only editing
-- Safe to run more than once. Run AFTER supabase_v24_player_linking.sql (v24.1, v25 optional).
--
-- 1. FAVORITES  public.user_favorites(user_id, game_key, sort_order, created_at)
--      RLS: a signed-in user can only SELECT their own rows; all writes go through RPCs
--      get_my_favorites() / set_my_favorites(text[]) / toggle_favorite(text)  (jsonb {ok, favorites, ...})
--      Table is in the supabase_realtime publication so other devices can subscribe
--      (filter user_id=eq.<me>). Removals "touch" the rows first so a filtered UPDATE event
--      fires (DELETE events cannot be filtered by column in Supabase Realtime).
-- 2. GAME DETAIL / EDIT  (shared games live in public.games + public.game_participants;
--      public.score_history is the legacy per-user blob table and is NOT touched)
--      get_game_detail(uuid)                          creator OR anyone who can already view the game
--      update_game_record(uuid, jsonb, timestamptz)   creator ONLY (games.created_by = auth.uid())
--      games.edited_at / games.edited_by (set only by update_game_record; client writes are ignored)
--      Participant rows are updated IN PLACE (ids kept) and touched so linked players' existing
--      realtime listener (game_participants, user_id=eq.me) fires; games is also published.
--      v24 links are preserved (and follow renames); an edit can never add a new account to a game.
-- Errors are RETURNED (not raised): {ok:false, error:'not_signed_in'|'forbidden'|'not_found'|
--      'invalid_payload'|'invalid_input'|'too_many'|'conflict', message}
-- =============================================================================

grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Favorites
-- -----------------------------------------------------------------------------
create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null check (game_key ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, game_key)
);
create index if not exists idx_user_favorites_user_order on public.user_favorites (user_id, sort_order, created_at);

alter table public.user_favorites enable row level security;
revoke all on table public.user_favorites from anon, authenticated;
grant select on table public.user_favorites to authenticated;

drop policy if exists "user_favorites_select_own" on public.user_favorites;
create policy "user_favorites_select_own" on public.user_favorites
  for select to authenticated
  using (user_id = auth.uid());

-- normalise a key: trim + lower; NULL when blank; raises nothing. (validity checked by caller)
create or replace function public._v26_fav_key(p_key text)
returns text
language sql
immutable
as $$ select nullif(lower(btrim(coalesce(p_key, ''))), '') $$;

create or replace function public._v26_favs_json(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(game_key order by sort_order, created_at, game_key), '[]'::jsonb)
  from public.user_favorites where user_id = p_uid;
$$;
revoke all on function public._v26_favs_json(uuid) from public;

create or replace function public.get_my_favorites()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  return jsonb_build_object('ok', true, 'favorites', public._v26_favs_json(v_uid));
end;
$$;
revoke all on function public.get_my_favorites() from public;
grant execute on function public.get_my_favorites() to anon, authenticated;

create or replace function public.set_my_favorites(p_game_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_keys text[];
  v_raw text;
  v_k text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  if p_game_keys is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input', 'message', 'game keys are required');
  end if;

  v_keys := '{}';
  foreach v_raw in array p_game_keys loop
    v_k := public._v26_fav_key(v_raw);
    if v_k is null then continue; end if;                       -- blank entries are dropped
    if v_k !~ '^[a-z0-9][a-z0-9_.:-]{0,79}$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_input', 'message', 'invalid game key: ' || left(v_k, 40));
    end if;
    if not (v_k = any(v_keys)) then v_keys := v_keys || v_k; end if; -- de-dupe, keep first position
  end loop;
  if coalesce(array_length(v_keys, 1), 0) > 100 then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'message', 'At most 100 favorites.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('v26fav' || v_uid::text, 0));

  -- touch removals first so a user_id-filtered UPDATE realtime event fires, then delete
  update public.user_favorites set sort_order = sort_order
   where user_id = v_uid and game_key <> all (v_keys);
  delete from public.user_favorites where user_id = v_uid and game_key <> all (v_keys);

  insert into public.user_favorites (user_id, game_key, sort_order)
  select v_uid, k, (ord - 1)::int from unnest(v_keys) with ordinality as t(k, ord)
  on conflict (user_id, game_key) do update set sort_order = excluded.sort_order
    where public.user_favorites.sort_order is distinct from excluded.sort_order;

  return jsonb_build_object('ok', true, 'favorites', public._v26_favs_json(v_uid));
end;
$$;
revoke all on function public.set_my_favorites(text[]) from public;
grant execute on function public.set_my_favorites(text[]) to anon, authenticated;

create or replace function public.toggle_favorite(p_game_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_k text := public._v26_fav_key(p_game_key);
  v_fav boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  if v_k is null or v_k !~ '^[a-z0-9][a-z0-9_.:-]{0,79}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input', 'message', 'invalid game key');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('v26fav' || v_uid::text, 0));

  if exists (select 1 from public.user_favorites where user_id = v_uid and game_key = v_k) then
    update public.user_favorites set sort_order = sort_order where user_id = v_uid and game_key = v_k;
    delete from public.user_favorites where user_id = v_uid and game_key = v_k;
    v_fav := false;
  else
    if (select count(*) from public.user_favorites where user_id = v_uid) >= 100 then
      return jsonb_build_object('ok', false, 'error', 'too_many', 'message', 'At most 100 favorites.');
    end if;
    insert into public.user_favorites (user_id, game_key, sort_order)
    values (v_uid, v_k, coalesce((select max(sort_order) + 1 from public.user_favorites where user_id = v_uid), 0));
    v_fav := true;
  end if;

  return jsonb_build_object('ok', true, 'favorited', v_fav, 'game_key', v_k,
                            'favorites', public._v26_favs_json(v_uid));
end;
$$;
revoke all on function public.toggle_favorite(text) from public;
grant execute on function public.toggle_favorite(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2a. Edit audit columns + guard (clients cannot forge edited_at / edited_by)
-- -----------------------------------------------------------------------------
alter table public.games add column if not exists edited_at timestamptz;
alter table public.games add column if not exists edited_by uuid references public.profiles(id) on delete set null;

create or replace function public._v26_games_guard_edit_cols()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('tallyit.v26_edit', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.edited_at := null;
      new.edited_by := null;
    else
      new.edited_at := old.edited_at;
      new.edited_by := old.edited_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_v26_games_guard_edit_cols on public.games;
create trigger trg_v26_games_guard_edit_cols
  before insert or update on public.games
  for each row execute function public._v26_games_guard_edit_cols();

-- Tighten direct UPDATE/DELETE on games to the creator (re-assert; already the v1 policy).
drop policy if exists "games_update_creator" on public.games;
create policy "games_update_creator" on public.games
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- 2b. Realtime publication (guarded + idempotent)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['user_favorites', 'games', 'game_participants'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2c. Helpers
-- -----------------------------------------------------------------------------
-- Strip user_id / userId from payload players (and team members) unless it is an allowed account
create or replace function public._v26_sanitize_payload_users(p_payload jsonb, p_allowed uuid[])
returns jsonb
language plpgsql
stable
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_p jsonb; v_m jsonb; v_mout jsonb; v_u uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload->'players') is distinct from 'array' then
    return p_payload;
  end if;
  for v_p in select value from jsonb_array_elements(p_payload->'players') loop
    if jsonb_typeof(v_p) = 'object' then
      v_u := public._v24_try_uuid(coalesce(v_p->>'user_id', v_p->>'userId'));
      if (v_p ? 'user_id' or v_p ? 'userId') and (v_u is null or not (v_u = any (p_allowed))) then
        v_p := v_p - 'user_id' - 'userId';
      end if;
      if jsonb_typeof(v_p->'members') = 'array' then
        v_mout := '[]'::jsonb;
        for v_m in select value from jsonb_array_elements(v_p->'members') loop
          if jsonb_typeof(v_m) = 'object' then
            v_u := public._v24_try_uuid(coalesce(v_m->>'user_id', v_m->>'userId'));
            if (v_m ? 'user_id' or v_m ? 'userId') and (v_u is null or not (v_u = any (p_allowed))) then
              v_m := v_m - 'user_id' - 'userId';
            end if;
          end if;
          v_mout := v_mout || jsonb_build_array(v_m);
        end loop;
        v_p := jsonb_set(v_p, '{members}', v_mout);
      end if;
    end if;
    v_out := v_out || jsonb_build_array(v_p);
  end loop;
  return jsonb_set(p_payload, '{players}', v_out);
end;
$$;
revoke all on function public._v26_sanitize_payload_users(jsonb, uuid[]) from public;

-- Full saved record in the shape the UI consumes (callers must authorize first)
create or replace function public._v26_game_json(p_game_id uuid, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.games%rowtype;
  v_payload jsonb;
  v_players jsonb := '[]'::jsonb;
  v_parts jsonb;
  v_p jsonb; v_m jsonb; v_mout jsonb;
  v_name text; v_key text; v_uid uuid; v_via text; v_acct text; v_win boolean; v_score jsonb;
  v_row public.game_participants%rowtype;
  v_vkey text; v_vname text; v_cname text; v_ename text;
  v_wkeys text[];
  v_obj jsonb;
begin
  select * into g from public.games where id = p_game_id;
  if not found then return null; end if;
  v_payload := coalesce(g.payload, '{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', gp.id, 'seat_order', gp.seat_order, 'user_id', gp.user_id,
           'display_name', gp.display_name, 'name_key', public._v24_name_key(gp.display_name),
           'score', gp.score, 'is_winner', gp.is_winner,
           'linked_via', l.linked_via, 'account_name', pr.display_name
         ) order by gp.seat_order, gp.id), '[]'::jsonb)
    into v_parts
  from public.game_participants gp
  left join public.game_participant_links l on l.game_id = gp.game_id and l.user_id = gp.user_id
  left join public.profiles pr on pr.id = gp.user_id
  where gp.game_id = g.id;

  select coalesce(array_agg(public._v24_name_key(t)), '{}') into v_wkeys
  from unnest(string_to_array(coalesce(g.winner, ''), ',')) t;

  if jsonb_typeof(v_payload->'players') = 'array' and jsonb_array_length(v_payload->'players') > 0 then
    for v_p in select value from jsonb_array_elements(v_payload->'players') loop
      if jsonb_typeof(v_p) <> 'object' then continue; end if;
      v_name := coalesce(nullif(btrim(v_p->>'name'), ''), nullif(btrim(v_p->>'display_name'), ''), 'Player');
      v_key := public._v24_name_key(v_name);
      v_row := null;
      select * into v_row from public.game_participants
       where game_id = g.id and public._v24_name_key(display_name) = v_key
       order by seat_order, id limit 1;
      v_score := case when jsonb_typeof(v_p->'score') = 'number' then v_p->'score'
                      else to_jsonb(coalesce(v_row.score, 0)) end;
      v_win := coalesce(case when jsonb_typeof(v_p->'is_winner') = 'boolean' then (v_p->>'is_winner')::boolean end,
                        v_row.is_winner,
                        v_key = any (v_wkeys) or v_key = public._v24_name_key(g.winner));
      if jsonb_typeof(v_p->'members') = 'array' then
        v_mout := '[]'::jsonb;
        for v_m in select value from jsonb_array_elements(v_p->'members') loop
          v_name := coalesce(nullif(btrim(v_m->>'name'), ''), nullif(btrim(v_m->>'display_name'), ''), 'Player');
          v_key := public._v24_name_key(v_name);
          v_row := null;
          select * into v_row from public.game_participants
           where game_id = g.id and public._v24_name_key(display_name) = v_key
           order by seat_order, id limit 1;
          v_uid := coalesce(v_row.user_id, public._v24_try_uuid(coalesce(v_m->>'user_id', v_m->>'userId')));
          select l.linked_via into v_via from public.game_participant_links l
           where l.game_id = g.id and l.name_key = v_key and l.user_id = v_uid;
          select pr.display_name into v_acct from public.profiles pr where pr.id = v_uid;
          v_mout := v_mout || jsonb_build_array(jsonb_build_object(
            'name', v_name, 'name_key', v_key, 'user_id', v_uid,
            'display_name', coalesce(v_acct, v_name), 'linked_via', v_via));
        end loop;
        select coalesce(nullif(btrim(v_p->>'name'), ''), 'Team') into v_name;
        v_obj := jsonb_build_object(
          'name', v_name, 'name_key', public._v24_name_key(v_name), 'score', v_score, 'is_winner', v_win,
          'user_id', null, 'display_name', v_name, 'linked_via', null, 'members', v_mout);
      else
        v_uid := coalesce(v_row.user_id, public._v24_try_uuid(coalesce(v_p->>'user_id', v_p->>'userId')));
        v_via := null;
        select l.linked_via into v_via from public.game_participant_links l
         where l.game_id = g.id and l.name_key = v_key and l.user_id = v_uid;
        v_acct := null;
        select pr.display_name into v_acct from public.profiles pr where pr.id = v_uid;
        v_obj := jsonb_build_object(
          'name', v_name, 'name_key', v_key, 'score', v_score, 'is_winner', v_win,
          'user_id', v_uid, 'display_name', coalesce(v_acct, v_name), 'linked_via', v_via);
      end if;
      v_players := v_players || jsonb_build_array(v_obj);
    end loop;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', x->>'display_name', 'name_key', x->>'name_key', 'score', x->'score',
             'is_winner', x->'is_winner', 'user_id', x->'user_id',
             'display_name', coalesce(x->>'account_name', x->>'display_name'), 'linked_via', x->'linked_via')
           order by ord), '[]'::jsonb)
      into v_players
    from jsonb_array_elements(v_parts) with ordinality as t(x, ord);
  end if;

  v_vkey := coalesce(nullif(btrim(v_payload->>'variation_key'), ''),
                     nullif(btrim(v_payload->>'v22VariationKey'), ''),
                     nullif(btrim(v_payload->'meta'->>'variation_key'), ''),
                     nullif(btrim(v_payload->'meta'->>'v22VariationKey'), ''),
                     nullif(btrim(g.version), ''), 'standard');
  v_vname := coalesce(nullif(btrim(v_payload->>'variation_name'), ''),
                      nullif(btrim(v_payload->>'v22VariationName'), ''),
                      nullif(btrim(v_payload->'meta'->>'variation_name'), ''),
                      nullif(btrim(v_payload->'meta'->>'v22VariationName'), ''),
                      nullif(btrim(g.version), ''), 'Standard');

  select pr.display_name into v_cname from public.profiles pr where pr.id = g.created_by;
  select pr.display_name into v_ename from public.profiles pr where pr.id = g.edited_by;

  return jsonb_build_object(
    'id', g.id,
    'client_game_id', g.client_game_id,
    'game_key', g.game_type,
    'game_type', g.game_type,
    'variation_key', v_vkey,
    'variation_name', v_vname,
    'version', g.version,
    'target', g.target,
    'group_id', g.group_id,
    'played_at', g.ended_at,
    'started_at', g.started_at,
    'created_at', g.created_at,
    'created_by', g.created_by,
    'created_by_name', v_cname,
    'edited_at', g.edited_at,
    'edited_by', g.edited_by,
    'edited_by_name', v_ename,
    'winner', coalesce(g.winner, ''),
    'is_owner', (g.created_by = p_uid),
    'can_edit', (g.created_by = p_uid),
    'payload', v_payload,
    'meta', v_payload->'meta',
    'rounds', case when jsonb_typeof(v_payload->'rounds') = 'array' then v_payload->'rounds' else '[]'::jsonb end,
    'players', v_players,
    'participants', v_parts
  );
end;
$$;
revoke all on function public._v26_game_json(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- 2d. get_game_detail
-- -----------------------------------------------------------------------------
create or replace function public.get_game_detail(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  g public.games%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  if p_game_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Game not found.');
  end if;
  select * into g from public.games where id = p_game_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Game not found.');
  end if;
  if not (g.created_by = v_uid or public.can_view_game(g.id, v_uid)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'message', 'You are not part of this game.');
  end if;
  return jsonb_build_object('ok', true, 'game', public._v26_game_json(g.id, v_uid));
end;
$$;
revoke all on function public.get_game_detail(uuid) from public;
grant execute on function public.get_game_detail(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2e. update_game_record  (owner only)
--   p_edit = Scoring's buildSharedEdit(): {game_id?, client_game_id?, game:{game_type?, winner?, target?, version?,
--            started_at?, ended_at?, payload?}, participants:[{seat_order, user_id, display_name, score, is_winner}], winnerChanged?}
--   or (back-compat) a bare payload object {players, rounds, meta, winner?, target?, version?, ...} -> participants are
--   derived from payload.players like saveSharedGame does (team members expand to one row each).
--   Winner rule: winner non-empty -> >=1 is_winner row AND (winner == comma-joined names of the is_winner rows, order/
--   case/whitespace-insensitive, OR equals a payload.players[].name team label); winner empty -> no is_winner rows.
-- -----------------------------------------------------------------------------
create or replace function public.update_game_record(
  p_game_id uuid,
  p_edit jsonb,
  p_expected_edited_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  g public.games%rowtype;
  v_game jsonb;
  v_payload_in jsonb;
  v_parts_in jsonb;
  v_payload jsonb;
  v_players jsonb;
  v_has_winner boolean := false;
  v_winner_in text;
  v_winner text;
  v_old_winner text;
  v_has_target boolean := false;
  v_target int;
  v_has_version boolean := false;
  v_version text;
  v_type text;
  v_started timestamptz; v_has_started boolean := false;
  v_ended timestamptz;
  v_allowed uuid[];
  v_ignored int := 0;
  v_rows jsonb := '[]'::jsonb;
  v_elem jsonb; v_p jsonb; v_m jsonb;
  v_idx int := 0;
  v_name text; v_key text; v_score numeric; v_win boolean; v_u uuid; v_ru uuid;
  v_wtokens text[]; v_wrow_keys text[]; v_team_keys text[];
  v_n int;
  v_used uuid[] := '{}';
  v_match_id uuid; v_match_uid uuid;
  v_new_uid uuid;
  v_raw jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  if p_game_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Game not found.');
  end if;

  select * into g from public.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Game not found.');
  end if;
  if g.created_by is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'message', 'Only the player who recorded this game can edit it.');
  end if;
  if p_expected_edited_at is not null
     and (g.edited_at is null
          or date_trunc('milliseconds', g.edited_at) <> date_trunc('milliseconds', p_expected_edited_at)) then
    return jsonb_build_object('ok', false, 'error', 'conflict',
      'message', 'This game was edited somewhere else. Reload it and try again.',
      'edited_at', g.edited_at, 'edited_by', g.edited_by);
  end if;

  begin
    -- ---------------------------------------------------------------- parse input
    if p_edit is null or jsonb_typeof(p_edit) <> 'object' then
      raise exception 'edit must be a JSON object' using errcode = '22023';
    end if;
    if octet_length(p_edit::text) > 600000 then
      raise exception 'edit is too large' using errcode = '22023';
    end if;

    if p_edit ? 'game' and jsonb_typeof(p_edit->'game') = 'object' then
      v_game := p_edit->'game';
      v_parts_in := p_edit->'participants';
      v_payload_in := v_game->'payload';
      if nullif(p_edit->>'game_id', '') is not null and (p_edit->>'game_id') <> p_game_id::text then
        raise exception 'game_id does not match' using errcode = '22023';
      end if;
    else
      v_game := p_edit;                       -- bare payload (back-compat): winner/target/version are top-level keys
      v_payload_in := p_edit - 'winner';
      v_parts_in := null;
    end if;
    if v_payload_in is not null and jsonb_typeof(v_payload_in) = 'null' then v_payload_in := null; end if;
    if v_payload_in is not null and jsonb_typeof(v_payload_in) <> 'object' then
      raise exception 'payload must be an object' using errcode = '22023';
    end if;
    if v_parts_in is not null and jsonb_typeof(v_parts_in) = 'null' then v_parts_in := null; end if;
    if v_parts_in is not null and jsonb_typeof(v_parts_in) <> 'array' then
      raise exception 'participants must be an array' using errcode = '22023';
    end if;

    -- game_type
    if v_game ? 'game_type' and jsonb_typeof(v_game->'game_type') = 'string' then
      v_type := btrim(v_game->>'game_type');
      if v_type = '' or length(v_type) > 60 then raise exception 'invalid game_type' using errcode = '22023'; end if;
    elsif v_game ? 'game_type' and jsonb_typeof(v_game->'game_type') <> 'null' then
      raise exception 'invalid game_type' using errcode = '22023';
    end if;

    -- winner
    if v_game ? 'winner' then
      v_has_winner := true;
      v_raw := v_game->'winner';
      if jsonb_typeof(v_raw) = 'string' then
        v_winner_in := nullif(btrim(v_raw #>> '{}'), '');
      elsif jsonb_typeof(v_raw) = 'null' then
        v_winner_in := null;
      elsif jsonb_typeof(v_raw) = 'array' then
        select nullif(string_agg(btrim(x), ', '), '') into v_winner_in from jsonb_array_elements_text(v_raw) x where btrim(x) <> '';
      else
        raise exception 'winner must be text' using errcode = '22023';
      end if;
    end if;
    if v_has_winner and length(coalesce(v_winner_in, '')) > 300 then
      raise exception 'winner is too long' using errcode = '22023';
    end if;

    -- target / version / dates
    if v_game ? 'target' then
      v_has_target := true;
      if jsonb_typeof(v_game->'target') = 'null' then v_target := null;
      elsif jsonb_typeof(v_game->'target') = 'number' and (v_game->>'target')::numeric = trunc((v_game->>'target')::numeric)
            and abs((v_game->>'target')::numeric) < 1000000000 then
        v_target := (v_game->>'target')::int;
      else raise exception 'target must be a whole number' using errcode = '22023'; end if;
    end if;
    if v_game ? 'version' then
      v_has_version := true;
      if jsonb_typeof(v_game->'version') = 'null' then v_version := null;
      elsif jsonb_typeof(v_game->'version') = 'string' then v_version := nullif(btrim(v_game->>'version'), '');
      else raise exception 'version must be text' using errcode = '22023'; end if;
      if length(coalesce(v_version, '')) > 120 then raise exception 'version is too long' using errcode = '22023'; end if;
    end if;
    if v_game ? 'ended_at' and jsonb_typeof(v_game->'ended_at') = 'string' then v_ended := (v_game->>'ended_at')::timestamptz; end if;
    if v_game ? 'started_at' then
      if jsonb_typeof(v_game->'started_at') = 'string' then v_started := (v_game->>'started_at')::timestamptz; v_has_started := true;
      elsif jsonb_typeof(v_game->'started_at') = 'null' then v_started := null; v_has_started := true; end if;
    end if;

    -- merged payload (top-level keys supplied replace the stored ones)
    v_payload := coalesce(g.payload, '{}'::jsonb) || coalesce(v_payload_in, '{}'::jsonb);
    if jsonb_typeof(v_payload->'rounds') is not null and jsonb_typeof(v_payload->'rounds') <> 'array' then
      raise exception 'rounds must be an array' using errcode = '22023';
    end if;
    if jsonb_typeof(v_payload->'rounds') = 'array' and jsonb_array_length(v_payload->'rounds') > 2000 then
      raise exception 'too many rounds' using errcode = '22023';
    end if;
    if v_payload ? 'meta' and jsonb_typeof(v_payload->'meta') not in ('object', 'null') then
      raise exception 'meta must be an object' using errcode = '22023';
    end if;
    v_players := v_payload->'players';
    if v_players is not null and jsonb_typeof(v_players) <> 'array' then
      raise exception 'players must be an array' using errcode = '22023';
    end if;

    -- ---------------------------------------------------------------- allowed accounts
    -- creator + accounts already in this game (links, existing participant rows). An edit can never add anyone else.
    select coalesce(array_agg(distinct u), '{}') into v_allowed from (
      select g.created_by as u
      union select user_id from public.game_participant_links where game_id = g.id
      union select user_id from public.game_participants where game_id = g.id and user_id is not null
    ) s where u is not null;

    v_winner := case when v_has_winner then v_winner_in else nullif(btrim(coalesce(g.winner, '')), '') end;
    select coalesce(array_agg(public._v24_name_key(t)), '{}') into v_wtokens
      from unnest(string_to_array(coalesce(v_winner, ''), ',')) t where public._v24_name_key(t) is not null;

    -- ---------------------------------------------------------------- participant rows
    if v_parts_in is not null then
      for v_elem in select value from jsonb_array_elements(v_parts_in) loop
        v_idx := v_idx + 1;
        if jsonb_typeof(v_elem) <> 'object' then raise exception 'participant must be an object' using errcode = '22023'; end if;
        v_name := btrim(coalesce(nullif(btrim(v_elem->>'display_name'), ''), v_elem->>'name', ''));
        v_score := case when v_elem ? 'score' and jsonb_typeof(v_elem->'score') <> 'null' then (v_elem->>'score')::numeric else 0 end;
        if v_elem ? 'is_winner' and jsonb_typeof(v_elem->'is_winner') not in ('boolean', 'null') then
          raise exception 'is_winner must be true or false' using errcode = '22023';
        end if;
        v_win := coalesce((case when jsonb_typeof(v_elem->'is_winner') = 'boolean' then (v_elem->>'is_winner')::boolean end), false);
        v_u := public._v24_try_uuid(coalesce(v_elem->>'user_id', v_elem->>'userId'));
        if coalesce(v_elem->>'user_id', v_elem->>'userId', '') <> '' and (v_u is null or not (v_u = any (v_allowed))) then
          v_ignored := v_ignored + 1; v_u := null;
        end if;
        v_n := case when jsonb_typeof(v_elem->'seat_order') = 'number' then floor((v_elem->>'seat_order')::numeric)::int else v_idx - 1 end;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('name', v_name, 'score', v_score, 'is_winner', v_win, 'user_id', v_u, 'seat', v_n));
      end loop;
    else
      if v_players is null or jsonb_array_length(v_players) = 0 then
        raise exception 'players are required' using errcode = '22023';
      end if;
      select coalesce(array_agg(public._v24_name_key(coalesce(p->>'name', p->>'display_name'))), '{}') into v_team_keys
        from jsonb_array_elements(v_players) p where jsonb_typeof(p) = 'object' and jsonb_typeof(p->'members') = 'array';
      for v_p in select value from jsonb_array_elements(v_players) loop
        if jsonb_typeof(v_p) <> 'object' then raise exception 'player must be an object' using errcode = '22023'; end if;
        v_name := btrim(coalesce(nullif(btrim(v_p->>'name'), ''), v_p->>'display_name', ''));
        v_key := public._v24_name_key(v_name);
        v_score := case when v_p ? 'score' and jsonb_typeof(v_p->'score') <> 'null' then (v_p->>'score')::numeric else 0 end;
        if v_p ? 'is_winner' and jsonb_typeof(v_p->'is_winner') not in ('boolean', 'null') then
          raise exception 'is_winner must be true or false' using errcode = '22023';
        end if;
        v_win := coalesce((case when jsonb_typeof(v_p->'is_winner') = 'boolean' then (v_p->>'is_winner')::boolean end),
                          v_key = any (v_wtokens) or v_key = public._v24_name_key(v_winner), false);
        if jsonb_typeof(v_p->'members') = 'array' and jsonb_array_length(v_p->'members') > 0 then
          for v_m in select value from jsonb_array_elements(v_p->'members') loop
            v_idx := v_idx + 1;
            v_u := public._v24_try_uuid(coalesce(v_m->>'user_id', v_m->>'userId'));
            if coalesce(v_m->>'user_id', v_m->>'userId', '') <> '' and (v_u is null or not (v_u = any (v_allowed))) then
              v_ignored := v_ignored + 1; v_u := null;
            end if;
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'name', btrim(coalesce(nullif(btrim(v_m->>'name'), ''), v_m->>'display_name', '')),
              'score', v_score, 'is_winner', v_win, 'user_id', v_u, 'seat', v_idx - 1));
          end loop;
        else
          v_idx := v_idx + 1;
          v_u := public._v24_try_uuid(coalesce(v_p->>'user_id', v_p->>'userId'));
          if coalesce(v_p->>'user_id', v_p->>'userId', '') <> '' and (v_u is null or not (v_u = any (v_allowed))) then
            v_ignored := v_ignored + 1; v_u := null;
          end if;
          v_rows := v_rows || jsonb_build_array(jsonb_build_object('name', v_name, 'score', v_score, 'is_winner', v_win, 'user_id', v_u, 'seat', v_idx - 1));
        end if;
      end loop;
    end if;

    v_n := jsonb_array_length(v_rows);
    if v_n < 1 or v_n > 100 then raise exception 'a game needs between 1 and 100 players' using errcode = '22023'; end if;
    for v_elem in select value from jsonb_array_elements(v_rows) loop
      if length(coalesce(v_elem->>'name', '')) < 1 or length(v_elem->>'name') > 80 then
        raise exception 'player names must be 1-80 characters' using errcode = '22023';
      end if;
      if abs((v_elem->>'score')::numeric) >= 1000000000 then
        raise exception 'score out of range' using errcode = '22003';
      end if;
    end loop;

    -- ---------------------------------------------------------------- winner validation
    select coalesce(array_agg(public._v24_name_key(e->>'name') order by public._v24_name_key(e->>'name')), '{}') into v_wrow_keys
      from jsonb_array_elements(v_rows) e where (e->>'is_winner')::boolean;
    if v_winner is not null then
      if coalesce(array_length(v_wrow_keys, 1), 0) = 0 then
        raise exception 'a winner is set but no player is marked as the winner' using errcode = '22023';
      end if;
      select coalesce(array_agg(k order by k), '{}') into v_wtokens from unnest(v_wtokens) k;
      if not (v_wtokens = v_wrow_keys
              or exists (select 1 from jsonb_array_elements(coalesce(v_players, '[]'::jsonb)) p
                          where jsonb_typeof(p) = 'object' and jsonb_typeof(p->'members') = 'array'
                            and jsonb_array_length(p->'members') > 0
                            and public._v24_name_key(coalesce(p->>'name', p->>'display_name')) = public._v24_name_key(v_winner))) then
        raise exception 'winner does not match the players marked as winners' using errcode = '22023';
      end if;
    elsif coalesce(array_length(v_wrow_keys, 1), 0) > 0 then
      raise exception 'players are marked as winners but no winner is set' using errcode = '22023';
    end if;

    -- ---------------------------------------------------------------- write (participants in place, links, game)
    v_payload := public._v26_sanitize_payload_users(v_payload, v_allowed);
    v_old_winner := g.winner;

    for v_elem in select value from jsonb_array_elements(v_rows) loop
      v_key := public._v24_name_key(v_elem->>'name');
      v_new_uid := (v_elem->>'user_id')::uuid;
      v_match_id := null; v_match_uid := null;
      if v_new_uid is not null then
        select id, user_id into v_match_id, v_match_uid from public.game_participants
         where game_id = g.id and user_id = v_new_uid and id <> all (v_used)
         order by (public._v24_name_key(display_name) = v_key) desc, seat_order, id limit 1;
      end if;
      if v_match_id is null then
        select id, user_id into v_match_id, v_match_uid from public.game_participants
         where game_id = g.id and public._v24_name_key(display_name) = v_key and id <> all (v_used)
         order by seat_order, id limit 1;
      end if;
      if v_match_id is not null then
        update public.game_participants
           set display_name = v_elem->>'name',
               score = (v_elem->>'score')::numeric,
               is_winner = (v_elem->>'is_winner')::boolean,
               seat_order = (v_elem->>'seat')::int,
               user_id = coalesce(v_new_uid, v_match_uid)
         where id = v_match_id;
        v_used := v_used || v_match_id;
      else
        insert into public.game_participants (game_id, user_id, display_name, score, is_winner, seat_order)
        values (g.id, v_new_uid, v_elem->>'name', (v_elem->>'score')::numeric, (v_elem->>'is_winner')::boolean, (v_elem->>'seat')::int)
        returning id into v_match_id;
        v_used := v_used || v_match_id;
      end if;
    end loop;

    -- removed players: touch (so a user_id-filtered realtime event fires) then delete
    update public.game_participants set score = score where game_id = g.id and id <> all (v_used);
    delete from public.game_participants where game_id = g.id and id <> all (v_used);

    -- links: drop links for accounts no longer in the game, follow renames, refill any NULL user_id from links
    delete from public.game_participant_links l
     where l.game_id = g.id
       and not exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = l.user_id);
    update public.game_participant_links l
       set name_key = s.k, display_name = s.dn
      from (select distinct on (gp.user_id) gp.user_id, gp.display_name as dn, public._v24_name_key(gp.display_name) as k
              from public.game_participants gp
             where gp.game_id = g.id and gp.user_id is not null
             order by gp.user_id, gp.seat_order) s
     where l.game_id = g.id and l.user_id = s.user_id and l.name_key is distinct from s.k
       and not exists (select 1 from public.game_participant_links l2
                        where l2.game_id = g.id and l2.name_key = s.k and l2.user_id <> l.user_id);
    update public.game_participants gp
       set user_id = l.user_id
      from public.game_participant_links l
     where gp.game_id = g.id and l.game_id = g.id and gp.user_id is null
       and public._v24_name_key(gp.display_name) = l.name_key;

    perform set_config('tallyit.v26_edit', 'on', true);
    update public.games
       set game_type = coalesce(v_type, game_type),
           winner = v_winner,
           target = case when v_has_target then v_target else target end,
           version = case when v_has_version then v_version else version end,
           started_at = case when v_has_started then v_started else started_at end,
           ended_at = coalesce(v_ended, ended_at),
           payload = v_payload,
           edited_at = clock_timestamp(),
           edited_by = v_uid
     where id = g.id;
    perform set_config('tallyit.v26_edit', '', true);

  exception
    when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range
         or invalid_datetime_format or datetime_field_overflow or check_violation
         or string_data_right_truncation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', 'invalid_payload', 'message', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'game', public._v26_game_json(g.id, v_uid),
    'winner_changed', (lower(btrim(coalesce(v_old_winner, ''))) <> lower(btrim(coalesce(v_winner, '')))),
    'ignored_user_ids', v_ignored
  );
end;
$$;
revoke all on function public.update_game_record(uuid, jsonb, timestamptz) from public;
grant execute on function public.update_game_record(uuid, jsonb, timestamptz) to anon, authenticated;
