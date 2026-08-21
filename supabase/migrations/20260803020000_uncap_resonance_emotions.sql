-- Removes the 3-emotion upper bound from the blend validity check added in
-- 20260803010000_add_resonance_emotion_blends.sql. An entry may now hold
-- any number of emotions (minimum 1, in practice capped at 11 by the fixed
-- palette), as long as their percentages still sum to exactly 100.
--
-- resonance_emotions_valid() is called by the resonances_emotions_shape
-- check constraint, so redefining it here changes enforcement for every
-- future insert/update without needing to touch the constraint itself —
-- and since this only loosens the rule, no existing row can newly violate
-- it.
create or replace function public.resonance_emotions_valid(emotions jsonb)
returns boolean
language sql
immutable
as $$
  select emotions is null or (
    jsonb_typeof(emotions) = 'array'
    and jsonb_array_length(emotions) >= 1
    and (
      select coalesce(sum((elem->>'percentage')::numeric), 0)
      from jsonb_array_elements(emotions) as elem
    ) = 100
  );
$$;
