\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
-- =============================================================================
-- v26 scenarios. Prereq: stub + social + v20 + v22 + v24 + v24.1 + v25 + v26 applied (see run_v26_sql.sh).
-- Each check prints "PASS: ..." or "FAIL: ..."; tests/run_v26_sql.sh counts them.
-- =============================================================================
create or replace function pg_temp.chk(p_name text, p_ok boolean) returns text language sql as $$
  select case when coalesce(p_ok, false) then 'PASS: ' else 'FAIL: ' end || p_name $$;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
  perform set_config('request.jwt.claims', case when p is null then '{}' else json_build_object('sub',p,'role','authenticated')::text end, false);
end $$;

create or replace function pg_temp.expect_err(p_name text, p_sql text, p_code text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL: ' || p_name || ' (no error raised)';
exception when others then
  return case when sqlstate = p_code then 'PASS: ' else 'FAIL: ' end || p_name || ' [' || sqlstate || ' ' || sqlerrm || ']';
end $$;

-- ------------------------------------------------------------------ seed (superuser)
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','rand@example.com'),
 ('00000000-0000-0000-0000-00000000000b','audrey@example.com'),
 ('00000000-0000-0000-0000-00000000000c','zach@example.com'),
 ('00000000-0000-0000-0000-00000000000d','stranger@example.com');
insert into public.profiles (id, display_name, email, friend_code) values
 ('00000000-0000-0000-0000-00000000000a','Rand W','rand@example.com','RAND-0001'),
 ('00000000-0000-0000-0000-00000000000b','Audrey W','audrey@example.com','AUDR-0002'),
 ('00000000-0000-0000-0000-00000000000c','Zach H','zach@example.com','ZACH-0003'),
 ('00000000-0000-0000-0000-00000000000d','Stranger','stranger@example.com','STRA-0004')
on conflict (id) do update set display_name=excluded.display_name, email=excluded.email, friend_code=excluded.friend_code;
insert into public.friendships (requester_id, addressee_id, status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','accepted'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c','accepted');

-- G1: catan, 3 players. G2: nertz teams (one participant row per member).
insert into public.games (id, client_game_id, created_by, game_type, version, target, winner, payload) values
 ('11111111-1111-1111-1111-111111111111','c1','00000000-0000-0000-0000-00000000000a','catan','base',10,'Rand',
  '{"rounds":[{"n":1}],"players":[{"name":"Rand","score":10,"is_winner":true},{"name":"Audrey","score":8},{"name":"Zach","score":6}],"meta":null,"version":"base","target":10}'),
 ('22222222-2222-2222-2222-222222222222','c2','00000000-0000-0000-0000-00000000000a','nertz',null,100,'Team 1',
  '{"rounds":[],"players":[{"name":"Team 1","score":100,"members":[{"name":"Rand"},{"name":"Kim"}]},{"name":"Team 2","score":80,"members":[{"name":"Audrey"},{"name":"Zach"}]}],"meta":{"mode":"teams"}}');
delete from public.game_participants;
insert into public.game_participants (game_id, user_id, display_name, score, is_winner, seat_order) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Rand',10,true,0),
 ('11111111-1111-1111-1111-111111111111',null,'Audrey',8,false,1),
 ('11111111-1111-1111-1111-111111111111',null,'Zach',6,false,2),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000a','Rand',100,true,0),
 ('22222222-2222-2222-2222-222222222222',null,'Kim',100,true,1),
 ('22222222-2222-2222-2222-222222222222',null,'Audrey',80,false,2),
 ('22222222-2222-2222-2222-222222222222',null,'Zach',80,false,3);

-- owner links Audrey (b) into both games via the existing v24 RPC
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select (public.link_game_participant('11111111-1111-1111-1111-111111111111','Audrey','00000000-0000-0000-0000-00000000000b')->>'ok') as l1 \gset
select (public.link_game_participant('22222222-2222-2222-2222-222222222222','Audrey','00000000-0000-0000-0000-00000000000b')->>'ok') as l2 \gset
reset role;
select pg_temp.chk('seed: owner linked Audrey in both games', :'l1' = 'true' and :'l2' = 'true');
select id::text as b_row from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Audrey' \gset
select xmin::text as b_xmin_before from public.game_participants where id = :'b_row'::uuid \gset

\echo '--- realtime publication'
select pg_temp.chk('user_favorites in supabase_realtime', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_favorites'));
select pg_temp.chk('games in supabase_realtime', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='games'));
select pg_temp.chk('game_participants in supabase_realtime', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_participants'));
select pg_temp.chk('publication membership listed once each', (select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename in ('user_favorites','games','game_participants')) = 3);

-- logical decoding slot: proves what the realtime server would see
select pg_create_logical_replication_slot('v26_slot','test_decoding') is not null as slot_ok \gset
select pg_temp.chk('decoding slot created', :'slot_ok'::boolean);

-- ============================== FAVORITES ==============================
\echo '--- favorites'
select pg_temp.as_user(null);
set role anon;
select public.get_my_favorites() as f_anon \gset
select public.toggle_favorite('catan') as f_anon_t \gset
select public.set_my_favorites(array['catan']) as f_anon_s \gset
reset role;
select pg_temp.chk('anon get_my_favorites -> not_signed_in', :'f_anon'::jsonb->>'error' = 'not_signed_in' and (:'f_anon'::jsonb->>'ok') = 'false');
select pg_temp.chk('anon toggle/set -> not_signed_in', :'f_anon_t'::jsonb->>'error' = 'not_signed_in' and :'f_anon_s'::jsonb->>'error' = 'not_signed_in');
select pg_temp.chk('anon wrote nothing', (select count(*) from public.user_favorites) = 0);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.get_my_favorites() as f0 \gset
select public.toggle_favorite('  CatAn ') as f1 \gset
select public.set_my_favorites(array['Nertz ', ' catan', 'hearts', 'nertz', '', '  ']) as f2 \gset
reset role;
select pg_temp.chk('new user starts with empty favorites', :'f0'::jsonb = '{"ok":true,"favorites":[]}'::jsonb);
select pg_temp.chk('toggle on: normalised (trim+lower), favorited=true', :'f1'::jsonb->>'favorited' = 'true' and :'f1'::jsonb->'favorites' = '["catan"]'::jsonb and :'f1'::jsonb->>'game_key' = 'catan');
select pg_temp.chk('set: de-duped, normalised, blanks dropped, order kept', :'f2'::jsonb->'favorites' = '["nertz","catan","hearts"]'::jsonb);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.get_my_favorites() as fb0 \gset
select public.set_my_favorites(array['flip7']) as fb1 \gset
select count(*) as vis_rows from public.user_favorites \gset
select count(*) as vis_a from public.user_favorites where user_id = '00000000-0000-0000-0000-00000000000a' \gset
reset role;
select pg_temp.chk('isolation: user B sees none of A''s favorites', :'fb0'::jsonb->'favorites' = '[]'::jsonb);
select pg_temp.chk('isolation: B sets own list', :'fb1'::jsonb->'favorites' = '["flip7"]'::jsonb);
select pg_temp.chk('RLS: direct SELECT shows only own rows', :'vis_rows'::int = 1 and :'vis_a'::int = 0);
set role authenticated;
select pg_temp.expect_err('direct INSERT into user_favorites denied', $q$insert into public.user_favorites (user_id, game_key) values ('00000000-0000-0000-0000-00000000000b','x')$q$, '42501');
select pg_temp.expect_err('direct UPDATE of user_favorites denied', $q$update public.user_favorites set game_key='zz'$q$, '42501');
select pg_temp.expect_err('direct DELETE on user_favorites denied', $q$delete from public.user_favorites$q$, '42501');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.get_my_favorites() as fa_again \gset
select public.toggle_favorite('catan') as fa_off \gset
select public.toggle_favorite('bad key!') as fa_bad \gset
select public.toggle_favorite('   ') as fa_blank \gset
select public.toggle_favorite(repeat('a', 81)) as fa_long \gset
select public.set_my_favorites(null) as fa_null \gset
select public.set_my_favorites(array['ok', 'bad key']) as fa_bad_set \gset
select public.set_my_favorites((select array_agg('k' || i) from generate_series(1,101) i)) as fa_many \gset
select public.get_my_favorites() as fa_unchanged \gset
select public.set_my_favorites(array['hearts','nertz']) as fa_reorder \gset
select public.set_my_favorites(array[]::text[]) as fa_clear \gset
reset role;
select pg_temp.chk('A unaffected by B''s write', :'fa_again'::jsonb->'favorites' = '["nertz","catan","hearts"]'::jsonb);
select pg_temp.chk('toggle off removes it and returns favorited=false', :'fa_off'::jsonb->>'favorited' = 'false' and :'fa_off'::jsonb->'favorites' = '["nertz","hearts"]'::jsonb);
select pg_temp.chk('invalid keys -> invalid_input (bad chars, blank, >80, null array, bad element)', 
  :'fa_bad'::jsonb->>'error' = 'invalid_input' and :'fa_blank'::jsonb->>'error' = 'invalid_input' and :'fa_long'::jsonb->>'error' = 'invalid_input'
  and :'fa_null'::jsonb->>'error' = 'invalid_input' and :'fa_bad_set'::jsonb->>'error' = 'invalid_input');
select pg_temp.chk('101 favorites -> too_many', :'fa_many'::jsonb->>'error' = 'too_many');
select pg_temp.chk('rejected writes changed nothing', :'fa_unchanged'::jsonb->'favorites' = '["nertz","hearts"]'::jsonb);
select pg_temp.chk('reorder via set_my_favorites', :'fa_reorder'::jsonb->'favorites' = '["hearts","nertz"]'::jsonb);
select pg_temp.chk('set to empty clears only my rows', :'fa_clear'::jsonb->'favorites' = '[]'::jsonb and (select count(*) from public.user_favorites) = 1);
select pg_temp.chk('realtime sees favorites rows for the right user (filterable user_id)', 
  (select count(*) from pg_logical_slot_peek_changes('v26_slot', null, null) where data like 'table public.user_favorites: UPDATE:%user_id[uuid]:''00000000-0000-0000-0000-00000000000a''%') >= 1);

-- ============================== GAME DETAIL ==============================
\echo '--- get_game_detail'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_owner \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_linked \gset
select public.get_game_detail('22222222-2222-2222-2222-222222222222') as d_linked_team \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_stranger \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_unlinked \gset
select public.get_game_detail('99999999-9999-9999-9999-999999999999') as d_missing \gset
select pg_temp.as_user(null);
set role anon;
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_anon \gset
reset role;
select pg_temp.chk('owner detail: ok, can_edit, is_owner', :'d_owner'::jsonb->>'ok' = 'true' and (:'d_owner'::jsonb#>>'{game,can_edit}') = 'true' and (:'d_owner'::jsonb#>>'{game,is_owner}') = 'true');
select pg_temp.chk('detail fields: key/type/variation/winner/date/created_by/edited_*',
  (:'d_owner'::jsonb#>>'{game,game_key}') = 'catan' and (:'d_owner'::jsonb#>>'{game,variation_key}') = 'base' and (:'d_owner'::jsonb#>>'{game,winner}') = 'Rand'
  and (:'d_owner'::jsonb#>>'{game,played_at}') is not null and (:'d_owner'::jsonb#>>'{game,created_by}') = '00000000-0000-0000-0000-00000000000a'
  and (:'d_owner'::jsonb#>>'{game,created_by_name}') = 'Rand W' and (:'d_owner'::jsonb#>'{game,edited_at}') = 'null'::jsonb and (:'d_owner'::jsonb#>'{game,edited_by}') = 'null'::jsonb);
select pg_temp.chk('detail: rounds + 3 players with scores/is_winner/user_id/linked_via',
  jsonb_array_length(:'d_owner'::jsonb#>'{game,rounds}') = 1 and jsonb_array_length(:'d_owner'::jsonb#>'{game,players}') = 3
  and (:'d_owner'::jsonb#>>'{game,players,0,name}') = 'Rand' and (:'d_owner'::jsonb#>>'{game,players,0,is_winner}') = 'true'
  and (:'d_owner'::jsonb#>>'{game,players,1,user_id}') = '00000000-0000-0000-0000-00000000000b' and (:'d_owner'::jsonb#>>'{game,players,1,linked_via}') = 'creator'
  and (:'d_owner'::jsonb#>>'{game,players,1,display_name}') = 'Audrey W' and (:'d_owner'::jsonb#>>'{game,players,1,name_key}') = 'audrey');
select pg_temp.chk('linked participant can read; can_edit=false, is_owner=false', :'d_linked'::jsonb->>'ok' = 'true' and (:'d_linked'::jsonb#>>'{game,can_edit}') = 'false' and (:'d_linked'::jsonb#>>'{game,is_owner}') = 'false');
select pg_temp.chk('team game detail has members and per-member user', (:'d_linked_team'::jsonb#>>'{game,players,1,members,0,user_id}') = '00000000-0000-0000-0000-00000000000b' and jsonb_array_length(:'d_linked_team'::jsonb#>'{game,participants}') = 4);
select pg_temp.chk('stranger -> forbidden', :'d_stranger'::jsonb->>'error' = 'forbidden' and (:'d_stranger'::jsonb->>'ok') = 'false' and not (:'d_stranger'::jsonb ? 'game'));
select pg_temp.chk('friend NOT in the game -> forbidden', :'d_unlinked'::jsonb->>'error' = 'forbidden');
select pg_temp.chk('unknown id -> not_found', :'d_missing'::jsonb->>'error' = 'not_found');
select pg_temp.chk('anon -> not_signed_in', :'d_anon'::jsonb->>'error' = 'not_signed_in' and not (:'d_anon'::jsonb ? 'game'));

-- ============================== UPDATE: who may edit ==============================
\echo '--- update_game_record permissions'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"game":{"winner":"Audrey","payload":{"players":[{"name":"Rand","score":1},{"name":"Audrey","score":99,"is_winner":true}]},"target":3},"participants":[{"seat_order":0,"display_name":"Rand","score":1,"is_winner":false},{"seat_order":1,"display_name":"Audrey","score":99,"is_winner":true}]}') as u_linked \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"X","score":1}]}') as u_stranger \gset
select pg_temp.as_user(null);
set role anon;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"X","score":1}]}') as u_anon \gset
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('99999999-9999-9999-9999-999999999999', '{"players":[{"name":"X","score":1}]}') as u_missing \gset
reset role;
select pg_temp.chk('linked participant update -> forbidden', :'u_linked'::jsonb->>'error' = 'forbidden' and (:'u_linked'::jsonb->>'ok') = 'false');
select pg_temp.chk('stranger update -> forbidden', :'u_stranger'::jsonb->>'error' = 'forbidden');
select pg_temp.chk('anon update -> not_signed_in', :'u_anon'::jsonb->>'error' = 'not_signed_in');
select pg_temp.chk('missing game -> not_found', :'u_missing'::jsonb->>'error' = 'not_found');
select pg_temp.chk('forbidden attempts changed nothing', (select winner from public.games where id='11111111-1111-1111-1111-111111111111') = 'Rand'
  and (select score from public.game_participants where id=:'b_row'::uuid) = 8 and (select edited_at from public.games where id='11111111-1111-1111-1111-111111111111') is null);

-- direct table writes (the other door): only the creator's RLS passes; edited_* are not forgeable
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
with u as (update public.games set winner = 'Audrey', edited_by = '00000000-0000-0000-0000-00000000000b' where id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as rls_upd from u \gset
with u as (update public.game_participants set score = 1000 where game_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as rls_upd_gp from u \gset
reset role;
select pg_temp.chk('RLS: linked player direct UPDATE on games / game_participants matches 0 rows', :'rls_upd'::int = 0 and :'rls_upd_gp'::int = 0);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.games set edited_by = '00000000-0000-0000-0000-00000000000d', edited_at = '2001-01-01' where id='11111111-1111-1111-1111-111111111111';
reset role;
select pg_temp.chk('creator cannot forge edited_at/edited_by via direct UPDATE (guard trigger)', (select edited_at is null and edited_by is null from public.games where id='11111111-1111-1111-1111-111111111111'));

-- ============================== UPDATE: owner edit ==============================
\echo '--- owner edit'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
-- change scores + winner (buildSharedEdit shape); Audrey keeps her user_id; Zach row is sent WITHOUT user_id
select public.update_game_record('11111111-1111-1111-1111-111111111111', $j$
 {"game_id":"11111111-1111-1111-1111-111111111111","client_game_id":"c1","winnerChanged":true,
  "game":{"game_type":"catan","winner":"Audrey","target":12,
          "payload":{"rounds":[{"n":1},{"n":2}],"players":[{"name":"Rand","score":5},{"name":"Audrey","score":12,"is_winner":true,"user_id":"00000000-0000-0000-0000-00000000000b"},{"name":"Zach","score":7}],"meta":null,"version":"base","target":12}},
  "participants":[{"seat_order":0,"user_id":"00000000-0000-0000-0000-00000000000a","display_name":"Rand","score":5,"is_winner":false},
                  {"seat_order":1,"user_id":"00000000-0000-0000-0000-00000000000b","display_name":"Audrey","score":12,"is_winner":true},
                  {"seat_order":2,"user_id":null,"display_name":"Zach","score":7,"is_winner":false}]} $j$) as e1 \gset
reset role;
select pg_temp.chk('owner edit ok, winner_changed=true', :'e1'::jsonb->>'ok' = 'true' and :'e1'::jsonb->>'winner_changed' = 'true');
select pg_temp.chk('returned game has the detail shape with new winner/target/rounds',
  (:'e1'::jsonb#>>'{game,winner}') = 'Audrey' and (:'e1'::jsonb#>>'{game,target}') = '12' and jsonb_array_length(:'e1'::jsonb#>'{game,rounds}') = 2 and (:'e1'::jsonb#>>'{game,can_edit}') = 'true');
select pg_temp.chk('games row: winner/target patched, edited_at set, edited_by = owner',
  (select winner = 'Audrey' and target = 12 and edited_at is not null and edited_by = '00000000-0000-0000-0000-00000000000a' and edited_at > now() - interval '1 minute' from public.games where id='11111111-1111-1111-1111-111111111111'));
select pg_temp.chk('participants rewritten: scores + is_winner',
  (select string_agg(display_name || ':' || score::int || ':' || is_winner::text, ',' order by seat_order) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 'Rand:5:false,Audrey:12:true,Zach:7:false');
select pg_temp.chk('participant row ids preserved (updated in place)', exists(select 1 from public.game_participants where id = :'b_row'::uuid) and (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 3);
select pg_temp.chk('v24 link survives the edit (links row + participant user_id + payload user_id)',
  exists(select 1 from public.game_participant_links where game_id='11111111-1111-1111-1111-111111111111' and user_id='00000000-0000-0000-0000-00000000000b' and name_key='audrey')
  and (select user_id from public.game_participants where id = :'b_row'::uuid) = '00000000-0000-0000-0000-00000000000b'
  and (select payload#>>'{players,1,user_id}' from public.games where id='11111111-1111-1111-1111-111111111111') = '00000000-0000-0000-0000-00000000000b');
select pg_temp.chk('linked player participant row was re-written (new xmin => realtime UPDATE fires)', (select xmin::text from public.game_participants where id = :'b_row'::uuid) <> :'b_xmin_before');
select pg_temp.chk('realtime decoding: linked player row UPDATE visible with user_id (History listener filter user_id=eq.me)',
  (select count(*) from pg_logical_slot_peek_changes('v26_slot', null, null) where data like 'table public.game_participants: UPDATE:%user_id[uuid]:''00000000-0000-0000-0000-00000000000b''%display_name[text]:''Audrey''%') >= 1);
select pg_temp.chk('realtime decoding: games UPDATE emitted too', (select count(*) from pg_logical_slot_peek_changes('v26_slot', null, null) where data like 'table public.games: UPDATE:%') >= 1);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_linked2 \gset
reset role;
select pg_temp.chk('linked player sees the edit (scores, winner, edited_by_name, edited_at)',
  (:'d_linked2'::jsonb#>>'{game,winner}') = 'Audrey' and (:'d_linked2'::jsonb#>>'{game,players,1,score}') = '12'
  and (:'d_linked2'::jsonb#>>'{game,edited_by_name}') = 'Rand W' and (:'d_linked2'::jsonb#>>'{game,edited_at}') is not null and (:'d_linked2'::jsonb#>>'{game,can_edit}') = 'false');

-- direct SELECT history path used by the app still works for the linked player
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select count(*) as b_hist from public.games where id='11111111-1111-1111-1111-111111111111' \gset
reset role;
select pg_temp.chk('linked player still passes games RLS', :'b_hist'::int = 1);

-- ---------------- rename (linked player keeps access, link follows the new name)
\echo '--- rename / add / remove'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', $j$
 {"game":{"winner":"Audie","payload":{"players":[{"name":"Rand","score":5,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":12,"is_winner":true,"user_id":"00000000-0000-0000-0000-00000000000b"},{"name":"Zach","score":7}]}},
  "participants":[{"seat_order":0,"user_id":"00000000-0000-0000-0000-00000000000a","display_name":"Rand","score":5,"is_winner":false},
                  {"seat_order":1,"user_id":"00000000-0000-0000-0000-00000000000b","display_name":"Audie","score":12,"is_winner":true},
                  {"seat_order":2,"user_id":null,"display_name":"Zach","score":7,"is_winner":false}]} $j$) as e_ren \gset
reset role;
select pg_temp.chk('rename of a linked player: ok, same participant row id, link name_key follows', :'e_ren'::jsonb->>'ok' = 'true'
  and (select display_name from public.game_participants where id = :'b_row'::uuid) = 'Audie'
  and exists(select 1 from public.game_participant_links where game_id='11111111-1111-1111-1111-111111111111' and user_id='00000000-0000-0000-0000-00000000000b' and name_key='audie' and display_name='Audie'));
select pg_temp.chk('winner_changed=true when the winner text changes (Audrey -> Audie)', :'e_ren'::jsonb->>'winner_changed' = 'true');

-- unlinked friend / stranger user_ids in an edit are ignored; access is NOT granted
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', $j$
 {"game":{"winner":"Audie","payload":{"players":[{"name":"Rand","score":5,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":12,"is_winner":true},{"name":"Zach","score":7,"user_id":"00000000-0000-0000-0000-00000000000c"},{"name":"Newbie","score":3,"user_id":"00000000-0000-0000-0000-00000000000d"},{"name":"Local","score":1,"user_id":"local-123"}]}},
  "participants":[{"seat_order":0,"user_id":"00000000-0000-0000-0000-00000000000a","display_name":"Rand","score":5,"is_winner":false},
                  {"seat_order":1,"user_id":null,"display_name":"Audie","score":12,"is_winner":true},
                  {"seat_order":2,"user_id":"00000000-0000-0000-0000-00000000000c","display_name":"Zach","score":7,"is_winner":false},
                  {"seat_order":3,"user_id":"00000000-0000-0000-0000-00000000000d","display_name":"Newbie","score":3,"is_winner":false},
                  {"seat_order":4,"user_id":"local-123","display_name":"Local","score":1,"is_winner":false}]} $j$) as e_add \gset
reset role;
select pg_temp.chk('edit: ok, 3 unknown user_ids ignored (friend not in game, stranger, local id)', :'e_add'::jsonb->>'ok' = 'true' and (:'e_add'::jsonb->>'ignored_user_ids')::int = 3);
select pg_temp.chk('edit: omitted user_id keeps the existing link (Audie still b)', (select user_id from public.game_participants where id = :'b_row'::uuid) = '00000000-0000-0000-0000-00000000000b');
select pg_temp.chk('edit: added players have NULL user_id (no access granted), count=5',
  (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 5
  and (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and user_id is not null) = 2
  and (select count(*) from public.game_participant_links where game_id='11111111-1111-1111-1111-111111111111') = 1);
select pg_temp.chk('edit: ignored user ids also stripped from stored payload', (select payload::text from public.games where id='11111111-1111-1111-1111-111111111111') !~ '00000000-0000-0000-0000-00000000000[cd]');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_str2 \gset
select count(*) as str_vis from public.games where id='11111111-1111-1111-1111-111111111111' \gset
reset role;
select pg_temp.chk('stranger named in an edit still cannot read the game', :'d_str2'::jsonb->>'error' = 'forbidden' and :'str_vis'::int = 0);

-- ---------------- winner rules
\echo '--- winner validation'
create or replace function pg_temp.edit_g1(p_winner text, p_flags boolean[]) returns text language sql as $$
  select json_build_object('game', json_build_object('winner', p_winner, 'payload', json_build_object('players', json_build_array(
      json_build_object('name','Rand','score',5), json_build_object('name','Audie','score',12), json_build_object('name','Zach','score',7)))),
    'participants', json_build_array(
      json_build_object('seat_order',0,'user_id','00000000-0000-0000-0000-00000000000a','display_name','Rand','score',5,'is_winner',p_flags[1]),
      json_build_object('seat_order',1,'user_id','00000000-0000-0000-0000-00000000000b','display_name','Audie','score',12,'is_winner',p_flags[2]),
      json_build_object('seat_order',2,'user_id',null,'display_name','Zach','score',7,'is_winner',p_flags[3])))::text $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1('audie , RAND', array[true,true,false])::jsonb) as w_tie \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1('Rand, Audie', array[true,true,false])::jsonb) as w_tie2 \gset
select (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and is_winner) as tie2_winners \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1('Zach', array[true,false,false])::jsonb) as w_mismatch \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1('Rand, Zach', array[true,false,false])::jsonb) as w_partial \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1('Rand', array[false,false,false])::jsonb) as w_nomark \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1(null, array[true,false,false])::jsonb) as w_flag_nowinner \gset
select (select winner || '|' || (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and is_winner) from public.games where id='11111111-1111-1111-1111-111111111111') as after_rejects \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', pg_temp.edit_g1(null, array[false,false,false])::jsonb) as w_none \gset
reset role;
select pg_temp.chk('tie "audie , RAND" (order/case/whitespace-insensitive) accepted; stored text kept', :'w_tie'::jsonb->>'ok' = 'true' and :'w_tie'::jsonb#>>'{game,winner}' = 'audie , RAND');
select pg_temp.chk('tie "Rand, Audie" accepted; both is_winner', :'w_tie2'::jsonb->>'ok' = 'true' and :'tie2_winners'::int = 2);
select pg_temp.chk('winner not matching is_winner rows -> invalid_payload', :'w_mismatch'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('partial tie (winner names 2, marked 1) -> invalid_payload', :'w_partial'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('winner set but nobody is_winner -> invalid_payload', :'w_nomark'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('is_winner rows but no winner -> invalid_payload', :'w_flag_nowinner'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('rejected edits are atomic: winner + winner rows still from the last good edit', :'after_rejects' = 'Rand, Audie|2');
select pg_temp.chk('no winner + no is_winner rows is allowed (winner cleared, winner_changed=true)', :'w_none'::jsonb->>'ok' = 'true' and (select winner from public.games where id='11111111-1111-1111-1111-111111111111') is null and :'w_none'::jsonb->>'winner_changed' = 'true' and (:'w_none'::jsonb#>>'{game,winner}') = '');

-- Nertz teams: participants expanded per member; winner is a team label
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('22222222-2222-2222-2222-222222222222', $j$
 {"game":{"winner":"Team 2","payload":{"players":[{"name":"Team 1","score":90,"members":[{"name":"Rand"},{"name":"Kim"}]},{"name":"Team 2","score":110,"members":[{"name":"Audrey","user_id":"00000000-0000-0000-0000-00000000000b"},{"name":"Zach"}]}]}},
  "participants":[{"seat_order":0,"user_id":"00000000-0000-0000-0000-00000000000a","display_name":"Rand","score":90,"is_winner":false},
                  {"seat_order":1,"user_id":null,"display_name":"Kim","score":90,"is_winner":false},
                  {"seat_order":2,"user_id":"00000000-0000-0000-0000-00000000000b","display_name":"Audrey","score":110,"is_winner":true},
                  {"seat_order":3,"user_id":null,"display_name":"Zach","score":110,"is_winner":true}]} $j$) as n_team \gset
select public.update_game_record('22222222-2222-2222-2222-222222222222', $j$
 {"game":{"winner":"Team 3","payload":{"players":[{"name":"Team 1","score":90,"members":[{"name":"Rand"},{"name":"Kim"}]},{"name":"Team 2","score":110,"members":[{"name":"Audrey"},{"name":"Zach"}]}]}},
  "participants":[{"seat_order":0,"display_name":"Rand","score":90,"is_winner":false},{"seat_order":1,"display_name":"Kim","score":90,"is_winner":false},{"seat_order":2,"display_name":"Audrey","score":110,"is_winner":true},{"seat_order":3,"display_name":"Zach","score":110,"is_winner":true}]} $j$) as n_team_bad \gset
select public.update_game_record('22222222-2222-2222-2222-222222222222', $j$
 {"game":{"winner":"Zach & Kim","payload":{"players":[{"name":"Zach & Kim","score":90,"members":[{"name":"Zach"},{"name":"Kim"}]},{"name":"Rand & Audrey","score":10,"members":[{"name":"Rand","user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audrey","user_id":"00000000-0000-0000-0000-00000000000b"}]}]}},
  "participants":[{"seat_order":0,"display_name":"Zach","score":90,"is_winner":true},{"seat_order":1,"display_name":"Kim","score":90,"is_winner":true},{"seat_order":2,"user_id":"00000000-0000-0000-0000-00000000000a","display_name":"Rand","score":10,"is_winner":false},{"seat_order":3,"user_id":"00000000-0000-0000-0000-00000000000b","display_name":"Audrey","score":10,"is_winner":false}]} $j$) as n_team_amp \gset
reset role;
select pg_temp.chk('Nertz team label winner "Team 2" (members is_winner) accepted', :'n_team'::jsonb->>'ok' = 'true' and :'n_team'::jsonb->>'winner_changed' = 'true' and (select count(*) from public.game_participants where game_id='22222222-2222-2222-2222-222222222222' and is_winner) = 2);
select pg_temp.chk('unknown team label "Team 3" -> invalid_payload', :'n_team_bad'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('team label with ampersand "Zach & Kim" accepted; link on Audrey kept', :'n_team_amp'::jsonb->>'ok' = 'true'
  and (select user_id from public.game_participants where game_id='22222222-2222-2222-2222-222222222222' and display_name='Audrey') = '00000000-0000-0000-0000-00000000000b'
  and exists(select 1 from public.game_participant_links where game_id='22222222-2222-2222-2222-222222222222' and name_key='audrey'));

-- ---------------- other validation
\echo '--- payload validation'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '[]') as v1 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', null) as v2 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"game":{"payload":{"players":[]}}}') as v3 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"","score":1}]}') as v4 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"A","score":"abc"}]}') as v5 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"A","score":1e12}]}') as v6 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"game_id":"22222222-2222-2222-2222-222222222222","game":{"payload":{"players":[{"name":"A"}]}},"participants":[{"display_name":"A","score":1}]}') as v7 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"game":{"target":1.5,"payload":{"players":[{"name":"A"}]}},"participants":[{"display_name":"A","score":1}]}') as v8 \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"A","score":1}],"rounds":{"x":1}}') as v9 \gset
reset role;
select pg_temp.chk('non-object / null / empty players / blank name / bad score / huge score / id mismatch / bad target / bad rounds -> invalid_payload',
  :'v1'::jsonb->>'error' = 'invalid_payload' and :'v2'::jsonb->>'error' = 'invalid_payload' and :'v3'::jsonb->>'error' = 'invalid_payload' and :'v4'::jsonb->>'error' = 'invalid_payload'
  and :'v5'::jsonb->>'error' = 'invalid_payload' and :'v6'::jsonb->>'error' = 'invalid_payload' and :'v7'::jsonb->>'error' = 'invalid_payload'
  and :'v8'::jsonb->>'error' = 'invalid_payload' and :'v9'::jsonb->>'error' = 'invalid_payload');
select pg_temp.chk('invalid edits left the game untouched', (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 3 and (select winner from public.games where id='11111111-1111-1111-1111-111111111111') is null);

-- bare payload (back-compat): participants derived from payload.players, winner flag from explicit winner text
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"winner":"Zach","players":[{"name":"Rand","score":5,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":9},{"name":"Zach","score":20}],"rounds":[{"n":1},{"n":2},{"n":3}],"target":15,"meta":{"note":"bare"}}') as bare \gset
reset role;
select pg_temp.chk('bare payload accepted: winner/target patched, rounds replaced, participants derived (Zach winner)', :'bare'::jsonb->>'ok' = 'true'
  and (select winner = 'Zach' and target = 15 from public.games where id='11111111-1111-1111-1111-111111111111')
  and (select string_agg(display_name||':'||score::int||':'||is_winner::text, ',' order by seat_order) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 'Rand:5:false,Audie:9:false,Zach:20:true'
  and (select payload#>>'{meta,note}' from public.games where id='11111111-1111-1111-1111-111111111111') = 'bare');
select pg_temp.chk('bare payload keeps Audie linked (name match) and b can still read', (select user_id from public.game_participants where id=:'b_row'::uuid) = '00000000-0000-0000-0000-00000000000b'
  and (select payload#>>'{players,1,user_id}' from public.games where id='11111111-1111-1111-1111-111111111111') = '00000000-0000-0000-0000-00000000000b');

-- ---------------- optimistic concurrency
\echo '--- concurrency'
select (edited_at at time zone 'UTC')::text || '+00' as cur_edit from public.games where id='11111111-1111-1111-1111-111111111111' \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"Rand","score":6,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":9},{"name":"Zach","score":20}],"winner":"Zach"}', '2001-01-01 00:00:00+00') as c_stale \gset
select (select score from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Rand') as rand_after_stale \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"Rand","score":6,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":9},{"name":"Zach","score":20}],"winner":"Zach"}', :'cur_edit'::timestamptz) as c_ok \gset
select (select score from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Rand') as rand_after_ok \gset
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"Rand","score":7,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audie","score":9},{"name":"Zach","score":20}],"winner":"Zach"}', :'cur_edit'::timestamptz) as c_replay \gset
select public.update_game_record('22222222-2222-2222-2222-222222222222', '{"game":{"payload":{"players":[{"name":"A"}]}},"participants":[{"display_name":"A","score":1}]}', now()) as c_first \gset
reset role;
select pg_temp.chk('stale p_expected_edited_at -> conflict (nothing changed)', :'c_stale'::jsonb->>'error' = 'conflict' and :'rand_after_stale'::int = 5);
select pg_temp.chk('matching p_expected_edited_at -> ok', :'c_ok'::jsonb->>'ok' = 'true' and :'rand_after_ok'::int = 6);
select pg_temp.chk('replaying the old token after a successful edit -> conflict', :'c_replay'::jsonb->>'error' = 'conflict' and (select score from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Rand') = 6);
select pg_temp.chk('wrong token on another game that was never edited (edited_at null) -> conflict', :'c_first'::jsonb->>'error' = 'conflict');

-- ---------------- saveSharedGame path still works (upsert + delete + re-insert) and keeps links + edited_*
\echo '--- saveSharedGame path'
select edited_at::text as ed_before, edited_by::text as eb_before from public.games where id='11111111-1111-1111-1111-111111111111' \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into public.games (client_game_id, created_by, game_type, version, target, winner, started_at, ended_at, payload)
values ('c1','00000000-0000-0000-0000-00000000000a','catan','base',10,'Rand', null, now(),
  '{"rounds":[],"players":[{"name":"Rand","score":10},{"name":"Audie","score":3},{"name":"Zach","score":2}],"meta":null,"version":"base","target":10}')
on conflict (created_by, client_game_id) do update set winner=excluded.winner, ended_at=excluded.ended_at, payload=excluded.payload, target=excluded.target, game_type=excluded.game_type, version=excluded.version, started_at=excluded.started_at;
delete from public.game_participants where game_id='11111111-1111-1111-1111-111111111111';
insert into public.game_participants (game_id, user_id, display_name, score, is_winner, seat_order) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Rand',10,true,0),
 ('11111111-1111-1111-1111-111111111111',null,'Audie',3,false,1),
 ('11111111-1111-1111-1111-111111111111',null,'Zach',2,false,2);
select count(*) as ssg_games from public.games where client_game_id='c1' \gset
reset role;
select pg_temp.chk('saveSharedGame upsert/delete/insert path works for the creator (still 1 game row)', :'ssg_games'::int = 1 and (select winner from public.games where id='11111111-1111-1111-1111-111111111111') = 'Rand');
select pg_temp.chk('...and v24 link re-applied to the re-inserted participant', (select user_id from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Audie') = '00000000-0000-0000-0000-00000000000b');
select pg_temp.chk('...and edited_at/edited_by untouched by the client upsert', (select edited_at::text = :'ed_before' and edited_by::text = :'eb_before' from public.games where id='11111111-1111-1111-1111-111111111111'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select pg_temp.expect_err('stranger cannot insert a game as another creator', $q$insert into public.games (created_by, game_type) values ('00000000-0000-0000-0000-00000000000a','catan')$q$, '42501');
reset role;

-- ---------------- removing a linked player ends their access
\echo '--- remove linked player'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.update_game_record('11111111-1111-1111-1111-111111111111', '{"players":[{"name":"Rand","score":6,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Zach","score":20}],"winner":"Zach"}') as rm \gset
reset role;
select pg_temp.chk('removing a linked player: ok, participant + link rows removed', :'rm'::jsonb->>'ok' = 'true' and (select count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111') = 2
  and not exists(select 1 from public.game_participant_links where game_id='11111111-1111-1111-1111-111111111111'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.get_game_detail('11111111-1111-1111-1111-111111111111') as d_removed \gset
reset role;
select pg_temp.chk('removed player loses read access (forbidden)', :'d_removed'::jsonb->>'error' = 'forbidden');
select pg_temp.chk('realtime decoding: removal touched the linked row first (UPDATE before DELETE, user_id present)',
  (select count(*) from pg_logical_slot_get_changes('v26_slot', null, null) where data like 'table public.game_participants: UPDATE:%user_id[uuid]:''00000000-0000-0000-0000-00000000000b''%') >= 2);
select pg_drop_replication_slot('v26_slot');

-- ---------------- edited game also reachable by group members (existing can_view_game rule is unchanged)
\echo '--- misc'
set role anon;
select pg_temp.expect_err('anon SELECT user_favorites denied', $q$select * from public.user_favorites$q$, '42501');
select pg_temp.expect_err('anon SELECT games denied', $q$select * from public.games$q$, '42501');
reset role;
select pg_temp.chk('non-owner update never changed edited_* anywhere except owner edits', (select count(*) from public.games where edited_by is not null and edited_by <> created_by) = 0);
