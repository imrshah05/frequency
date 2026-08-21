-- Phase 3 of Echo Impact: the data capture behind three signals the
-- Impact could not previously describe -- how much of an Echo people
-- actually heard, what time it was where the listener was, and whether
-- a listener had ever heard this creator before.
--
-- Two of the three need data that has never been recorded, so they can
-- only ever describe listens that happen after this ships. Existing
-- events keep working through the fallbacks documented in the Edge
-- Function; nothing here rewrites or backfills history.

-- FIX 0. voice_notes never had a duration column at all -- the app type
-- declared one and the Edge Function read it, but `select('*')` just
-- resolved it to undefined, which is why every Echo reported a null
-- duration. Seconds, matching the whisper_messages.duration convention
-- already used elsewhere. Left nullable on purpose: every Echo recorded
-- before this migration has no recoverable duration, and guessing one
-- would be worse than admitting it is unknown.
alter table public.voice_notes
  add column if not exists duration integer;

-- Per-listen detail. All nullable: an older client that does not send
-- them still writes a valid event, and the Edge Function falls back to
-- the boolean/UTC signals for any listen missing them.
--
--   heard_ms   furthest point the listener reached, in milliseconds.
--   total_ms   the clip's full length as the player reported it at
--              listen time. Stored alongside heard_ms so a listen is
--              self-describing -- percent heard never depends on
--              voice_notes.duration being correct or present.
--   utc_offset_minutes
--              the listener's own offset from UTC at the moment of
--              play, so night can be measured where they actually were
--              rather than where the server is. Minutes, not hours,
--              because real offsets include :30 and :45 zones.
alter table public.echo_events
  add column if not exists heard_ms integer,
  add column if not exists total_ms integer,
  add column if not exists utc_offset_minutes smallint;

-- listen_progress carries heard_ms/total_ms when playback stops for any
-- reason. It is additive: play_started/completed keep their existing
-- meaning, so nothing that already reads echo_events changes behaviour.
alter table public.echo_events
  drop constraint if exists echo_events_type_check,
  add constraint echo_events_type_check
  check (
    event_type in (
      'play_started',
      'completed',
      'replayed',
      'liked',
      'commented',
      'shared_to_whisper',
      'listen_progress'
    )
  );

-- Sanity bounds. These are the only values that can mean anything;
-- anything else is a client bug and should fail loudly rather than
-- quietly skew an Impact.
alter table public.echo_events
  drop constraint if exists echo_events_heard_ms_check,
  add constraint echo_events_heard_ms_check
  check (heard_ms is null or heard_ms >= 0);

alter table public.echo_events
  drop constraint if exists echo_events_total_ms_check,
  add constraint echo_events_total_ms_check
  check (total_ms is null or total_ms > 0);

alter table public.echo_events
  drop constraint if exists echo_events_utc_offset_check,
  add constraint echo_events_utc_offset_check
  check (utc_offset_minutes is null or utc_offset_minutes between -840 and 840);

-- New-listener detection asks, per creator: which listeners have played
-- any of this creator's other Echoes before now. That is a lookup by
-- voice_note_id + event_type returning user_id, which the existing
-- echo_events_voice_note_created_idx does not serve well.
create index if not exists echo_events_type_voice_note_user_idx
  on public.echo_events (event_type, voice_note_id, user_id);
