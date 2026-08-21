-- Removes the fake entries inserted by seed-test-resonances.sql.
-- Run this in the Supabase Dashboard → SQL Editor once you're done
-- visually testing the Resonance Field.
--
-- Only targets rows whose audio_path matches the 'test-entry-' pattern
-- that script used, so any real Resonance entries you've recorded through
-- the app are left untouched.

delete from public.resonances
where user_id = (select id from auth.users where email = 'imrshah05@gmail.com')
  and audio_path like '%/test-entry-%';
