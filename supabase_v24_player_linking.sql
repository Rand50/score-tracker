-- =============================================================================
-- TallyIt (Score Tracker) — v24 Player Linking (Idempotent)
-- Target Supabase project: lezfdnqqfejqyxqwlcfg
-- Run once in the Supabase SQL Editor AFTER supabase_social_migration.sql,
-- v20 and v22. Safe to re-run.
--
-- Lets a player who joins later link a past game where a friend recorded them
-- as a guest name, so it shows in their History, stats and leaderboards.
--
-- Adds:
--   Tables
--     public.game_participant_links   durable (game, guest name) -> user links
--     public.participant_claims       shareable one-time claim tokens
--   Triggers (links survive the app re-saving a game, which deletes and
--   re-inserts game_participants and rewrites games.payload)
--     trg_v24_participant_apply_link  on game_participants (before insert)
--     trg_v24_games_apply_links       on games (before insert/update of payload)
--   RPCs
--     link_game_participant(p_game_id, p_participant, p_user_id)     creator only, friend (or self) only
--     unlink_game_participant(p_game_id, p_participant)              creator or the linked user
--     create_participant_claim(p_game_id, p_participant)             creator only -> token + link
--     preview_participant_claim(p_token)                             anon + auth, for the claim landing screen
--     claim_game_participant(p_token)                                signed-in user links themself
--     suggest_my_unlinked_games()                                    name/email matches in friends' games
--     claim_suggested_participant(p_participant_id)                  one-tap "That was me" on a suggestion
--
-- RLS: existing policies already let a linked user read the game.
--   games_select_shared            -> can_view_game() -> is_game_participant(user_id = auth.uid())
--   game_participants_select_shared -> user_id = auth.uid() or can_view_game(game_id)
-- So setting game_participants.user_id is all that is needed for reads. The new
-- tables get their own RLS below; all writes go through SECURITY DEFINER RPCs.
-- =============================================================================

create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------------------------------
create or replace function public._v24_name_key(p_name text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g')), '');
$$;

create or replace function public._v24_are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = p_a and f.addressee_id = p_b)
        or (f.requester_id = p_b and f.addressee_id = p_a))
  );
$$;

revoke all on function public._v24_are_friends(uuid, uuid) from public;

create or replace function public._v24_try_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return p_text::uuid;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.game_participant_links (
  game_id uuid not null references public.games(id) on delete cascade,
  name_key text not null,
  display_name text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_via text not null default 'creator' check (linked_via in ('creator', 'claim', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (game_id, name_key)
);

create unique index if not exists idx_gpl_game_user on public.game_participant_links (game_id, user_id);
create index if not exists idx_gpl_user on public.game_participant_links (user_id, created_at desc);

alter table public.game_participant_links enable row level security;

drop policy if exists "gpl_select_own_or_creator" on public.game_participant_links;
create policy "gpl_select_own_or_creator" on public.game_participant_links
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid())
  );

create table if not exists public.participant_claims (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  game_id uuid not null references public.games(id) on delete cascade,
  name_key text not null,
  participant_name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_participant_claims_game on public.participant_claims (game_id, name_key);

alter table public.participant_claims enable row level security;

drop policy if exists "participant_claims_select_creator" on public.participant_claims;
create policy "participant_claims_select_creator" on public.participant_claims
  for select to authenticated
  using (created_by = auth.uid() or claimed_by = auth.uid());

grant select on public.game_participant_links to authenticated;
grant select on public.participant_claims to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Keep links attached when the app re-saves a game
-- -----------------------------------------------------------------------------
create or replace function public._v24_payload_with_links(p_payload jsonb, p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_p jsonb;
  v_m jsonb;
  v_mout jsonb;
  v_uid uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload->'players') is distinct from 'array' then
    return p_payload;
  end if;
  if not exists (select 1 from public.game_participant_links where game_id = p_game_id) then
    return p_payload;
  end if;

  for v_p in select value from jsonb_array_elements(p_payload->'players') loop
    if jsonb_typeof(v_p) = 'object' then
      if jsonb_typeof(v_p->'members') = 'array' then
        v_mout := '[]'::jsonb;
        for v_m in select value from jsonb_array_elements(v_p->'members') loop
          if jsonb_typeof(v_m) = 'object' and coalesce(v_m->>'user_id', v_m->>'userId', '') = '' then
            select l.user_id into v_uid
            from public.game_participant_links l
            where l.game_id = p_game_id
              and l.name_key = public._v24_name_key(coalesce(v_m->>'name', v_m->>'display_name'));
            if v_uid is not null then
              v_m := v_m || jsonb_build_object('user_id', v_uid);
            end if;
          end if;
          v_mout := v_mout || jsonb_build_array(v_m);
        end loop;
        v_p := jsonb_set(v_p, '{members}', v_mout);
      elsif coalesce(v_p->>'user_id', v_p->>'userId', '') = '' then
        select l.user_id into v_uid
        from public.game_participant_links l
        where l.game_id = p_game_id
          and l.name_key = public._v24_name_key(coalesce(v_p->>'name', v_p->>'display_name'));
        if v_uid is not null then
          v_p := v_p || jsonb_build_object('user_id', v_uid);
        end if;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(v_p);
  end loop;

  return jsonb_set(p_payload, '{players}', v_out);
end;
$$;

revoke all on function public._v24_payload_with_links(jsonb, uuid) from public;

create or replace function public._v24_payload_strip_user(p_payload jsonb, p_user_id uuid)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_p jsonb;
  v_m jsonb;
  v_mout jsonb;
  v_uid text := p_user_id::text;
begin
  if p_payload is null or jsonb_typeof(p_payload->'players') is distinct from 'array' then
    return p_payload;
  end if;
  for v_p in select value from jsonb_array_elements(p_payload->'players') loop
    if jsonb_typeof(v_p) = 'object' then
      if jsonb_typeof(v_p->'members') = 'array' then
        v_mout := '[]'::jsonb;
        for v_m in select value from jsonb_array_elements(v_p->'members') loop
          if jsonb_typeof(v_m) = 'object' and (v_m->>'user_id' = v_uid or v_m->>'userId' = v_uid) then
            v_m := v_m - 'user_id' - 'userId';
          end if;
          v_mout := v_mout || jsonb_build_array(v_m);
        end loop;
        v_p := jsonb_set(v_p, '{members}', v_mout);
      elsif v_p->>'user_id' = v_uid or v_p->>'userId' = v_uid then
        v_p := v_p - 'user_id' - 'userId';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(v_p);
  end loop;
  return jsonb_set(p_payload, '{players}', v_out);
end;
$$;

create or replace function public._v24_participant_apply_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    select l.user_id into new.user_id
    from public.game_participant_links l
    where l.game_id = new.game_id
      and l.name_key = public._v24_name_key(new.display_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_v24_participant_apply_link on public.game_participants;
create trigger trg_v24_participant_apply_link
  before insert on public.game_participants
  for each row execute function public._v24_participant_apply_link();

create or replace function public._v24_games_apply_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.payload := public._v24_payload_with_links(new.payload, new.id);
  return new;
end;
$$;

drop trigger if exists trg_v24_games_apply_links on public.games;
create trigger trg_v24_games_apply_links
  before insert or update of payload on public.games
  for each row execute function public._v24_games_apply_links();

-- Core link writer shared by every RPC (assumes caller already authorized)
create or replace function public._v24_apply_link(
  p_game_id uuid,
  p_name_key text,
  p_user_id uuid,
  p_linked_by uuid,
  p_via text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
  v_rows int;
begin
  select gp.display_name into v_display
  from public.game_participants gp
  where gp.game_id = p_game_id and public._v24_name_key(gp.display_name) = p_name_key
  order by gp.seat_order
  limit 1;

  if v_display is null then
    return jsonb_build_object('ok', false, 'code', 'participant_not_found', 'error', 'That player is not in this game.');
  end if;

  if exists (
    select 1 from public.game_participants gp
    where gp.game_id = p_game_id and public._v24_name_key(gp.display_name) = p_name_key
      and gp.user_id is not null and gp.user_id <> p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_linked', 'error', 'That player is already linked to another account.');
  end if;

  if exists (
    select 1 from public.game_participants gp
    where gp.game_id = p_game_id and gp.user_id = p_user_id
      and public._v24_name_key(gp.display_name) is distinct from p_name_key
  ) then
    return jsonb_build_object('ok', false, 'code', 'user_already_in_game', 'error', 'That account is already a different player in this game.');
  end if;

  insert into public.game_participant_links (game_id, name_key, display_name, user_id, linked_by, linked_via)
  values (p_game_id, p_name_key, v_display, p_user_id, p_linked_by, p_via)
  on conflict (game_id, name_key) do update
    set user_id = excluded.user_id,
        linked_by = excluded.linked_by,
        linked_via = excluded.linked_via,
        created_at = now();

  update public.game_participants gp
  set user_id = p_user_id
  where gp.game_id = p_game_id and public._v24_name_key(gp.display_name) = p_name_key;
  get diagnostics v_rows = row_count;

  -- Re-run the payload trigger so team rows (payload.players[].members) pick up the link
  update public.games g set payload = g.payload where g.id = p_game_id;

  return jsonb_build_object(
    'ok', true,
    'game_id', p_game_id,
    'participant_name', v_display,
    'user_id', p_user_id,
    'linked_via', p_via,
    'rows_linked', v_rows
  );
end;
$$;

revoke all on function public._v24_apply_link(uuid, text, uuid, uuid, text) from public;

-- Resolve p_participant (participant row uuid OR display name) to a name key within a game
create or replace function public._v24_resolve_participant(p_game_id uuid, p_participant text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pid uuid := public._v24_try_uuid(trim(coalesce(p_participant, '')));
  v_name text;
begin
  if v_pid is not null then
    select gp.display_name into v_name
    from public.game_participants gp
    where gp.id = v_pid and gp.game_id = p_game_id;
    if v_name is not null then
      return public._v24_name_key(v_name);
    end if;
  end if;
  return public._v24_name_key(p_participant);
end;
$$;

revoke all on function public._v24_resolve_participant(uuid, text) from public;

-- -----------------------------------------------------------------------------
-- 3. Creator links a friend directly
-- -----------------------------------------------------------------------------
create or replace function public.link_game_participant(
  p_game_id uuid,
  p_participant text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_key text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'error', 'Sign in to link players.');
  end if;
  if p_game_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'error', 'Missing game or friend.');
  end if;

  select g.created_by into v_creator from public.games g where g.id = p_game_id;
  if v_creator is null then
    return jsonb_build_object('ok', false, 'code', 'game_not_found', 'error', 'Game not found.');
  end if;
  if v_creator <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Only the person who recorded this game can link players.');
  end if;
  if p_user_id <> v_uid and not public._v24_are_friends(v_uid, p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'not_friends', 'error', 'You can only link players who are your friends.');
  end if;

  v_key := public._v24_resolve_participant(p_game_id, p_participant);
  if v_key is null then
    return jsonb_build_object('ok', false, 'code', 'participant_not_found', 'error', 'Pick a player from this game.');
  end if;

  return public._v24_apply_link(p_game_id, v_key, p_user_id, v_uid, 'creator');
end;
$$;

revoke all on function public.link_game_participant(uuid, text, uuid) from public;
grant execute on function public.link_game_participant(uuid, text, uuid) to authenticated;

-- Creator, or the linked player themself, removes a link
create or replace function public.unlink_game_participant(
  p_game_id uuid,
  p_participant text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_key text;
  v_link public.game_participant_links%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'error', 'Sign in first.');
  end if;

  select g.created_by into v_creator from public.games g where g.id = p_game_id;
  if v_creator is null then
    return jsonb_build_object('ok', false, 'code', 'game_not_found', 'error', 'Game not found.');
  end if;

  v_key := public._v24_resolve_participant(p_game_id, p_participant);
  select * into v_link from public.game_participant_links l where l.game_id = p_game_id and l.name_key = v_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_linked', 'error', 'That player is not linked.');
  end if;
  if v_uid <> v_creator and v_uid <> v_link.user_id then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Only the game creator or the linked player can unlink.');
  end if;
  delete from public.game_participant_links l where l.game_id = p_game_id and l.name_key = v_key;

  update public.game_participants gp
  set user_id = null
  where gp.game_id = p_game_id
    and public._v24_name_key(gp.display_name) = v_key
    and gp.user_id = v_link.user_id;

  update public.games g
  set payload = public._v24_payload_strip_user(g.payload, v_link.user_id)
  where g.id = p_game_id and v_link.user_id <> v_creator;

  return jsonb_build_object('ok', true, 'game_id', p_game_id, 'participant_name', v_link.display_name);
end;
$$;

revoke all on function public.unlink_game_participant(uuid, text) from public;
grant execute on function public.unlink_game_participant(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Claim links (creator shares, player claims after signing up)
-- -----------------------------------------------------------------------------
create or replace function public.create_participant_claim(
  p_game_id uuid,
  p_participant text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_key text;
  v_name text;
  v_claim public.participant_claims%rowtype;
  v_token text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'error', 'Sign in to share a claim link.');
  end if;

  select g.created_by into v_creator from public.games g where g.id = p_game_id;
  if v_creator is null then
    return jsonb_build_object('ok', false, 'code', 'game_not_found', 'error', 'Game not found.');
  end if;
  if v_creator <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Only the person who recorded this game can share claim links.');
  end if;

  v_key := public._v24_resolve_participant(p_game_id, p_participant);
  select gp.display_name into v_name
  from public.game_participants gp
  where gp.game_id = p_game_id and public._v24_name_key(gp.display_name) = v_key
  order by gp.seat_order limit 1;
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'participant_not_found', 'error', 'Pick a player from this game.');
  end if;
  if exists (
    select 1 from public.game_participants gp
    where gp.game_id = p_game_id and public._v24_name_key(gp.display_name) = v_key and gp.user_id is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_linked', 'error', 'That player is already linked to an account.');
  end if;

  -- Reuse an open claim for the same seat so re-sharing gives the same link
  select * into v_claim
  from public.participant_claims c
  where c.game_id = p_game_id and c.name_key = v_key
    and c.claimed_at is null and c.revoked_at is null and c.expires_at > now()
  order by c.created_at desc
  limit 1;

  if not found then
    v_token := rtrim(translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
    insert into public.participant_claims (token, game_id, name_key, participant_name, created_by)
    values (v_token, p_game_id, v_key, v_name, v_uid)
    returning * into v_claim;
  end if;

  return jsonb_build_object(
    'ok', true,
    'token', v_claim.token,
    'url', 'https://tallyit.fun/?claim=' || v_claim.token,
    'participant_name', v_claim.participant_name,
    'expires_at', v_claim.expires_at
  );
end;
$$;

revoke all on function public.create_participant_claim(uuid, text) from public;
grant execute on function public.create_participant_claim(uuid, text) to authenticated;

-- Safe summary for the claim landing screen (works before sign-in)
create or replace function public.preview_participant_claim(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.participant_claims%rowtype;
  v_g public.games%rowtype;
  v_creator_name text;
  v_status text;
begin
  select * into v_c from public.participant_claims c where c.token = trim(coalesce(p_token, ''));
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token', 'error', 'This claim link is not valid.');
  end if;
  select * into v_g from public.games g where g.id = v_c.game_id;
  select p.display_name into v_creator_name from public.profiles p where p.id = v_c.created_by;

  v_status := case
    when v_c.revoked_at is not null then 'revoked'
    when v_c.claimed_at is not null then 'claimed'
    when v_c.expires_at <= now() then 'expired'
    else 'open'
  end;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'participant_name', v_c.participant_name,
    'game_type', v_g.game_type,
    'version', v_g.version,
    'ended_at', v_g.ended_at,
    'creator_name', v_creator_name,
    'expires_at', v_c.expires_at
  );
end;
$$;

revoke all on function public.preview_participant_claim(text) from public;
grant execute on function public.preview_participant_claim(text) to anon, authenticated;

create or replace function public.claim_game_participant(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.participant_claims%rowtype;
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'error', 'Sign in to claim this game.');
  end if;

  select * into v_c from public.participant_claims c
  where c.token = trim(coalesce(p_token, ''))
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token', 'error', 'This claim link is not valid.');
  end if;
  if v_c.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'revoked', 'error', 'This claim link was cancelled.');
  end if;
  if v_c.claimed_at is not null then
    if v_c.claimed_by = v_uid then
      return jsonb_build_object('ok', true, 'already_claimed', true, 'game_id', v_c.game_id, 'participant_name', v_c.participant_name);
    end if;
    return jsonb_build_object('ok', false, 'code', 'claimed', 'error', 'Someone already claimed this spot.');
  end if;
  if v_c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired', 'error', 'This claim link has expired. Ask your friend for a new one.');
  end if;

  perform public.ensure_my_profile(null);

  v_res := public._v24_apply_link(v_c.game_id, v_c.name_key, v_uid, v_uid, 'claim');
  if coalesce((v_res->>'ok')::boolean, false) then
    update public.participant_claims set claimed_by = v_uid, claimed_at = now() where id = v_c.id;
  end if;
  return v_res;
end;
$$;

revoke all on function public.claim_game_participant(text) from public;
grant execute on function public.claim_game_participant(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Suggestions: guest seats in friends' games that match my name or email
-- -----------------------------------------------------------------------------
create or replace function public._v24_my_name_keys(p_user_id uuid)
returns table (name_key text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.display_name, coalesce(p.email, u.email) as email
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.id = p_user_id
  )
  select distinct on (k.name_key) k.name_key, k.reason
  from (
    select public._v24_name_key(display_name) as name_key, 'display_name' as reason, 1 as rank from me
    union all
    select public._v24_name_key(split_part(trim(display_name), ' ', 1)), 'first_name', 2 from me
      where position(' ' in trim(display_name)) > 0
    union all
    select public._v24_name_key(regexp_replace(split_part(email, '@', 1), '[._-]+', ' ', 'g')), 'email', 3 from me
      where email is not null
    union all
    select public._v24_name_key(email), 'email', 4 from me where email is not null
  ) k
  where k.name_key is not null and length(k.name_key) >= 2
  order by k.name_key, k.rank;
$$;

revoke all on function public._v24_my_name_keys(uuid) from public;

create or replace function public.suggest_my_unlinked_games()
returns table (
  game_id uuid,
  participant_id uuid,
  participant_name text,
  game_type text,
  version text,
  ended_at timestamptz,
  creator_id uuid,
  creator_name text,
  score numeric,
  is_winner boolean,
  match_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (g.id)
    g.id,
    gp.id,
    gp.display_name,
    g.game_type,
    g.version,
    g.ended_at,
    g.created_by,
    cp.display_name,
    gp.score,
    gp.is_winner,
    k.reason
  from public._v24_my_name_keys(auth.uid()) k
  join public.game_participants gp
    on public._v24_name_key(gp.display_name) = k.name_key and gp.user_id is null
  join public.games g on g.id = gp.game_id
  left join public.profiles cp on cp.id = g.created_by
  where auth.uid() is not null
    and g.created_by <> auth.uid()
    and public._v24_are_friends(auth.uid(), g.created_by)
    and not exists (
      select 1 from public.game_participants mine
      where mine.game_id = g.id and mine.user_id = auth.uid()
    )
  order by g.id, gp.seat_order
  limit 100;
$$;

revoke all on function public.suggest_my_unlinked_games() from public;
grant execute on function public.suggest_my_unlinked_games() to authenticated;

-- One-tap "That was me" on a suggestion. Allowed only when the seat is unlinked,
-- the game was recorded by an accepted friend, and the seat name matches my
-- display name, first name, or email. The creator can undo it with unlink.
create or replace function public.claim_suggested_participant(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gp public.game_participants%rowtype;
  v_creator uuid;
  v_key text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'error', 'Sign in first.');
  end if;

  select * into v_gp from public.game_participants gp where gp.id = p_participant_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'participant_not_found', 'error', 'That game is no longer available.');
  end if;

  select g.created_by into v_creator from public.games g where g.id = v_gp.game_id;
  v_key := public._v24_name_key(v_gp.display_name);

  if v_creator = v_uid then
    return jsonb_build_object('ok', false, 'code', 'use_link', 'error', 'You recorded this game. Link players from the game instead.');
  end if;
  if not public._v24_are_friends(v_uid, v_creator) then
    return jsonb_build_object('ok', false, 'code', 'not_friends', 'error', 'You can only claim games recorded by your friends.');
  end if;
  if not exists (select 1 from public._v24_my_name_keys(v_uid) k where k.name_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'name_mismatch', 'error', 'That name does not match your profile. Ask your friend for a claim link.');
  end if;

  return public._v24_apply_link(v_gp.game_id, v_key, v_uid, v_uid, 'suggestion');
end;
$$;

revoke all on function public.claim_suggested_participant(uuid) from public;
grant execute on function public.claim_suggested_participant(uuid) to authenticated;
