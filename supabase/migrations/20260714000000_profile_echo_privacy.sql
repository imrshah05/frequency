alter table public.voice_notes enable row level security;

drop policy if exists "Voice notes are readable while live or by owner" on public.voice_notes;
create policy "Voice notes are readable while live or by owner"
  on public.voice_notes
  for select
  using (
    user_id = auth.uid()
    or created_at >= now() - interval '24 hours'
  );

drop policy if exists "Users can create their own voice notes" on public.voice_notes;
create policy "Users can create their own voice notes"
  on public.voice_notes
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own voice notes" on public.voice_notes;
create policy "Users can update their own voice notes"
  on public.voice_notes
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own voice notes" on public.voice_notes;
create policy "Users can delete their own voice notes"
  on public.voice_notes
  for delete
  using (user_id = auth.uid());

alter table public.reactions enable row level security;

drop policy if exists "Reactions are readable for live Echoes and owners" on public.reactions;
create policy "Reactions are readable for live Echoes and owners"
  on public.reactions
  for select
  using (
    exists (
      select 1
      from public.voice_notes vn
      where vn.id = reactions.voice_note_id
        and (
          vn.user_id = auth.uid()
          or vn.created_at >= now() - interval '24 hours'
        )
    )
  );

drop policy if exists "Users can create their own live Echo reactions" on public.reactions;
create policy "Users can create their own live Echo reactions"
  on public.reactions
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = reactions.voice_note_id
        and vn.created_at >= now() - interval '24 hours'
    )
  );

drop policy if exists "Users can update their own live Echo reactions" on public.reactions;
create policy "Users can update their own live Echo reactions"
  on public.reactions
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = reactions.voice_note_id
        and vn.created_at >= now() - interval '24 hours'
    )
  );

drop policy if exists "Users can delete their own reactions" on public.reactions;
create policy "Users can delete their own reactions"
  on public.reactions
  for delete
  using (user_id = auth.uid());

alter table public.echo_impacts enable row level security;

drop policy if exists "Echo owners can read their echo impacts" on public.echo_impacts;
create policy "Echo owners can read their echo impacts"
  on public.echo_impacts
  for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = echo_impacts.voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Echo owners can create their echo impacts" on public.echo_impacts;
create policy "Echo owners can create their echo impacts"
  on public.echo_impacts
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = echo_impacts.voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Echo owners can update their echo impacts" on public.echo_impacts;
create policy "Echo owners can update their echo impacts"
  on public.echo_impacts
  for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = echo_impacts.voice_note_id
        and vn.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = echo_impacts.voice_note_id
        and vn.user_id = auth.uid()
    )
  );

alter table public.echo_events enable row level security;

drop policy if exists "Users can insert their own echo events" on public.echo_events;
create policy "Users can insert their own echo events"
  on public.echo_events
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Echo owners can read events for their Echoes" on public.echo_events;
create policy "Echo owners can read events for their Echoes"
  on public.echo_events
  for select
  using (
    exists (
      select 1
      from public.voice_notes vn
      where vn.id = echo_events.voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Users can read their own echo events" on public.echo_events;
create policy "Users can read their own echo events"
  on public.echo_events
  for select
  using (user_id = auth.uid());
