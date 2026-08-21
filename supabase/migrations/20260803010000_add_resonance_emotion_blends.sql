-- Phase A of the multi-emotion blend model: adds a new `emotions` column
-- alongside the existing `mood` column. This is purely additive — `mood`
-- is untouched (still not null, still written by the current single-mood
-- picker flow) so every existing screen keeps working unchanged until the
-- Phase B picker UI ships and starts writing blends directly.

alter table public.resonances
  add column if not exists emotions jsonb;

-- Legacy mood -> new emotion key, per the confirmed mapping.
create or replace function public.resonance_emotion_from_legacy_mood(legacy_mood public.resonance_mood)
returns text
language sql
immutable
as $$
  select case legacy_mood
    when 'joyful'  then 'joy'
    when 'calm'    then 'serenity'
    when 'sad'     then 'sadness'
    when 'anxious' then 'anxiety'
    when 'angry'   then 'anger'
    when 'tired'   then 'fatigue'
  end;
$$;

-- Structural + weight validity for a blend: 1-3 emotions, percentages
-- summing to 100. Null is allowed only transiently — the trigger below
-- guarantees every row ends up with a populated, valid blend.
create or replace function public.resonance_emotions_valid(emotions jsonb)
returns boolean
language sql
immutable
as $$
  select emotions is null or (
    jsonb_typeof(emotions) = 'array'
    and jsonb_array_length(emotions) between 1 and 3
    and (
      select coalesce(sum((elem->>'percentage')::numeric), 0)
      from jsonb_array_elements(emotions) as elem
    ) = 100
  );
$$;

alter table public.resonances
  drop constraint if exists resonances_emotions_shape;
alter table public.resonances
  add constraint resonances_emotions_shape check (public.resonance_emotions_valid(emotions));

-- Backfill every existing row: reinterpret its single `mood` as a
-- 100%-weighted single-emotion blend under the new model.
update public.resonances
set emotions = jsonb_build_array(
  jsonb_build_object(
    'emotion', public.resonance_emotion_from_legacy_mood(mood),
    'percentage', 100
  )
)
where emotions is null;

-- Until Phase B ships, new rows are still created via the old single-mood
-- flow (writes `mood` only). This keeps `emotions` populated for those
-- rows too, so nothing downstream ever has to handle a null blend.
create or replace function public.resonance_backfill_emotions()
returns trigger
language plpgsql
as $$
begin
  if new.emotions is null then
    new.emotions := jsonb_build_array(
      jsonb_build_object(
        'emotion', public.resonance_emotion_from_legacy_mood(new.mood),
        'percentage', 100
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists resonances_backfill_emotions on public.resonances;
create trigger resonances_backfill_emotions
before insert or update on public.resonances
for each row execute function public.resonance_backfill_emotions();
