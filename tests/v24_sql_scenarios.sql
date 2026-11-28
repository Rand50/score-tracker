\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
-- Seed (as superuser)
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','randw50@gmail.com'),
 ('00000000-0000-0000-0000-00000000000b','audrey.w@example.com'),
 ('00000000-0000-0000-0000-00000000000c','zach@example.com'),
 ('00000000-0000-0000-0000-00000000000d','stranger@example.com');
insert into public.profiles (id, display_name, email, friend_code) values
 ('00000000-0000-0000-0000-00000000000a','Rand Wilkinson','randw50@gmail.com','RAND-0001'),
 ('00000000-0000-0000-0000-00000000000b','Audrey','audrey.w@example.com','AUDR-0002'),
 ('00000000-0000-0000-0000-00000000000c','Zach Hennessey','zach@example.com','ZACH-0003'),
 ('00000000-0000-0000-0000-00000000000d','Audrey','stranger@example.com','STRA-0004')
on conflict (id) do update set display_name=excluded.display_name, email=excluded.email;
insert into public.friendships (requester_id, addressee_id, status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','accepted');
insert into public.games (id, client_game_id, created_by, game_type, payload) values
 ('11111111-1111-1111-1111-111111111111','g_1','00000000-0000-0000-0000-00000000000a','catan',
  '{"players":[{"name":"Rand","score":10,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audrey","score":8},{"name":"Zach H","score":6}]}'),
 ('22222222-2222-2222-2222-222222222222','g_2','00000000-0000-0000-0000-00000000000a','nertz',
  '{"meta":{"mode":"teams"},"players":[{"name":"Team A","score":50,"members":[{"name":"Rand","user_id":"00000000-0000-0000-0000-00000000000a"},{"name":" audrey ","score":0}]}]}');
insert into public.game_participants (game_id, user_id, display_name, score, seat_order) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Rand',10,0),
 ('11111111-1111-1111-1111-111111111111',null,'Audrey',8,1),
 ('11111111-1111-1111-1111-111111111111',null,'Zach H',6,2),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000a','Rand',50,0),
 ('22222222-2222-2222-2222-222222222222',null,'audrey',50,1);

create or replace function pg_temp.as_user(p uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
  perform set_config('request.jwt.claims', case when p is null then '{}' else json_build_object('sub',p,'email',p_email,'role','authenticated')::text end, false);
end $$;

-- T1 stranger cannot see Rand's game
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d','stranger@example.com');
set role authenticated;
select 'T1 stranger visible games=' || count(*) from public.games;
-- T2 stranger suggestions empty (not a friend, even with matching name)
select 'T2 stranger suggestions=' || count(*) from public.suggest_my_unlinked_games();
-- T3 stranger cannot link
select 'T3 ' || (public.link_game_participant('11111111-1111-1111-1111-111111111111','Audrey','00000000-0000-0000-0000-00000000000d')->>'code');
reset role;

-- T4 Audrey suggestions find both games
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','audrey.w@example.com');
set role authenticated;
select 'T4 audrey suggestions=' || count(*) || ' reasons=' || string_agg(match_reason, ',') from public.suggest_my_unlinked_games();
select 'T4b audrey visible before=' || count(*) from public.games;
reset role;

-- T5 Rand links stranger -> not_friends; creates claim for Zach H
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select 'T5 ' || (public.link_game_participant('11111111-1111-1111-1111-111111111111','Zach H','00000000-0000-0000-0000-00000000000d')->>'code');
select set_config('test.claim', public.create_participant_claim('11111111-1111-1111-1111-111111111111','Zach H')->>'token', false) is not null as made;
select 'T5b same token on reshare=' || ((public.create_participant_claim('11111111-1111-1111-1111-111111111111','zach h')->>'token') = current_setting('test.claim'));
reset role;

-- T6 anon preview
select pg_temp.as_user(null, null);
set role anon;
select 'T6 preview=' || (public.preview_participant_claim(current_setting('test.claim'))->>'status') || ' ' || (public.preview_participant_claim(current_setting('test.claim'))->>'participant_name');
reset role;

-- T7 Zach claims (not a friend; token is the permission) and can now read the game
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c','zach@example.com');
set role authenticated;
select 'T7 claim ok=' || (public.claim_game_participant(current_setting('test.claim'))->>'ok');
select 'T7b zach visible games=' || count(*) from public.games;
select 'T7c zach sees participants=' || count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111';
reset role;

-- T8 stranger reuses claimed token
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d','stranger@example.com');
set role authenticated;
select 'T8 ' || (public.claim_game_participant(current_setting('test.claim'))->>'code');
reset role;

-- T9 Audrey one-tap claims suggestion in team game + catan game via direct creator link
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','audrey.w@example.com');
set role authenticated;
select 'T9 suggestion ok=' || (public.claim_suggested_participant((select participant_id from public.suggest_my_unlinked_games() where game_id='22222222-2222-2222-2222-222222222222'))->>'ok');
reset role;
select 'T9b team payload member user_id=' || (payload->'players'->0->'members'->1->>'user_id') from public.games where id='22222222-2222-2222-2222-222222222222';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select 'T9c creator link ok=' || (public.link_game_participant('11111111-1111-1111-1111-111111111111',(select id::text from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and display_name='Audrey'),'00000000-0000-0000-0000-00000000000b')->>'ok');
-- T10 app re-save: upsert payload without user ids, delete + reinsert participants as guests
update public.games set payload='{"players":[{"name":"Rand","score":10,"user_id":"00000000-0000-0000-0000-00000000000a"},{"name":"Audrey","score":8},{"name":"Zach H","score":6}]}' where id='11111111-1111-1111-1111-111111111111';
delete from public.game_participants where game_id='11111111-1111-1111-1111-111111111111';
insert into public.game_participants (game_id, user_id, display_name, score, seat_order) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Rand',10,0),
 ('11111111-1111-1111-1111-111111111111',null,'Audrey',8,1),
 ('11111111-1111-1111-1111-111111111111',null,'Zach H',6,2);
select 'T10 linked after resave=' || count(*) from public.game_participants where game_id='11111111-1111-1111-1111-111111111111' and user_id is not null;
reset role;
select 'T10b payload audrey=' || ((payload->'players'->1->>'user_id') = '00000000-0000-0000-0000-00000000000b') from public.games where id='11111111-1111-1111-1111-111111111111';

-- T11 Audrey visible games now 2; then unlinks herself from catan
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','audrey.w@example.com');
set role authenticated;
select 'T11 audrey visible=' || count(*) from public.games;
select 'T11b unlink ok=' || (public.unlink_game_participant('11111111-1111-1111-1111-111111111111','Audrey')->>'ok');
select 'T11c audrey visible after unlink=' || count(*) from public.games;
select 'T11d audrey team game still visible=' || count(*) from public.games where id='22222222-2222-2222-2222-222222222222';
select 'T11e stranger name-mismatch=' || (public.claim_suggested_participant('00000000-0000-0000-0000-000000000000')->>'code');
-- T12 Audrey cannot create claims on Rand's game
select 'T12 ' || (public.create_participant_claim('11111111-1111-1111-1111-111111111111','Zach H')->>'code');
-- T13 user_already_in_game guard
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select 'T13 ' || (public.link_game_participant('11111111-1111-1111-1111-111111111111','Audrey','00000000-0000-0000-0000-00000000000a')->>'code');
reset role;
