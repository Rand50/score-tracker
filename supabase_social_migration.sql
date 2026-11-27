-- =============================================================================
-- Score Tracker — Lightweight Social Layer Migration (Idempotent)
-- Target Supabase project: lezfdnqqfejqyxqwlcfg
-- Safe to run multiple times in the Supabase SQL Editor.
-- Preserves existing `public.score_history` table for full backwards compatibility.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Backwards-compatible legacy table (no-op if already present)
-- -----------------------------------------------------------------------------
create table if not exists public.score_history (
  user_id uuid primary key references auth.users(id) on delete cascade,
  players jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Profiles (auto-created on sign-up + ensured on sign-in)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  friend_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email_lower on public.profiles (lower(email));
create index if not exists idx_profiles_friend_code_upper on public.profiles (upper(friend_code));

-- Generate a readable, unique friend code like RAND-4821
create or replace function public.generate_friend_code(base_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  prefix text;
  candidate text;
  attempt int := 0;
begin
  cleaned := upper(regexp_replace(coalesce(base_name, ''), '[^A-Za-z0-9]', '', 'g'));
  prefix := left(cleaned, 4);
  if length(prefix) < 2 then
    prefix := 'PLYR';
  end if;

  loop
    attempt := attempt + 1;
    candidate := prefix || '-' || lpad(((floor(random() * 9000) + 1000)::int)::text, 4, '0');
    exit when not exists (select 1 from public.profiles where upper(friend_code) = candidate);
    if attempt >= 25 then
      candidate := prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit;
    end if;
  end loop;

  return candidate;
end;
$$;

-- Derive a friendly display name from auth.users metadata or email
create or replace function public.derive_display_name(p_meta jsonb, p_email text)
returns text
language plpgsql
immutable
as $$
declare
  raw_name text;
begin
  raw_name := nullif(trim(coalesce(
    p_meta->>'full_name',
    p_meta->>'name',
    p_meta->>'display_name',
    p_meta->>'preferred_username',
    ''
  )), '');

  if raw_name is not null then
    return left(raw_name, 40);
  end if;

  if p_email is not null and position('@' in p_email) > 1 then
    return left(initcap(regexp_replace(split_part(p_email, '@', 1), '[._-]+', ' ', 'g')), 40);
  end if;

  return 'Player';
end;
$$;

-- Trigger to auto-create profile when a new auth user signs up
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_code text;
begin
  v_name := public.derive_display_name(new.raw_user_meta_data, new.email);
  v_code := public.generate_friend_code(v_name);

  insert into public.profiles (id, display_name, email, friend_code)
  values (new.id, v_name, lower(new.email), v_code)
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- -----------------------------------------------------------------------------
-- 3. Friendships (single undirected pair enforced via least/greatest index)
-- -----------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

create unique index if not exists idx_friendships_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists idx_friendships_requester on public.friendships (requester_id, status);
create index if not exists idx_friendships_addressee on public.friendships (addressee_id, status);

-- -----------------------------------------------------------------------------
-- 4. Groups & Group Members
-- -----------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Optional regular guests (non-account players) saved with a group preset
alter table public.groups add column if not exists guest_names text[] not null default '{}'::text[];

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_group_members_user on public.group_members (user_id);

-- -----------------------------------------------------------------------------
-- 5. Shared Games & Game Participants (user_id nullable for guest players)
-- -----------------------------------------------------------------------------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  client_game_id text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  game_type text not null,
  version text,
  target integer,
  winner text,
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_games_created_by on public.games (created_by, ended_at desc);
create index if not exists idx_games_group_id on public.games (group_id, ended_at desc);
-- Full (non-partial) unique index so PostgREST upserts with
-- on_conflict=created_by,client_game_id work (NULL client ids never collide).
drop index if exists public.idx_games_creator_client_id;
create unique index if not exists idx_games_creator_client_key
  on public.games (created_by, client_game_id);

create table if not exists public.game_participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  score numeric not null default 0,
  is_winner boolean not null default false,
  seat_order integer not null default 0
);

create index if not exists idx_game_participants_game on public.game_participants (game_id);
create index if not exists idx_game_participants_user on public.game_participants (user_id);

-- -----------------------------------------------------------------------------
-- 6. SECURITY DEFINER RLS helper functions (prevents recursive policy loops)
-- -----------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

create or replace function public.is_group_owner(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups
    where id = p_group_id and created_by = p_user_id
  ) or exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id and role = 'owner'
  );
$$;

create or replace function public.is_game_participant(p_game_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.game_participants
    where game_id = p_game_id and user_id = p_user_id
  );
$$;

create or replace function public.can_view_game(p_game_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (
        g.created_by = p_user_id
        or public.is_game_participant(g.id, p_user_id)
        or (g.group_id is not null and public.is_group_member(g.group_id, p_user_id))
      )
  );
$$;

create or replace function public.can_view_profile(p_profile_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_profile_id = p_user_id
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = p_user_id and f.addressee_id = p_profile_id)
         or (f.addressee_id = p_user_id and f.requester_id = p_profile_id)
    )
    or exists (
      select 1 from public.group_members gm1
      join public.group_members gm2 on gm1.group_id = gm2.group_id
      where gm1.user_id = p_user_id and gm2.user_id = p_profile_id
    )
    or exists (
      select 1 from public.game_participants gp1
      join public.game_participants gp2 on gp1.game_id = gp2.game_id
      where gp1.user_id = p_user_id and gp2.user_id = p_profile_id
    )
    or exists (
      select 1 from public.games g
      where g.created_by = p_profile_id and public.can_view_game(g.id, p_user_id)
    );
$$;

-- -----------------------------------------------------------------------------
-- 7. Row-Level Security Policies (idempotent drop + create)
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.games enable row level security;
alter table public.game_participants enable row level security;

-- Profiles
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible" on public.profiles
  for select to authenticated
  using (public.can_view_profile(id));

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Friendships
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships
  for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_insert_own" on public.friendships;
create policy "friendships_insert_own" on public.friendships
  for insert to authenticated
  with check (auth.uid() = requester_id and requester_id <> addressee_id);

drop policy if exists "friendships_update_own" on public.friendships;
create policy "friendships_update_own" on public.friendships
  for update to authenticated
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

drop policy if exists "friendships_delete_own" on public.friendships;
create policy "friendships_delete_own" on public.friendships
  for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Groups
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member" on public.groups
  for select to authenticated
  using (created_by = auth.uid() or public.is_group_member(id));

drop policy if exists "groups_insert_self" on public.groups;
create policy "groups_insert_self" on public.groups
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "groups_update_owner" on public.groups;
create policy "groups_update_owner" on public.groups
  for update to authenticated
  using (public.is_group_owner(id))
  with check (public.is_group_owner(id));

drop policy if exists "groups_delete_owner" on public.groups;
create policy "groups_delete_owner" on public.groups
  for delete to authenticated
  using (created_by = auth.uid());

-- Group members
drop policy if exists "group_members_select_member" on public.group_members;
create policy "group_members_select_member" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id) or public.is_group_owner(group_id));

drop policy if exists "group_members_insert_owner" on public.group_members;
create policy "group_members_insert_owner" on public.group_members
  for insert to authenticated
  with check (public.is_group_owner(group_id));

drop policy if exists "group_members_delete_self_or_owner" on public.group_members;
create policy "group_members_delete_self_or_owner" on public.group_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id));

-- Games
drop policy if exists "games_select_shared" on public.games;
create policy "games_select_shared" on public.games
  for select to authenticated
  using (created_by = auth.uid() or public.can_view_game(id));

drop policy if exists "games_insert_creator" on public.games;
create policy "games_insert_creator" on public.games
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (group_id is null or public.is_group_member(group_id))
  );

drop policy if exists "games_update_creator" on public.games;
create policy "games_update_creator" on public.games
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "games_delete_creator" on public.games;
create policy "games_delete_creator" on public.games
  for delete to authenticated
  using (created_by = auth.uid());

-- Game participants
drop policy if exists "game_participants_select_shared" on public.game_participants;
create policy "game_participants_select_shared" on public.game_participants
  for select to authenticated
  using (user_id = auth.uid() or public.can_view_game(game_id));

drop policy if exists "game_participants_insert_creator" on public.game_participants;
create policy "game_participants_insert_creator" on public.game_participants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.created_by = auth.uid()
    )
  );

drop policy if exists "game_participants_update_creator" on public.game_participants;
create policy "game_participants_update_creator" on public.game_participants
  for update to authenticated
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.created_by = auth.uid()
    )
  );

drop policy if exists "game_participants_delete_creator" on public.game_participants;
create policy "game_participants_delete_creator" on public.game_participants
  for delete to authenticated
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.created_by = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 8. SECURITY DEFINER RPCs (safe profile ensure + private friend lookup/request)
-- -----------------------------------------------------------------------------

-- Ensure the signed-in user has a profile row (handles pre-migration users too)
create or replace function public.ensure_my_profile(p_display_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user auth.users%rowtype;
  v_profile public.profiles%rowtype;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_user from auth.users where id = v_uid;
  select * into v_profile from public.profiles where id = v_uid;
  if found then
    if (p_display_name is not null and length(trim(p_display_name)) > 0 and trim(p_display_name) <> v_profile.display_name)
       or (v_user.email is not null and v_profile.email is distinct from lower(v_user.email)) then
      update public.profiles
      set display_name = case
            when p_display_name is not null and length(trim(p_display_name)) > 0
            then left(trim(p_display_name), 40)
            else public.profiles.display_name
          end,
          email = coalesce(lower(v_user.email), public.profiles.email),
          updated_at = now()
      where id = v_uid
      returning * into v_profile;
    end if;
    return v_profile;
  end if;
  v_name := coalesce(
    nullif(left(trim(coalesce(p_display_name, '')), 40), ''),
    public.derive_display_name(v_user.raw_user_meta_data, v_user.email)
  );

  insert into public.profiles (id, display_name, email, friend_code)
  values (v_uid, v_name, lower(v_user.email), public.generate_friend_code(v_name))
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Look up a user by exact email or friend_code WITHOUT exposing emails publicly
create or replace function public.lookup_profile(identifier text)
returns table (
  id uuid,
  display_name text,
  friend_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ident text := ltrim(trim(coalesce(identifier, '')), '@');
  v_code_norm text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if length(v_ident) < 3 then
    return;
  end if;

  v_code_norm := regexp_replace(upper(v_ident), '[^A-Z0-9]', '', 'g');

  return query
  select p.id, p.display_name, p.friend_code
  from public.profiles p
  where lower(p.email) = lower(v_ident)
     or upper(p.friend_code) = upper(v_ident)
     or (position('@' in v_ident) = 0 and length(v_code_norm) >= 5
         and regexp_replace(upper(p.friend_code), '[^A-Z0-9]', '', 'g') = v_code_norm)
  limit 1;
end;
$$;

-- Send a friend request by email or friend_code (auto-accepts reciprocal pending)
create or replace function public.send_friend_request(identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_existing public.friendships%rowtype;
  v_ident text := ltrim(trim(coalesce(identifier, '')), '@');
  v_code_norm text;
  v_row public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Ensure caller has a profile
  perform public.ensure_my_profile(null);

  v_code_norm := regexp_replace(upper(v_ident), '[^A-Z0-9]', '', 'g');

  select * into v_target
  from public.profiles
  where lower(email) = lower(v_ident)
     or upper(friend_code) = upper(v_ident)
     or (position('@' in v_ident) = 0 and length(v_code_norm) >= 5
         and regexp_replace(upper(friend_code), '[^A-Z0-9]', '', 'g') = v_code_norm)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No player found with that email or friend code.');
  end if;

  if v_target.id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'You cannot add yourself as a friend.');
  end if;

  select * into v_existing
  from public.friendships
  where least(requester_id, addressee_id) = least(v_uid, v_target.id)
    and greatest(requester_id, addressee_id) = greatest(v_uid, v_target.id)
  limit 1;

  if found then
    if v_existing.status = 'accepted' then
      return jsonb_build_object(
        'ok', true,
        'status', 'already_friends',
        'friendship_id', v_existing.id,
        'target', jsonb_build_object('id', v_target.id, 'display_name', v_target.display_name, 'friend_code', v_target.friend_code)
      );
    elsif v_existing.status = 'pending' and v_existing.addressee_id = v_uid then
      update public.friendships
      set status = 'accepted', updated_at = now()
      where id = v_existing.id
      returning * into v_row;

      return jsonb_build_object(
        'ok', true,
        'status', 'accepted',
        'friendship_id', v_row.id,
        'target', jsonb_build_object('id', v_target.id, 'display_name', v_target.display_name, 'friend_code', v_target.friend_code)
      );
    elsif v_existing.status = 'pending' and v_existing.requester_id = v_uid then
      return jsonb_build_object(
        'ok', true,
        'status', 'already_pending',
        'friendship_id', v_existing.id,
        'target', jsonb_build_object('id', v_target.id, 'display_name', v_target.display_name, 'friend_code', v_target.friend_code)
      );
    else
      -- Re-open previously declined request
      update public.friendships
      set requester_id = v_uid,
          addressee_id = v_target.id,
          status = 'pending',
          updated_at = now()
      where id = v_existing.id
      returning * into v_row;

      return jsonb_build_object(
        'ok', true,
        'status', 'pending',
        'friendship_id', v_row.id,
        'target', jsonb_build_object('id', v_target.id, 'display_name', v_target.display_name, 'friend_code', v_target.friend_code)
      );
    end if;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_uid, v_target.id, 'pending')
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'friendship_id', v_row.id,
    'target', jsonb_build_object('id', v_target.id, 'display_name', v_target.display_name, 'friend_code', v_target.friend_code)
  );
end;
$$;

-- List all accepted + pending (incoming & outgoing) friendships with profile info
-- SECURITY DEFINER avoids table-grant/RLS gaps while strictly scoping to auth.uid().
create or replace function public.list_my_friends()
returns table (
  friendship_id uuid,
  requester_id uuid,
  addressee_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  other_user_id uuid,
  display_name text,
  friend_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    f.id as friendship_id,
    f.requester_id,
    f.addressee_id,
    f.status,
    f.created_at,
    f.updated_at,
    case when f.requester_id = v_uid then f.addressee_id else f.requester_id end as other_user_id,
    coalesce(p.display_name, 'Player') as display_name,
    coalesce(p.friend_code, '') as friend_code
  from public.friendships f
  left join public.profiles p
    on p.id = case when f.requester_id = v_uid then f.addressee_id else f.requester_id end
  where (f.requester_id = v_uid or f.addressee_id = v_uid)
    and f.status in ('pending', 'accepted')
  order by f.updated_at desc nulls last, f.created_at desc;
end;
$$;

-- Accept or decline a friend request (SECURITY DEFINER, strictly checks auth.uid())
create or replace function public.respond_friend_request(p_friendship_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_act text := lower(trim(coalesce(p_action, '')));
  v_next text;
  v_row public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_act in ('accept', 'accepted') then
    v_next := 'accepted';
  elsif v_act in ('decline', 'declined') then
    v_next := 'declined';
  else
    return jsonb_build_object('ok', false, 'error', 'Action must be accept or decline.');
  end if;

  select * into v_row
  from public.friendships
  where id = p_friendship_id
    and (requester_id = v_uid or addressee_id = v_uid);

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Friend request not found.');
  end if;

  if v_row.addressee_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'Only the recipient can respond to a friend request.');
  end if;

  if v_row.status = v_next then
    return jsonb_build_object('ok', true, 'status', v_row.status, 'friendship_id', v_row.id);
  end if;

  update public.friendships
  set status = v_next, updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'friendship_id', v_row.id);
end;
$$;

-- Remove an existing friend or cancel a pending request
create or replace function public.remove_friend(p_friendship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.friendships
  where id = p_friendship_id
    and (requester_id = v_uid or addressee_id = v_uid);

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'Friendship not found.');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Backfill profiles for any existing auth.users who signed up before this migration
insert into public.profiles (id, display_name, email, friend_code)
select
  u.id,
  public.derive_display_name(u.raw_user_meta_data, u.email),
  lower(u.email),
  public.generate_friend_code(public.derive_display_name(u.raw_user_meta_data, u.email))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Restrict RPC execute permissions to authenticated users
revoke all on function public.ensure_my_profile(text) from public;
grant execute on function public.ensure_my_profile(text) to authenticated;

revoke all on function public.lookup_profile(text) from public;
grant execute on function public.lookup_profile(text) to authenticated;

revoke all on function public.send_friend_request(text) from public;
grant execute on function public.send_friend_request(text) to authenticated;

revoke all on function public.list_my_friends() from public;
grant execute on function public.list_my_friends() to authenticated;

revoke all on function public.respond_friend_request(uuid, text) from public;
grant execute on function public.respond_friend_request(uuid, text) to authenticated;

revoke all on function public.remove_friend(uuid) from public;
grant execute on function public.remove_friend(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Explicit table grants & RLS for legacy score_history (prevents 42501)
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.score_history to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;
grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, update, delete on public.group_members to authenticated;
grant select, insert, update, delete on public.games to authenticated;
grant select, insert, update, delete on public.game_participants to authenticated;

alter table public.score_history enable row level security;

drop policy if exists "score_history_select_own" on public.score_history;
create policy "score_history_select_own" on public.score_history
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "score_history_insert_own" on public.score_history;
create policy "score_history_insert_own" on public.score_history
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "score_history_update_own" on public.score_history;
create policy "score_history_update_own" on public.score_history
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "score_history_delete_own" on public.score_history;
create policy "score_history_delete_own" on public.score_history
  for delete to authenticated
  using (user_id = auth.uid());
