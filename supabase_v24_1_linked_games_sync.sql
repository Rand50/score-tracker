-- =============================================================================
-- TallyIt v24.1 - make linked games reach the linked person's History
-- Safe to run more than once. Run AFTER supabase_v24_player_linking.sql.
--
-- 1. Self-heal: any saved link (game_participant_links) whose game_participants row
--    still has user_id NULL (or the wrong user) is set to the linked account.
-- 2. Realtime: publish game_participants so an already-open app hears "you were
--    linked into a game" right away (the app also polls, so this is a bonus).
-- 3. Returns a one-row report so you can see what was fixed.
-- =============================================================================

with fixed as (
  update public.game_participants gp
  set user_id = l.user_id
  from public.game_participant_links l
  where gp.game_id = l.game_id
    and public._v24_name_key(gp.display_name) = l.name_key
    and gp.user_id is distinct from l.user_id
  returning gp.id
)
select (select count(*) from public.game_participant_links) as links_total,
       (select count(*) from fixed)                         as participant_rows_repaired;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_participants'
     ) then
    alter publication supabase_realtime add table public.game_participants;
  end if;
end $$;
