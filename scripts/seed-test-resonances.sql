-- Temporary visual-testing data for the Resonance Field dome effect.
-- Run this in the Supabase Dashboard → SQL Editor (NOT via the app, NOT as
-- a migration — it's meant to be pasted, run once, then cleaned up with
-- cleanup-test-resonances.sql when you're done testing).
--
-- Inserts 9 fake entries spread across the last two weeks, across all 6
-- moods. audio_path points at files that don't actually exist in storage —
-- tapping a test orb in the Field will show "Playback Error" and close the
-- sheet, which is expected. Everything else (the cluster layout, orb
-- colors, dates, sticky notes) renders normally since that all comes from
-- the row data, not the audio file.
--
-- Update the email below if this isn't the account you're testing with.

do $$
declare
  test_user_id uuid;
begin
  select id into test_user_id
  from auth.users
  where email = 'imrshah05@gmail.com';

  if test_user_id is null then
    raise exception 'No auth user found for that email — update the email in this script.';
  end if;

  insert into public.resonances (user_id, entry_date, mood, audio_path, sticky_note)
  values
    (test_user_id, current_date,      'joyful',  test_user_id::text || '/test-entry-0.m4a', 'Test entry — today'),
    (test_user_id, current_date - 1,  'calm',    test_user_id::text || '/test-entry-1.m4a', null),
    (test_user_id, current_date - 3,  'tired',   test_user_id::text || '/test-entry-2.m4a', 'Long day'),
    (test_user_id, current_date - 4,  'anxious', test_user_id::text || '/test-entry-3.m4a', null),
    (test_user_id, current_date - 6,  'sad',     test_user_id::text || '/test-entry-4.m4a', 'Rough one'),
    (test_user_id, current_date - 8,  'joyful',  test_user_id::text || '/test-entry-5.m4a', null),
    (test_user_id, current_date - 9,  'angry',   test_user_id::text || '/test-entry-6.m4a', null),
    (test_user_id, current_date - 11, 'calm',    test_user_id::text || '/test-entry-7.m4a', 'Quiet weekend'),
    (test_user_id, current_date - 13, 'tired',   test_user_id::text || '/test-entry-8.m4a', null)
  -- Safe if one of these dates collides with a real entry you already
  -- recorded (e.g. today) — that row is just skipped, not overwritten.
  on conflict (user_id, entry_date) do nothing;
end $$;
