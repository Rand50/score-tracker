\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
-- =============================================================================
-- v25 admin drill-down scenarios. Prereq: stub + social + v20 + v22 + v24 + v25 applied.
-- Each check prints "PASS: ..." or "FAIL: ..."; tests/run_v25_sql.sh counts them.
-- =============================================================================

create or replace function pg_temp.chk(p_name text, p_ok boolean) returns text language sql as $$
  select case when coalesce(p_ok, false) then 'PASS: ' else 'FAIL: ' end || p_name $$;

create or replace function pg_temp.as_user(p uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
  perform set_config('request.jwt.claims', case when p is null then '{}' else json_build_object('sub',p,'email',p_email,'role','authenticated')::text end, false);
end $$;

-- runs p_sql, expects SQLSTATE p_code
create or replace function pg_temp.expect_err(p_name text, p_sql text, p_code text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL: ' || p_name || ' (no error raised)';
exception when others then
  return case when sqlstate = p_code then 'PASS: ' else 'FAIL: ' end || p_name || ' [' || sqlstate || ' ' || sqlerrm || ']';
end $$;

-- ------------------------------------------------------------------ seed (superuser)
insert into auth.users (id, email, created_at, last_sign_in_at) values
 ('00000000-0000-0000-0000-00000000000a','randw50@gmail.com', now() - interval '60 days', now() - interval '1 hour'),
 ('00000000-0000-0000-0000-00000000000b','audrey.w@example.com', now() - interval '20 days', now() - interval '2 days'),
 ('00000000-0000-0000-0000-00000000000c','zach@example.com', now() - interval '3 days', now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000000d','stranger@example.com', now() - interval '1 day', null),
 ('00000000-0000-0000-0000-00000000000e','quinn@example.com', now() - interval '40 days', now() - interval '35 days');
insert into public.profiles (id, display_name, email, friend_code, created_at) values
 ('00000000-0000-0000-0000-00000000000a','Rand Wilkinson','randw50@gmail.com','RAND-0001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-00000000000b','Audrey','audrey.w@example.com','AUDR-0002', now() - interval '20 days'),
 ('00000000-0000-0000-0000-00000000000c','Zach Hennessey','zach@example.com','ZACH-0003', now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000000d','Stranger','stranger@example.com','STRA-0004', now() - interval '1 day'),
 ('00000000-0000-0000-0000-00000000000e','Quinn_100%','quinn@example.com','QUIN-0005', now() - interval '40 days')
on conflict (id) do update set display_name=excluded.display_name, email=excluded.email, friend_code=excluded.friend_code, created_at=excluded.created_at;

insert into public.friendships (requester_id, addressee_id, status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','accepted'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','accepted'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c','pending'),
 ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000e','declined');

insert into public.groups (id, name, created_by, guest_names) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Game Night','00000000-0000-0000-0000-00000000000a','{}'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Cousins','00000000-0000-0000-0000-00000000000b','{Nana,Pop}');
insert into public.group_members (group_id, user_id, role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','owner'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','member'),
 ('aaaaaaaa-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','owner')
on conflict do nothing;

insert into public.games (id, client_game_id, created_by, group_id, game_type, winner, payload, created_at, ended_at) values
 ('11111111-1111-1111-1111-111111111111','g_1','00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','catan','Rand','{}', now() - interval '2 days', now() - interval '2 days'),
 ('22222222-2222-2222-2222-222222222222','g_2','00000000-0000-0000-0000-00000000000b',null,'nertz','Audrey','{}', now() - interval '20 days', now() - interval '20 days'),
 ('33333333-3333-3333-3333-333333333333','g_3','00000000-0000-0000-0000-00000000000a',null,'hearts',null,'{}', now() - interval '50 days', now() - interval '50 days');
-- (triggers may rewrite participants from payload; set them explicitly afterwards)
delete from public.game_participants;
insert into public.game_participants (game_id, user_id, display_name, score, is_winner, seat_order) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Rand',10,true,0),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b','Audrey',8,false,1),
 ('11111111-1111-1111-1111-111111111111',null,'Zach H',6,false,2),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000b','Audrey',50,true,0),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000c','Zach',20,false,1),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-00000000000a','Rand',5,false,0);

-- play events: yesterday-noon-UTC pair for the day drill-in, plus spread over 7d/30d/old
insert into public.game_play_events (game_key, variation_key, player_count, user_id, created_at) values
 ('catan','standard',4,'00000000-0000-0000-0000-00000000000a', (date_trunc('day', now() at time zone 'UTC') - interval '1 day' + interval '12 hours') at time zone 'UTC'),
 ('catan','standard',3,'00000000-0000-0000-0000-00000000000b', (date_trunc('day', now() at time zone 'UTC') - interval '1 day' + interval '13 hours') at time zone 'UTC'),
 ('catan','seafarers',4,'00000000-0000-0000-0000-00000000000b', now() - interval '10 days'),
 ('nertz','standard',2,'00000000-0000-0000-0000-00000000000c', now() - interval '3 days'),
 ('nertz','teams',5,null, now() - interval '1 minute'),
 ('flip7','standard',3,'00000000-0000-0000-0000-00000000000a', now() - interval '40 days'),
 ('hearts','standard',4,'00000000-0000-0000-0000-00000000000a', now() - interval '50 days'),
 ('catan','standard',4,null, now() - interval '12 days');

insert into public.game_requests (game_name, website_url, requester_id, requester_email, status, created_at, updated_at) values
 ('Wingspan','https://boardgamegeek.com/boardgame/266192','00000000-0000-0000-0000-00000000000b','audrey.w@example.com','new', now() - interval '1 day', now() - interval '1 day'),
 ('Azul',null,'00000000-0000-0000-0000-00000000000c','zach@example.com','new', now() - interval '2 days', now() - interval '2 days'),
 ('Splendor',null,null,'guest@example.com','planned', now() - interval '5 days', now() - interval '4 days'),
 ('Ticket to Ride',null,'00000000-0000-0000-0000-00000000000a','randw50@gmail.com','built', now() - interval '9 days', now() - interval '3 days'),
 ('Monopoly Deal',null,null,null,'declined', now() - interval '12 days', now() - interval '11 days');

insert into public.community_variations (game_key, slug, name, tagline, differences, author_id, author_name, is_hidden, created_at) values
 ('catan','fast-catan','Fast Catan','Win at 8','["8 points to win","No robber on first roll"]','00000000-0000-0000-0000-00000000000b','Audrey', false, now() - interval '2 days'),
 ('nertz','speed-nertz','Speed Nertz',null,'["Shorter piles"]',null,'Anonymous', false, now() - interval '5 days'),
 ('hearts','spicy-hearts','Spicy Hearts','Jack of diamonds','[]','00000000-0000-0000-0000-00000000000c','Zach', true, now() - interval '9 days');

-- ------------------------------------------------------------------ admin snapshot
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select public.get_admin_stats() as stats \gset
select public.admin_list_users() as u_all \gset
select public.admin_list_users(p_signup => '7d') as u_7d \gset
select public.admin_list_users(p_signup => '30d') as u_30d \gset
select public.admin_list_plays() as p_all \gset
select public.admin_list_plays(p_window => '7d') as p_7d \gset
select public.admin_list_plays(p_window => '30d') as p_30d \gset
select public.admin_list_game_requests() as r_all \gset
select public.admin_list_game_requests(p_status => 'new') as r_new \gset
select public.admin_list_game_requests(p_status => 'added') as r_added \gset
select public.admin_list_game_requests(p_status => 'dismissed') as r_dism \gset
select public.admin_list_game_requests(p_status => 'bogus') as r_bad \gset
select public.admin_list_friendships() as f_acc \gset
select public.admin_list_friendships(p_status => 'pending') as f_pend \gset
select public.admin_list_friendships(p_status => 'all') as f_all \gset
select public.admin_list_groups() as grp \gset
select public.admin_list_game_breakdown() as gb \gset
select public.admin_list_variation_breakdown() as vb \gset
select public.admin_list_daily_plays() as dp \gset
select public.admin_list_shared_games() as sg_all \gset
select public.admin_list_shared_games(p_window => '7d') as sg_7d \gset
select public.admin_list_shared_games(p_window => '30d') as sg_30d \gset
select public.admin_list_community_variations() as cv_all \gset
select public.admin_list_community_variations(p_visibility => 'visible') as cv_vis \gset
select public.admin_list_community_variations(p_visibility => 'hidden') as cv_hid \gset
reset role;

\echo '--- reconciliation with get_admin_stats()'
select pg_temp.chk('plays all total = total_plays', (:'p_all'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'total_plays')::int and (:'p_all'::jsonb->>'total')::int = 8);
select pg_temp.chk('plays 7d total = plays_7d', (:'p_7d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'plays_7d')::int and (:'p_7d'::jsonb->>'total')::int = 4);
select pg_temp.chk('plays 30d total = plays_30d', (:'p_30d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'plays_30d')::int and (:'p_30d'::jsonb->>'total')::int = 6);
select pg_temp.chk('users total = users_total', (:'u_all'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'users_total')::int and (:'u_all'::jsonb->>'total')::int = 5);
select pg_temp.chk('users signup 7d = users_7d', (:'u_7d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'users_7d')::int and (:'u_7d'::jsonb->>'total')::int = 2);
select pg_temp.chk('users signup 30d = users_30d', (:'u_30d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'users_30d')::int and (:'u_30d'::jsonb->>'total')::int = 3);
select pg_temp.chk('requests all = game_requests_total', (:'r_all'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'game_requests_total')::int and (:'r_all'::jsonb->>'total')::int = 5);
select pg_temp.chk('requests new = game_requests_new', (:'r_new'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'game_requests_new')::int and (:'r_new'::jsonb->>'total')::int = 2);
select pg_temp.chk('requests alias added->built (1), dismissed->declined (1)', (:'r_added'::jsonb->>'total')::int = 1 and (:'r_added'::jsonb->'rows'->0->>'game_name') = 'Ticket to Ride' and (:'r_dism'::jsonb->>'total')::int = 1);
select pg_temp.chk('requests invalid status -> ok:false invalid_status', (:'r_bad'::jsonb->>'ok') = 'false' and (:'r_bad'::jsonb->>'error') = 'invalid_status');
select pg_temp.chk('friendships accepted = friendships_accepted', (:'f_acc'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'friendships_accepted')::int and (:'f_acc'::jsonb->>'total')::int = 2);
select pg_temp.chk('friendships pending = friendships_pending', (:'f_pend'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'friendships_pending')::int and (:'f_pend'::jsonb->>'total')::int = 1);
select pg_temp.chk('friendships all = 4 (incl declined)', (:'f_all'::jsonb->>'total')::int = 4);
select pg_temp.chk('groups total = groups_total', (:'grp'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'groups_total')::int and (:'grp'::jsonb->>'total')::int = 2);
select pg_temp.chk('Friends&Groups KPI = friendships + groups', ((:'f_acc'::jsonb->>'total')::int + (:'grp'::jsonb->>'total')::int) = ((:'stats'::jsonb->'totals'->>'friendships_accepted')::int + (:'stats'::jsonb->'totals'->>'groups_total')::int));
select pg_temp.chk('game breakdown rows = by_game (keys + play_count, in order)',
  (select jsonb_agg(jsonb_build_array(r->>'game_key', (r->>'play_count')::int)) from jsonb_array_elements(:'gb'::jsonb->'rows') r)
  = (select jsonb_agg(jsonb_build_array(r->>'game_key', (r->>'play_count')::int)) from jsonb_array_elements(:'stats'::jsonb->'by_game') r)
  and (:'gb'::jsonb->>'total')::int = jsonb_array_length(:'stats'::jsonb->'by_game'));
select pg_temp.chk('game breakdown avg_players/7d/30d = by_game',
  (select jsonb_agg(jsonb_build_array(r->>'game_key', (r->>'avg_players')::numeric, (r->>'plays_7d')::int, (r->>'plays_30d')::int) order by r->>'game_key') from jsonb_array_elements(:'gb'::jsonb->'rows') r)
  = (select jsonb_agg(jsonb_build_array(r->>'game_key', (r->>'avg_players')::numeric, (r->>'plays_7d')::int, (r->>'plays_30d')::int) order by r->>'game_key') from jsonb_array_elements(:'stats'::jsonb->'by_game') r));
select pg_temp.chk('sum(game breakdown play_count) = total_plays', (select sum((r->>'play_count')::int) from jsonb_array_elements(:'gb'::jsonb->'rows') r) = (:'stats'::jsonb->'totals'->>'total_plays')::int);
select pg_temp.chk('variation breakdown rows = by_variation',
  (select jsonb_agg(jsonb_build_array(r->>'game_key', r->>'variation_key', (r->>'play_count')::int)) from jsonb_array_elements(:'vb'::jsonb->'rows') r)
  = (select jsonb_agg(jsonb_build_array(r->>'game_key', r->>'variation_key', (r->>'play_count')::int)) from jsonb_array_elements(:'stats'::jsonb->'by_variation') r)
  and (:'vb'::jsonb->>'total')::int = jsonb_array_length(:'stats'::jsonb->'by_variation'));
select pg_temp.chk('daily plays (30 rows) = daily_plays_30d (date + play_count)',
  (:'dp'::jsonb->>'total')::int = 30
  and (select jsonb_agg(jsonb_build_array(r->>'date', (r->>'play_count')::int) order by r->>'date') from jsonb_array_elements(:'dp'::jsonb->'rows') r)
    = (select jsonb_agg(jsonb_build_array(r->>'date', (r->>'play_count')::int) order by r->>'date') from jsonb_array_elements(:'stats'::jsonb->'daily_plays_30d') r)
  and (:'dp'::jsonb->'rows'->0->>'date') = to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD'));
select pg_temp.chk('shared games total/7d/30d = shared_games_*', (:'sg_all'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_total')::int and (:'sg_7d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_7d')::int and (:'sg_30d'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_30d')::int and (:'sg_all'::jsonb->>'total')::int = 3 and (:'sg_7d'::jsonb->>'total')::int = 1 and (:'sg_30d'::jsonb->>'total')::int = 2);
select pg_temp.chk('community total/visible = community_variations_*', (:'cv_all'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'community_variations_total')::int and (:'cv_vis'::jsonb->>'total')::int = (:'stats'::jsonb->'totals'->>'community_variations_visible')::int and (:'cv_hid'::jsonb->>'total')::int = 1);

\echo '--- row shapes / content'
select pg_temp.chk('users row keys', (select array_agg(k order by k) from jsonb_object_keys(:'u_all'::jsonb->'rows'->0) k) = array['display_name','email','friend_code','friend_count','games_played','id','last_active_at','last_sign_in_at','plays','shared_games','signed_up_at']);
select pg_temp.chk('users default sort = newest signup first (Stranger)', (:'u_all'::jsonb->'rows'->0->>'display_name') = 'Stranger');
select pg_temp.chk('Rand row: friend_count=2 plays=3 shared_games=2 games_played=3 email',
  (select (r->>'friend_count')::int = 2 and (r->>'plays')::int = 3 and (r->>'shared_games')::int = 2 and (r->>'games_played')::int = 3 and r->>'email' = 'randw50@gmail.com'
   from jsonb_array_elements(:'u_all'::jsonb->'rows') r where r->>'display_name' = 'Rand Wilkinson'));
select pg_temp.chk('Audrey: friend_count=1 (pending excluded), shared_games=2 (created + linked)',
  (select (r->>'friend_count')::int = 1 and (r->>'shared_games')::int = 2 from jsonb_array_elements(:'u_all'::jsonb->'rows') r where r->>'display_name' = 'Audrey'));
select pg_temp.chk('Quinn: last_active_at = last_sign_in_at (no plays/games), zero counts',
  (select (r->>'last_active_at') = (r->>'last_sign_in_at') and (r->>'games_played')::int = 0 and (r->>'friend_count')::int = 0 from jsonb_array_elements(:'u_all'::jsonb->'rows') r where r->>'email' = 'quinn@example.com'));
select pg_temp.chk('Stranger: never signed in -> last_active null', (select r->'last_sign_in_at' = 'null'::jsonb and r->'last_active_at' = 'null'::jsonb from jsonb_array_elements(:'u_all'::jsonb->'rows') r where r->>'display_name' = 'Stranger'));
select pg_temp.chk('plays row keys', (select array_agg(k order by k) from jsonb_object_keys(:'p_all'::jsonb->'rows'->0) k) = array['created_at','game_key','id','player_count','user_email','user_id','user_name','variation_key']);
select pg_temp.chk('plays: guest play has null user_name', (select count(*) = 2 from jsonb_array_elements(:'p_all'::jsonb->'rows') r where r->'user_id' = 'null'::jsonb and r->'user_name' = 'null'::jsonb));
select pg_temp.chk('requests row keys', (select array_agg(k order by k) from jsonb_object_keys(:'r_all'::jsonb->'rows'->0) k) = array['created_at','dismissed_at','game_name','id','requester_email','requester_id','requester_name','status','updated_at','website_url']);
select pg_temp.chk('requests newest first (Wingspan) + requester_name joined', (:'r_all'::jsonb->'rows'->0->>'game_name') = 'Wingspan' and (:'r_all'::jsonb->'rows'->0->>'requester_name') = 'Audrey');
select pg_temp.chk('friendships row keys', (select array_agg(k order by k) from jsonb_object_keys(:'f_acc'::jsonb->'rows'->0) k) = array['addressee_email','addressee_id','addressee_name','created_at','id','requester_email','requester_id','requester_name','status','updated_at']);
select pg_temp.chk('groups row: Cousins member_count=1 guest_names=[Nana,Pop]; Game Night member_count=2 games_count=1',
  (select (r->>'member_count')::int = 1 and (r->'guest_names') = '["Nana","Pop"]'::jsonb from jsonb_array_elements(:'grp'::jsonb->'rows') r where r->>'name' = 'Cousins')
  and (select (r->>'member_count')::int = 2 and (r->>'games_count')::int = 1 and r->>'owner_name' = 'Rand Wilkinson' from jsonb_array_elements(:'grp'::jsonb->'rows') r where r->>'name' = 'Game Night'));
select pg_temp.chk('game breakdown row keys', (select array_agg(k order by k) from jsonb_object_keys(:'gb'::jsonb->'rows'->0) k) = array['avg_players','first_played_at','game_key','last_played_at','play_count','plays_30d','plays_7d','unique_players']);
select pg_temp.chk('variation breakdown row keys', (select array_agg(k order by k) from jsonb_object_keys(:'vb'::jsonb->'rows'->0) k) = array['avg_players','game_key','last_played_at','play_count','plays_30d','plays_7d','variation_key']);
select pg_temp.chk('shared game row: catan creator/group/participants/linked', (select r->>'creator_name' = 'Rand Wilkinson' and r->>'group_name' = 'Game Night' and (r->>'participant_count')::int = 3 and (r->>'linked_count')::int = 2 from jsonb_array_elements(:'sg_all'::jsonb->'rows') r where r->>'game_type' = 'catan'));
select pg_temp.chk('community row: differences_count + author_email', (select (r->>'differences_count')::int = 2 and r->>'author_email' = 'audrey.w@example.com' from jsonb_array_elements(:'cv_all'::jsonb->'rows') r where r->>'slug' = 'fast-catan'));

\echo '--- filters, search, paging, sort, clamping'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select public.admin_list_plays(p_game_key => 'CATAN') as f1 \gset
select public.admin_list_plays(p_game_key => 'catan', p_variation_key => 'standard') as f2 \gset
select public.admin_list_plays(p_date => ((now() at time zone 'UTC')::date - 1)) as f3 \gset
select public.admin_list_plays(p_date => (now() at time zone 'UTC')::date) as f4 \gset
select public.admin_list_plays(p_search => 'audrey') as s1 \gset
select public.admin_list_users(p_search => 'audrey') as s2 \gset
select public.admin_list_users(p_search => 'EXAMPLE.COM') as s3 \gset
select public.admin_list_users(p_search => '%') as s4 \gset
select public.admin_list_users(p_search => 'Quinn_') as s5 \gset
select public.admin_list_users(p_search => 'Quinn_1') as s5b \gset
select public.admin_list_users(p_search => '100%') as s6 \gset
select public.admin_list_users(p_search => '   ') as s7 \gset
select public.admin_list_users(p_limit => 2, p_offset => 0, p_sort => 'display_name', p_dir => 'asc') as pg1 \gset
select public.admin_list_users(p_limit => 2, p_offset => 2, p_sort => 'display_name', p_dir => 'asc') as pg2 \gset
select public.admin_list_users(p_limit => 2, p_offset => 4, p_sort => 'display_name', p_dir => 'asc') as pg3 \gset
select public.admin_list_users(p_limit => 0) as c1 \gset
select public.admin_list_users(p_limit => 99999) as c2 \gset
select public.admin_list_users(p_limit => -7, p_offset => -5) as c3 \gset
select public.admin_list_users(p_limit => null, p_offset => null) as c4 \gset
select public.admin_list_users(p_sort => 'friend_count; drop table public.profiles', p_dir => 'sideways') as c5 \gset
select public.admin_list_users(p_sort => 'friend_count', p_dir => 'desc') as o1 \gset
select public.admin_list_users(p_sort => 'last_active_at', p_dir => 'desc') as o2 \gset
select public.admin_list_users(p_active => '7d') as a7 \gset
select public.admin_list_users(p_active => '30d') as a30 \gset
select public.admin_list_game_requests(p_search => 'boardgamegeek') as rs1 \gset
select public.admin_list_game_requests(p_search => 'guest@') as rs2 \gset
select public.admin_list_game_requests(p_status => 'new', p_search => 'azul') as rs3 \gset
select public.admin_list_shared_games(p_search => 'zach') as gs1 \gset
select public.admin_list_shared_games(p_game_type => 'nertz') as gs2 \gset
select public.admin_list_community_variations(p_search => 'speed') as cs1 \gset
select public.admin_list_groups(p_search => 'nana') as gr1 \gset
select public.admin_list_friendships(p_search => 'zach', p_status => 'all') as fs1 \gset
select public.admin_list_variation_breakdown(p_game_key => 'catan') as vb1 \gset
select public.admin_list_daily_plays(p_days => 7) as dd1 \gset
select public.admin_list_daily_plays(p_days => 99999, p_limit => 200) as dd2 \gset
select public.admin_list_daily_plays(p_days => 0) as dd3 \gset
select public.admin_list_daily_plays(p_sort => 'play_count', p_dir => 'desc', p_limit => 1) as dd4 \gset
reset role;

select pg_temp.chk('plays game_key filter (case-insens) = 4 and equals by_game catan', (:'f1'::jsonb->>'total')::int = 4 and (:'f1'::jsonb->>'total')::int = (select (r->>'play_count')::int from jsonb_array_elements(:'stats'::jsonb->'by_game') r where r->>'game_key' = 'catan'));
select pg_temp.chk('plays game+variation filter = by_variation count (3)', (:'f2'::jsonb->>'total')::int = 3 and (:'f2'::jsonb->>'total')::int = (select (r->>'play_count')::int from jsonb_array_elements(:'stats'::jsonb->'by_variation') r where r->>'game_key' = 'catan' and r->>'variation_key' = 'standard'));
select pg_temp.chk('plays day drill-in (yesterday UTC) = chart bar (2)', (:'f3'::jsonb->>'total')::int = 2 and (:'f3'::jsonb->>'total')::int = (select (r->>'play_count')::int from jsonb_array_elements(:'stats'::jsonb->'daily_plays_30d') r where r->>'date' = to_char((now() at time zone 'UTC')::date - 1, 'YYYY-MM-DD')));
select pg_temp.chk('plays day drill-in (today UTC) = chart bar', (:'f4'::jsonb->>'total')::int = (select (r->>'play_count')::int from jsonb_array_elements(:'stats'::jsonb->'daily_plays_30d') r where r->>'date' = to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')));
select pg_temp.chk('plays search by user name (Audrey: 2 plays)', (:'s1'::jsonb->>'total')::int = 2);
select pg_temp.chk('users search name', (:'s2'::jsonb->>'total')::int = 1 and (:'s2'::jsonb->'rows'->0->>'email') = 'audrey.w@example.com');
select pg_temp.chk('users search email case-insensitive (4 @example.com)', (:'s3'::jsonb->>'total')::int = 4);
select pg_temp.chk('users search "%" is literal (1 match: Quinn_100%, not all 5)', (:'s4'::jsonb->>'total')::int = 1);
select pg_temp.chk('users search "_" is literal ("Quinn_" matches, "Quinn_1" too, not wildcard)', (:'s5'::jsonb->>'total')::int = 1 and (:'s5b'::jsonb->>'total')::int = 1);
select pg_temp.chk('users search "100%" matches literal', (:'s6'::jsonb->>'total')::int = 1);
select pg_temp.chk('blank search = no filter', (:'s7'::jsonb->>'total')::int = 5);
select pg_temp.chk('paging: 2+2+1 rows, no overlap, has_more flags',
  jsonb_array_length(:'pg1'::jsonb->'rows') = 2 and jsonb_array_length(:'pg2'::jsonb->'rows') = 2 and jsonb_array_length(:'pg3'::jsonb->'rows') = 1
  and (:'pg1'::jsonb->>'has_more') = 'true' and (:'pg2'::jsonb->>'has_more') = 'true' and (:'pg3'::jsonb->>'has_more') = 'false'
  and (:'pg1'::jsonb->>'total')::int = 5 and (:'pg3'::jsonb->>'offset')::int = 4
  and (select count(distinct r->>'id') from (select * from jsonb_array_elements(:'pg1'::jsonb->'rows') union all select * from jsonb_array_elements(:'pg2'::jsonb->'rows') union all select * from jsonb_array_elements(:'pg3'::jsonb->'rows')) x(r)) = 5);
select pg_temp.chk('sort display_name asc: Audrey, Quinn_100%, Rand Wilkinson, Stranger, Zach Hennessey',
  (select array_agg(r->>'display_name' order by o) from (select r, row_number() over () o from (select * from jsonb_array_elements(:'pg1'::jsonb->'rows') union all select * from jsonb_array_elements(:'pg2'::jsonb->'rows') union all select * from jsonb_array_elements(:'pg3'::jsonb->'rows')) y(r)) x)
  = array['Audrey','Quinn_100%','Rand Wilkinson','Stranger','Zach Hennessey']);
select pg_temp.chk('limit 0 -> 1', (:'c1'::jsonb->>'limit')::int = 1 and jsonb_array_length(:'c1'::jsonb->'rows') = 1);
select pg_temp.chk('limit 99999 -> 200', (:'c2'::jsonb->>'limit')::int = 200);
select pg_temp.chk('limit -7 -> 1, offset -5 -> 0', (:'c3'::jsonb->>'limit')::int = 1 and (:'c3'::jsonb->>'offset')::int = 0);
select pg_temp.chk('null limit/offset -> 50/0', (:'c4'::jsonb->>'limit')::int = 50 and (:'c4'::jsonb->>'offset')::int = 0);
select pg_temp.chk('hostile sort/dir ignored (default order, no error, table intact)', (:'c5'::jsonb->>'ok') = 'true' and (:'c5'::jsonb->'rows'->0->>'display_name') = 'Stranger' and (select count(*) from public.profiles) = 5);
select pg_temp.chk('sort friend_count desc: Rand first (2)', (:'o1'::jsonb->'rows'->0->>'display_name') = 'Rand Wilkinson');
select pg_temp.chk('sort last_active_at desc: nulls last, Rand first', (:'o2'::jsonb->'rows'->0->>'display_name') = 'Rand Wilkinson');
select pg_temp.chk('active 7d: Rand, Audrey, Zach (sign-in/plays/games within 7d) = 3', (:'a7'::jsonb->>'total')::int = 3);
select pg_temp.chk('active 30d includes Audrey + Rand + Zach, not Quinn(35d)/Stranger = 3', (:'a30'::jsonb->>'total')::int = 3);
select pg_temp.chk('requests search url', (:'rs1'::jsonb->>'total')::int = 1);
select pg_temp.chk('requests search guest email', (:'rs2'::jsonb->>'total')::int = 1 and (:'rs2'::jsonb->'rows'->0->>'game_name') = 'Splendor');
select pg_temp.chk('requests status + search combine', (:'rs3'::jsonb->>'total')::int = 1);
select pg_temp.chk('shared games search participant name (Zach: guest in catan + linked in nertz) = 2', (:'gs1'::jsonb->>'total')::int = 2);
select pg_temp.chk('shared games game_type filter', (:'gs2'::jsonb->>'total')::int = 1);
select pg_temp.chk('community search', (:'cs1'::jsonb->>'total')::int = 1 and (:'cs1'::jsonb->'rows'->0->>'slug') = 'speed-nertz');
select pg_temp.chk('groups search guest name', (:'gr1'::jsonb->>'total')::int = 1 and (:'gr1'::jsonb->'rows'->0->>'name') = 'Cousins');
select pg_temp.chk('friendships search either side (zach) = 2', (:'fs1'::jsonb->>'total')::int = 2);
select pg_temp.chk('variation breakdown game filter (catan: 2 rows)', (:'vb1'::jsonb->>'total')::int = 2);
select pg_temp.chk('daily p_days=7 -> 7 rows, p_days=99999 clamps to 365 (limit 200 rows), p_days=0 -> 1 row',
  (:'dd1'::jsonb->>'total')::int = 7 and (:'dd2'::jsonb->>'total')::int = 365 and jsonb_array_length(:'dd2'::jsonb->'rows') = 200 and (:'dd3'::jsonb->>'total')::int = 1);
select pg_temp.chk('daily sort play_count desc limit 1 = busiest day (2 plays)', (:'dd4'::jsonb->'rows'->0->>'play_count')::int = 2);

\echo '--- game detail drill-in'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select public.admin_get_shared_game('11111111-1111-1111-1111-111111111111') as gd \gset
select public.admin_get_shared_game('99999999-9999-9999-9999-999999999999') as gd_nf \gset
reset role;
select pg_temp.chk('game detail: 3 participants ordered by seat, linked flags', jsonb_array_length(:'gd'::jsonb->'participants') = 3
  and (:'gd'::jsonb->'participants'->0->>'display_name') = 'Rand' and (:'gd'::jsonb->'participants'->0->>'linked') = 'true'
  and (:'gd'::jsonb->'participants'->2->>'display_name') = 'Zach H' and (:'gd'::jsonb->'participants'->2->>'linked') = 'false'
  and (:'gd'::jsonb->'participants'->1->>'user_email') = 'audrey.w@example.com');
select pg_temp.chk('game detail: game block (type, creator, group)', (:'gd'::jsonb->'game'->>'game_type') = 'catan' and (:'gd'::jsonb->'game'->>'creator_email') = 'randw50@gmail.com' and (:'gd'::jsonb->'game'->>'group_name') = 'Game Night');
select pg_temp.chk('game detail unknown id -> ok:false not_found', (:'gd_nf'::jsonb->>'ok') = 'false' and (:'gd_nf'::jsonb->>'error') = 'not_found');

\echo '--- dispatcher admin_drilldown'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role authenticated;
select jsonb_object_agg(b, public.admin_drilldown(b)) as dd_all from unnest(array[
  'games_total','games_7d','games_30d','users_total','users_7d','users_30d','active_users_7d','active_users_30d',
  'requests_total','requests_new','friendships','social_total','friendships_pending','groups','top_games','top_variations','daily_plays',
  'shared_games_total','shared_games_7d','shared_games_30d','community_total','community_visible','community_hidden']) b \gset
select public.admin_drilldown('GAMES_7D', null, 1, 0) as dd_lim \gset
select public.admin_drilldown('games_total', null, 50, 0, null, null, '{"game_key":"nertz"}') as dd_f \gset
select public.admin_drilldown('requests_total', null, 50, 0, null, null, '{"status":"planned"}') as dd_f2 \gset
select public.admin_drilldown('nope') as dd_bad \gset
select public.admin_drilldown(null) as dd_null \gset
select public.admin_drilldown('users_total', 'zach', 50, 0, null, null, '[]') as dd_arr \gset
reset role;
select pg_temp.chk('dispatcher: all 23 box keys return ok:true', (select count(*) = 23 and bool_and((v->>'ok') = 'true') from jsonb_each(:'dd_all'::jsonb) e(k, v)));
select pg_temp.chk('dispatcher totals match stats: games_total/7d/30d, users_total/7d/30d, requests_total/new',
  (:'dd_all'::jsonb->'games_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'total_plays')::int
  and (:'dd_all'::jsonb->'games_7d'->>'total')::int = (:'stats'::jsonb->'totals'->>'plays_7d')::int
  and (:'dd_all'::jsonb->'games_30d'->>'total')::int = (:'stats'::jsonb->'totals'->>'plays_30d')::int
  and (:'dd_all'::jsonb->'users_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'users_total')::int
  and (:'dd_all'::jsonb->'users_7d'->>'total')::int = (:'stats'::jsonb->'totals'->>'users_7d')::int
  and (:'dd_all'::jsonb->'users_30d'->>'total')::int = (:'stats'::jsonb->'totals'->>'users_30d')::int
  and (:'dd_all'::jsonb->'requests_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'game_requests_total')::int
  and (:'dd_all'::jsonb->'requests_new'->>'total')::int = (:'stats'::jsonb->'totals'->>'game_requests_new')::int);
select pg_temp.chk('dispatcher totals match stats: friendships/social_total/pending/groups/shared/community',
  (:'dd_all'::jsonb->'friendships'->>'total')::int = (:'stats'::jsonb->'totals'->>'friendships_accepted')::int
  and (:'dd_all'::jsonb->'social_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'friendships_accepted')::int
  and (:'dd_all'::jsonb->'friendships_pending'->>'total')::int = (:'stats'::jsonb->'totals'->>'friendships_pending')::int
  and (:'dd_all'::jsonb->'groups'->>'total')::int = (:'stats'::jsonb->'totals'->>'groups_total')::int
  and (:'dd_all'::jsonb->'shared_games_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_total')::int
  and (:'dd_all'::jsonb->'shared_games_7d'->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_7d')::int
  and (:'dd_all'::jsonb->'shared_games_30d'->>'total')::int = (:'stats'::jsonb->'totals'->>'shared_games_30d')::int
  and (:'dd_all'::jsonb->'community_total'->>'total')::int = (:'stats'::jsonb->'totals'->>'community_variations_total')::int
  and (:'dd_all'::jsonb->'community_visible'->>'total')::int = (:'stats'::jsonb->'totals'->>'community_variations_visible')::int
  and (:'dd_all'::jsonb->'community_hidden'->>'total')::int = 1
  and (:'dd_all'::jsonb->'top_games'->>'total')::int = jsonb_array_length(:'stats'::jsonb->'by_game')
  and (:'dd_all'::jsonb->'top_variations'->>'total')::int = jsonb_array_length(:'stats'::jsonb->'by_variation')
  and (:'dd_all'::jsonb->'daily_plays'->>'total')::int = 30);
select pg_temp.chk('dispatcher: case-insens box + limit', (:'dd_lim'::jsonb->>'limit')::int = 1 and jsonb_array_length(:'dd_lim'::jsonb->'rows') = 1);
select pg_temp.chk('dispatcher: filters override (nertz plays = 2, planned requests = 1)', (:'dd_f'::jsonb->>'total')::int = 2 and (:'dd_f2'::jsonb->>'total')::int = 1);
select pg_temp.chk('dispatcher: unknown/null box -> ok:false unknown_box', (:'dd_bad'::jsonb->>'error') = 'unknown_box' and (:'dd_null'::jsonb->>'error') = 'unknown_box');
select pg_temp.chk('dispatcher: non-object filters ignored', (:'dd_arr'::jsonb->>'total')::int = 1);

\echo '--- authorization'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','audrey.w@example.com');
set role authenticated;
select pg_temp.expect_err('non-admin: admin_list_users forbidden', 'select public.admin_list_users()', '42501');
select pg_temp.expect_err('non-admin: admin_list_plays forbidden', 'select public.admin_list_plays()', '42501');
select pg_temp.expect_err('non-admin: admin_list_game_requests forbidden', 'select public.admin_list_game_requests()', '42501');
select pg_temp.expect_err('non-admin: admin_list_friendships forbidden', 'select public.admin_list_friendships()', '42501');
select pg_temp.expect_err('non-admin: admin_list_groups forbidden', 'select public.admin_list_groups()', '42501');
select pg_temp.expect_err('non-admin: admin_list_game_breakdown forbidden', 'select public.admin_list_game_breakdown()', '42501');
select pg_temp.expect_err('non-admin: admin_list_variation_breakdown forbidden', 'select public.admin_list_variation_breakdown()', '42501');
select pg_temp.expect_err('non-admin: admin_list_daily_plays forbidden', 'select public.admin_list_daily_plays()', '42501');
select pg_temp.expect_err('non-admin: admin_list_shared_games forbidden', 'select public.admin_list_shared_games()', '42501');
select pg_temp.expect_err('non-admin: admin_get_shared_game forbidden', $$select public.admin_get_shared_game('11111111-1111-1111-1111-111111111111')$$, '42501');
select pg_temp.expect_err('non-admin: admin_list_community_variations forbidden', 'select public.admin_list_community_variations()', '42501');
select pg_temp.expect_err('non-admin: admin_drilldown forbidden', $$select public.admin_drilldown('users_total')$$, '42501');
select pg_temp.expect_err('non-admin: forbidden message', 'select public.admin_list_users()', '42501');
select pg_temp.expect_err('non-admin cannot call internal _v25_page', $$select public._v25_page('select 1', '1', null, 1, 0)$$, '42501');
reset role;

-- message text is exactly 'forbidden'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','audrey.w@example.com');
set role authenticated;
do $$ begin perform public.admin_list_users(); raise notice 'FAIL: no error'; exception when others then
  raise notice '%', case when sqlerrm = 'forbidden' and sqlstate = '42501' then 'PASS: non-admin error message is exactly forbidden / 42501' else 'FAIL: message ' || sqlerrm end; end $$;
reset role;

-- admin-looking but wrong identity
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d','randw50@gmail.com.evil.com');
set role authenticated;
select pg_temp.expect_err('lookalike email forbidden', 'select public.admin_list_users()', '42501');
reset role;
select pg_temp.as_user(null, null);
set role authenticated;
select pg_temp.expect_err('authenticated role but no JWT claims forbidden', 'select public.admin_list_users()', '42501');
reset role;
-- uppercase admin email passes (is_admin lowercases)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','RandW50@Gmail.com');
set role authenticated;
select pg_temp.chk('admin email is case-insensitive', (public.admin_list_users()->>'ok') = 'true');
reset role;

-- anon: no execute grant -> permission denied (42501), even with admin-looking claims
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','randw50@gmail.com');
set role anon;
select pg_temp.expect_err('anon: admin_list_users denied', 'select public.admin_list_users()', '42501');
select pg_temp.expect_err('anon: admin_drilldown denied', $$select public.admin_drilldown('users_total')$$, '42501');
select pg_temp.expect_err('anon: admin_list_plays denied', 'select public.admin_list_plays()', '42501');
select pg_temp.expect_err('anon: admin_get_shared_game denied', $$select public.admin_get_shared_game('11111111-1111-1111-1111-111111111111')$$, '42501');
select pg_temp.expect_err('anon: admin_list_community_variations denied', 'select public.admin_list_community_variations()', '42501');
reset role;
select pg_temp.as_user(null, null);
set role anon;
select pg_temp.expect_err('anon (no claims): admin_list_game_requests denied', 'select public.admin_list_game_requests()', '42501');
reset role;

\echo '--- catalog: grants + hardening'
select pg_temp.chk('all 12 public RPCs: authenticated=EXECUTE, anon=no, SECURITY DEFINER, search_path=public',
  (select count(*) = 12 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig::text like '%search_path=public%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
   ('admin_list_users','admin_list_plays','admin_list_game_requests','admin_list_friendships','admin_list_groups','admin_list_game_breakdown','admin_list_variation_breakdown','admin_list_daily_plays','admin_list_shared_games','admin_get_shared_game','admin_list_community_variations','admin_drilldown')));
select pg_temp.chk('internal helpers not executable by anon/authenticated',
  (select count(*) = 6 and bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '\_v25\_%'));
select pg_temp.chk('no duplicate overloads (PGRST203 guard): one signature per v25 RPC',
  (select count(*) = count(distinct proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname like '\_v25\_%')));
select pg_temp.chk('v25 is read-only: profiles/games/requests untouched (counts unchanged)', (select count(*) from public.profiles) = 5 and (select count(*) from public.games) = 3 and (select count(*) from public.game_requests) = 5 and (select count(*) from public.game_play_events) = 8);
