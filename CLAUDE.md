@AGENTS.md
# CLAUDE.md

# Frequency

Frequency is a premium voice-first social network.

People do not post photos or text.
People communicate through short voice notes called **Echoes**.

The entire product philosophy is:

> Some thoughts are better spoken.

Everything in the app should reinforce calm, intimacy, premium quality, and human connection.

---

# Core Philosophy

Frequency is NOT:

- TikTok
- Instagram
- Snapchat
- X
- a podcast app

It is a place where voices feel alive.

The experience should feel quiet, cinematic, elegant and intentional.

Every animation, spacing decision, typography choice and interaction should reinforce this feeling.

When implementing features, always prefer:

- fewer UI elements
- generous spacing
- restrained animations
- premium transitions
- soft shadows
- subtle glass
- minimal clutter

Never implement noisy consumer-app patterns.

---

# Technology

Current stack:

- React Native
- Expo SDK 54
- Expo Router
- TypeScript
- Supabase
- Reanimated
- React Native Gesture Handler

Backend:

- Supabase Auth
- Postgres
- RLS
- Storage

Never recommend architectural rewrites unless explicitly requested.

Modify existing architecture whenever possible.

---

# Design Language

Primary color:

Frequency Green

Dark interface.

Everything should feel like Apple Music meets Notion meets Linear.

Not flashy.

Premium.

Elegant.

**Message bubbles have two sides.**

In any Whisper thread, 1:1 or group, your own voice is a green fill and
everyone else's is neutral dark — the same way a message app's colour
tells you who spoke before you read anything. A voice note carries no
text, so the bubble is the only thing on screen doing that job; the two
sides must differ plainly, not by a few percent of opacity.

Both palettes live in `FrequencyBubble` in `constants/frequencyTheme.ts`
so the two thread screens cannot drift apart. Anything sitting inside a
bubble (waveform, play button) has to flip with it — green controls on a
green fill disappear.

---

# Naming

Application:
Frequency

Voice posts:
Echoes

Private voice notes:
Whispers

Profile:
My Frequency

Following:
Listening To

Followers:
Tuned In

Follow action:
Tune In

---

# Current Product

Implemented:

✓ Authentication
✓ Username signup
✓ Profiles
✓ Avatars
✓ Echo feed
✓ Echo recording
✓ Echo playback
✓ Tune In requests
✓ Reciprocal Tune In
✓ Activity feed
✓ Comments
✓ Reactions
✓ Echo Impact
✓ Live Echo
✓ Archives
✓ Whisper system
✓ Onboarding framework

---

# Current Navigation

Bottom navigation contains:

Home

Search

Record (center)

Whispers

Profile

The center recording button is the primary action in the entire application.

Never reduce its prominence.

---

# Echoes

Echoes are public voice posts.

Users can:

listen

react

comment

share

see Echo Impact

Only one Echo can be live at a time.

Old Echoes belong in Archives.

Never expose Archives publicly.

---

# Echo Impact

The private story of what happened to one Echo during its 24 hours.
Only ever shown to the Echo's own creator. Not analytics, not a
dashboard, and never public validation.

**One source of truth for metrics** (Phase 1)

There used to be two: the Edge Function counted raw `echo_events` rows,
while Profile and Archives each kept their own copy that deduped by
listener. The same Echo could report different numbers depending on
which path drew it.

The rule now lives in one place per side — `lib/echoMetrics.ts` on the
client (pure math, no Supabase import; the queries sit in
`lib/loadEchoMetrics.ts`) and `buildMetrics` in the Edge Function — and
both implement it identically:

- plays / completions / night plays are **unique listeners**. The copy
  says "people pressed play", so one person replaying five times is one
  person.
- replays stay a **raw count**. Repeat listens are the whole point of
  that metric.
- hearts, comments and Whisper shares come from the tables that
  actually own them (`reactions`, `notifications`, `whisper_messages`).
  `echo_events` is an append-only mirror that never drops a row when
  someone unlikes, so counting it overstates.
- everything is windowed to the Echo's live run, `created_at` .. +24h.

Changing a rule on one side means changing it on the other.

**The Impact is frozen when the Echo's run ends** (Phase 1)

An Echo finishes in one of two ways, and the common one writes nothing:
its owner archives it (`archived_at`), or its `created_at` simply ages
past 24 hours. The second changes no row, so there is no database event
to trigger on. Sealing therefore has to be *discovered*, by something
asking "whose run is over and has no sealed Impact yet".

Originally that asker was a scheduled sweep in `generate-echo-impact`,
driven by cron. **There is no cron, by product decision** — see Phase 4.
The app asks the question itself on launch, and that is the only
sealing path that actually runs. The sweep's code, its `x-cron-secret`
mode and the `unsealed_finished_echoes` RPC all still exist and still
work; nothing schedules them.

`echo_impacts.is_final` is the guard. Once true the Impact is permanent:
never regenerated, never recomputed live, and not editable by any
client (RLS blocks updating a sealed row). Archives reads sealed
Impacts from storage only — recomputing there is what used to let a
"final" story keep drifting as late events landed.

While an Echo is still live its Impact is a regenerable preview, not
the record.

An Echo nobody ever touched still gets a real frozen Impact. Per
"never punish", it leans on what is true — it was spoken, it had its
run, it is kept — instead of counting what did not happen. No AI call
is made for these; there is no story to find.

**Selection is eligibility → AI → verify** (Phase 2)

The fixed ten-theme priority chain is gone from the AI path. What
replaced it, in order:

1. **Eligibility (code, never the model).** `eligibleFacts()` tests each
   metric against a named threshold in the `ELIGIBILITY` constant and
   emits only the ones that clear it. Deciding what is worth saying is a
   product judgement, so it is not delegated to a model reading raw
   numbers.

   | metric_id | eligible when |
   |---|---|
   | `plays` | >= 1 listener |
   | `completion` | rate >= 70% **and** >= 2 listeners |
   | `replays` | >= 1 |
   | `reactions` | >= 1 |
   | `comments` | >= 1 |
   | `whisper_shares` | >= 1 |
   | `night` | >= 2 night listeners **and** >= 40% of plays |
   | `new_listeners` | >= 2 first-time listeners |

   `PLAYS_MIN` is 1 deliberately: it guarantees any Echo somebody
   actually played has at least one eligible fact, which keeps the
   silent fallback honest (see below).

2. **AI select-and-write.** One call, receiving *only* the eligible
   facts — never raw or ineligible metrics, and never an absence. It
   picks up to 3 and writes `{metric_id, title, body}` for each, plus a
   theme, a subtitle, and an optional closing line. `metric_id` is
   constrained by a JSON-schema `enum` of the eligible ids, and
   `maxItems` is capped at `min(3, facts.length)`, so the model cannot
   name an ineligible metric or pad a thin Echo.

3. **Verification (code, never the model).** Duplicate `metric_id`
   detection → one retry with an explicit correction note → if it still
   repeats, keep the first occurrence and drop the rest. A shorter
   Impact always beats the same fact said twice.

**The metric_id dedup contract**

Every observation is one distinct fact. A `metric_id` appears at most
once in an Impact, enforced three ways: the enum, the retry, and the
final `dropRepeatedMetricIds` guard.

The closing line is **optional** and must synthesise across the selected
facts — it is not a card and may never restate one. When absent, the UI
ends on the last observation rather than rendering an empty card. This
is what fixes the Phase 1 behaviour where the final reflection always
restated a metric already shown above it.

Numbers are never written by the model. Each card's figure comes from
the fact itself (`fact.number`, `fact.label`), already run through the
Phase 1 `counted`/`plural` helpers, so a figure cannot be wrong or
mis-pluralised no matter what the model does.

**When the AI is not used**

- No eligible facts *and* no interactions at all → `silentEchoImpact()`,
  no API call.
- No eligible facts but interactions exist → the deterministic
  `fallbackImpact()`, which reports the real numbers. The silent copy
  says nothing came back, which would be a lie here.
- OpenAI unavailable, or no usable observations → `fallbackImpact()`.
  `fallbackTheme()` survives only to serve this degraded path; it is no
  longer the selection mechanism. The saved row's `model` column records
  which path produced it.

**Richer signals** (Phase 3)

Three things the Impact could not previously describe. Two needed data
that had never been recorded, so they only ever describe listens that
happen after that capture shipped — see the fallbacks below.

*Completion is now how much was heard, not whether it ended.* Each
listen writes a `listen_progress` event carrying `heard_ms` and
`total_ms` when playback stops for any reason. A listener who reached
`COMPLETION_HEARD_PCT` (90%) counts as having finished it, and
`completion_rate` stays what it always was — the share of listeners who
did — so the Phase 2 threshold keeps its exact meaning. 90 rather than
100 because trailing silence and closing the app on the last word
should still count.

*Night is measured where the listener was.* `play_started` and
`listen_progress` carry the listener's own `utc_offset_minutes`, so the
hour is shifted into their local time before the 22:00–05:00 test.

*New listeners* are people who heard this Echo having never played any
of this creator's earlier Echoes. Deliberately behavioural, not
relationship-based: "not Tuned In" would keep calling someone new
forever if they listen daily without ever following, which overstates
newness, whereas never having pressed play on this voice is a fact that
stays true. Threshold is **2**, not 1 — a creator whose Echo had a
single listener would otherwise learn that specific person had never
heard them before, and an aggregate of one is not an aggregate. Only
the count leaves `countNewListeners`; identities are used to compute
the diff and discarded.

**Fallbacks for Echoes that predate the capture**

Both fallbacks are **per listen, not per Echo**, so one stale listen
never drags a whole Impact back to the old signal:

| signal | when data present | when absent |
|---|---|---|
| completion | `heard_ms / total_ms` vs 90% | the boolean `completed` event |
| night | listener's local hour | the server UTC hour |

Every snapshot records which was used — `completion_basis` is
`measured` / `boolean` / `mixed`, `night_plays_timezone_basis` is
`listener_local` / `server_utc` / `mixed` — because an Impact frozen
before Phase 3 is not comparable to one frozen after it and should not
pretend to be.

`voice_notes.duration` did not exist as a column before Phase 3 (the
app type declared it and the Edge Function read it, but `select('*')`
resolved it to undefined). It is now written at record time in seconds,
matching `whisper_messages.duration`. It stays nullable: Echoes
recorded earlier have no recoverable duration, and guessing one would
be worse than admitting it is unknown. `listen_progress` carries its
own `total_ms` so percent-heard never depends on it.

**The Impact is a reveal, not a live read** (Phase 4)

An Echo's Impact used to be readable the whole time the Echo was
running: the Profile card carried plays, hearts, comments and Whisper
shares, and a "See the impact" button opened the full story with a
Generate button that recomputed it on demand. That made a private
reflection into a live scoreboard — the exact thing this feature is
not — and it also meant the story a creator read most often was the
provisional one.

Two halves to the change.

*While an Echo is live, its creator sees two numbers.* Plays and
hearts, on the Profile live-Echo card, and nothing else. Replays,
completion, comments, Whisper shares and night listening are all
Impact material now, so none of them appear until the reveal. The
Impact sheet, the Generate button, and the local-fallback path that
fed it are gone from `app/(tabs)/frequency.tsx` entirely.

This restricts only the creator's own view of their own live Echo.
Listeners never saw any of it; Archives is unchanged; the
Stories-style live playback at `app/live-echoes/[userId].tsx` shows
no numbers to anyone and stays that way.

`plays` stays what `lib/echoMetrics.ts` has always defined it as —
unique listeners, not raw taps — because the Edge Function counts it
the same way, and one source of truth for a metric outranks the
smaller reading of "play count".

*Once the run is over, the Impact comes to you.* `revealed_at` on
`echo_impacts` is a nullable timestamptz, separate from `is_final` on
purpose: `is_final` is a fact about the content (locked, never
regenerated), `revealed_at` is a fact about the person (they have now
been shown it). Sealed with `revealed_at` still null is *pending
reveal*.

`components/EchoImpactRevealHost.tsx` mounts once in the root layout,
outside the navigator and outside onboarding, and asks "is anything
waiting for me" on launch and on every return to the foreground. It
never blocks startup: the query is fired and forgotten, the component
renders nothing until an answer arrives, and an app open with nothing
pending is byte-for-byte the old behaviour.

Reveals are **sequential, one Echo at a time** — never a combined
digest. Two Echoes' Impacts are two separate things that happened, and
a list of them is a report. Each gets its own full-screen entrance,
its own two beats, and is keyed by Echo so the next one mounts clean
rather than swapping content in behind animations that already ran.
A held beat of true black separates them. Order is oldest Echo first,
so the reveals walk forward through the days rather than backward.

Each Echo is marked seen the moment its own reveal is finished with,
not at the end of the run — someone who watches the first of three and
closes the app must never be shown that first one again. Dismissing
counts as finishing, per the same rule; Archives keeps permanent
access, so nothing is lost by closing early.

Writing `revealed_at` goes through the `mark_echo_impact_revealed`
RPC. The freeze policy blocks every client update to a sealed row and
that blanket rule is worth keeping absolute, so this is its one
audited exception: it stamps only the caller's own row, only when
sealed, and only when not already stamped.

The reveal looks only for what is *already sealed* and unrevealed, so
it never depends on when sealing happened or on what triggered it.

**The app seals too, and in practice it is what seals** (Phase 4)

Sealing was originally the scheduled sweep's job alone. Production
showed why that is not enough: on 2026-08-19 the live database had 14
Impact rows and **zero** sealed. The sweep's cron job is a documented
manual step that was never completed, and the function also carries
`verify_jwt = true`, which rejects the documented `x-cron-secret`-only
call at the gateway before any function code runs. Nothing in the
product noticed — Echoes finished, no Impact was ever written, and the
reveal had nothing to show. Removing the old Generate button closed
the last remaining path, so for a while nothing could create an Impact
at all.

`sealRecentlyFinishedEchoes` in `lib/echoImpactReveal.ts` fixes this
where the need actually lives. Before each reveal check it finds the
user's own Echoes whose run has ended but whose Impact is not sealed,
and invokes `generate-echo-impact` in its **single-Echo mode**,
authenticated as that user.

This is not a second implementation. That mode runs the identical
`generateAndSaveImpact` the sweep runs — same eligibility thresholds,
same AI selection, same dedup guard, same `is_final = isEchoFinished()`
freeze rule — and returns the stored copy untouched if the Impact is
already sealed. Two triggers, one implementation, so they cannot
produce different stories.

The sweep's code is unchanged and still correct, but **nothing
schedules it and nothing is meant to.** Cron was dropped deliberately:
it is infrastructure to configure, monitor and silently lose (which is
exactly what happened), in exchange for Impacts existing slightly
earlier than anyone can look at them. Since a creator is the only
person who will ever see their own Impact, "generated the moment they
open the app" is indistinguishable from "generated an hour ago" —
except that one of them cannot break while nobody is watching.

If the sweep is ever wanted back, note that the function carries
`verify_jwt = true`, so the documented `x-cron-secret`-only call is
rejected at the gateway before any function code runs. That, plus a
cron job that was never created, is why it had sealed nothing.

**No recency cut-off, but there is a ship line.** These are different
things and the distinction matters.

A sliding seven-day window was tried first and reverted on product
instruction: an Echo that finished while its creator was away for a
month is still owed its reveal whenever they come back. "The next time
the user opens the app after 24 hours" is the rule, with no expiry.

What was actually wrong was history. On the first launch after the
feature shipped, every Echo a user had ever finished became eligible
at once — observed in production as one archive action producing five
reveals. `20260819030000` adds a fixed line (`2026-08-19`) that never
moves: a run that ended before the reveal existed had no reveal to
miss. Impacts already sealed at that point were marked revealed in the
same migration — they stay readable in Archives, they just stop
arriving.

The line is tested against when the run **ended**, not when the Echo
was recorded, so an old Echo archived today does get its moment (which
is what archiving an Echo to see its Impact is asking for) while the
same Echo left untouched stays quiet.

Batch size, not recency, is what keeps a backlog manageable:

- **Three per launch.** Each seal is an AI call, so a backlog drains
  over a few launches instead of stalling one.
- **Serially, never in parallel.** There is no deadline; anything not
  sealed now is picked up next launch.
- **Oldest first**, matching the reveal order, so a backlog is walked
  forward through the days rather than backward.

The lookup is the `my_unsealed_finished_echoes` RPC
(`20260819020000`), not a client-side query. The honest form of the
question is a `LEFT JOIN ... IS NULL`, which PostgREST cannot express;
doing it client-side would mean fetching every Echo a user has ever
recorded and diffing in JavaScript, which grows without limit and
eventually will not fit in a URL. It is the user-scoped sibling of the
sweep's `unsealed_finished_echoes` — that one is service-role only and
deliberately reads across every account, so it cannot be reused here.

Sealing late costs nothing in accuracy. Every metric is windowed to
the Echo's own `created_at .. +24h`, so the numbers are identical
whether they are computed an hour or a month after the run ended. And
since the creator is the only person who will ever see their own
Impact, nothing needs to exist before they open the app.

**A trap worth remembering:** the root layout passes `userId` down from
the Supabase `session`, and Supabase hands it a *fresh Session object*
on every token refresh and foreground. An effect keyed on that which
unconditionally resets state will tear a reveal off the screen
mid-watch. The host compares the user by value and only tears down on
a real account change; a stale-check guard bumps only on unmount.

**Still pending**

- The client-side `chooseTheme()` in `lib/echoImpact.ts` still uses the
  old priority chain. It is the offline fallback used when the Edge
  Function is unreachable, so it cannot become an AI call; it renders
  only when the server could not be asked.
- Only the feed (`app/(tabs)/index.tsx`) writes `listen_progress` and
  offsets. Whisper-thread playback still writes plain
  `play_started`/`completed`, so listens there use the fallbacks.
- The Profile card still loads the full metric set to display two of
  it, because `loadLiveEchoMetrics` is the shared canonical loader and
  Archives needs all of it. Two count queries per live Echo are wasted;
  splitting the loader was judged worse than the duplication it would
  create.

---

# Whispers

Whispers are private.

Think:

voice DMs

They are intentionally separate from Echoes.

Do not merge concepts.

Whispers come in two forms:

**1:1 Whispers** (original)

Exactly two participants.

Two-audio exchange structure.

`whisper_threads` / `whisper_messages`.

**Group Whispers** (additive, new)

3+ participants.

Not a two-audio exchange. Echoes drop into the thread chronologically
whenever a participant records one, closer to a shared voice feed than
a back-and-forth DM.

Separate schema, entirely additive:

`whisper_group_threads` / `whisper_group_participants` /
`whisper_group_messages` / `whisper_group_message_reads`.

Read state is per-participant, per-Echo (`whisper_group_message_reads`),
not a single `read_at` flag, because a group has more than one listener.

Capped at 12 participants to keep it intimate, not an open group chat.

1:1 Whisper tables, logic, and UI are never modified to support this.
Group Whispers are a parallel model living under the same "Whispers" name.

**Creation & membership** (additive, new)

Entry point: a small icon button in the Whispers inbox header, next to
the title. Never placed near the record button.

Participant picker is built entirely from Tune In relationships —
anyone the creator has an accepted Tune In with, in either direction
(follower or following). No separate follow-checking logic; reuses the
same `tune_ins` lookup as Mutuals and Listening To / Tuned In.

Minimum 3 people total (you + 2 others) to create a group. Capped at 12
total, enforced in the database.

Permissions are flat. No owner, no admin role:

- Any member can add any other member, as long as the person adding
  has an accepted Tune In with them (either direction). Enforced by
  Postgres RLS, not just the UI.
- Any member can remove any other member.
- Leaving a group is just removing yourself.
- If a group hits zero members, the thread is deleted automatically.

Group name defaults to an auto-generated list of participants (e.g.
"@alex & @sam") and stays in sync as membership changes. Any member can
override it with a custom name.

Any member can also set a real group photo (tap the avatar on Manage
Members). Reuses the same public `avatars` storage bucket profile
photos use, uploaded under the uploader's own folder
(`${uploaderId}/group-${threadId}.ext`) — the bucket's storage policy
only allows writing under your own folder, and since group permissions
are flat, this avoids needing a separate storage policy keyed on group
membership. Falls back to the auto-generated stacked-member placeholder
until a member sets one.

**Thread UI** (additive, new)

Group threads use the same chat-bubble interface as 1:1 Whispers, not
a plain feed — right-aligned bubbles for your own Echoes, left-aligned
for everyone else's, avatar next to each bubble, consecutive Echoes
from the same sender grouped with matching corner-rounding. A small
`@username` label sits above the first bubble in a run from
another sender (your own messages don't need the label). This was a
deliberate reversal of the original "feed, not bubbles" plan — full
bubble-chat parity with 1:1 Whispers is the actual shipped decision.

Recording reuses the exact same hold-to-record, lock, and
upload-then-insert flow as 1:1 Whispers — only the destination table
changes (`whisper_group_messages`, no `receiver_id`, broadcasts to
every participant).

Playback is always a deliberate tap, one Echo at a time. Nothing
auto-plays when the thread opens, and a finished Echo does not
auto-advance into the next one — consistent with how Echoes and 1:1
Whispers already work.

**Timestamps** (shared by 1:1 and group Whispers)

No Whisper wears its time on its face. A column of clock times turns a
quiet room into a log, so a thread shows none of them.

Instead, holding any message reveals when it was sent, as a floating
pill inside that bubble which fades away on its own after a couple of
seconds. It sits inside the bubble rather than above or below it
because a thread is pinned to its newest message — a reveal that grew
a bubble would throw the list to the bottom every time an old Whisper
was held.

`hooks/useMessageTimeReveal.ts` holds which message is open (one at a
time, one timer per thread); `components/MessageTimeReveal.tsx` is the
pill and owns the wording — bare clock time for today, then
"Yesterday", weekday, or date as the message ages.

Waveforms need the hold wired in separately (`useWaveformScrub`'s
`onLongPress`): the scrub gesture claims the touch on contact, so a
Pressable around the bubble never sees a finger resting on the bars.

This replaced two earlier systems: swipe-to-reveal on 1:1 threads, and
the clock time in the group sender label.

Unheard Echoes render slightly more prominent than heard ones, backed
by `whisper_group_message_reads`.

Manage Members is reached from an info icon in the thread header, at
`app/whispers/group/[threadId]/members.tsx`. The thread itself lives
at `app/whispers/group/[threadId]/index.tsx`.

Group threads now appear in the main Whispers inbox alongside 1:1
threads, sorted together by last activity.

Captions use the same tactile sticky-note treatment (paper, tape,
shadow, slight rotation) as 1:1 Whispers — including the exact
peeking-off-the-bubble-corner positioning, not just the visual style.

Two separate signals track "read," on purpose kept apart:
`whisper_group_participants.last_read_at` is a per-thread cursor
stamped every time a member opens the thread, regardless of whether
they play anything. `whisper_group_message_reads` is per-Echo,
written only when a member actually taps play, and now drives only
that viewer's own "have I personally played this" dimming — nothing
shown to anyone else.

**Seen by & notifications** (additive, new — completes the group
Whispers build)

Per Echo, small overlapping profile-photo icons appear below the
bubble once another member has "seen" it — Instagram DM style, not
text. Up to 3 avatars shown, a "+N" badge past that; tap the stack to
see the full list of names. Nothing shown until someone else has seen
it.

"Seen" here means the same thing it means in Instagram DMs and most
messaging apps: that member opened the thread *after* this Echo
arrived (`last_read_at >= message.created_at`), not that they
specifically played this exact clip. The first version of this
feature required an actual play tap to appear in "seen by," reasoning
that was more honest — but real usage showed that's not what users
expect from "seen," and it made the feature look broken (members who'd
clearly opened the thread showed no seen-by at all). `getSeenByMembers`
in `lib/groupWhispers.ts` is the pure function computing this from
already-loaded members + messages, no extra query. The thread screen's
realtime channel subscribes to `whisper_group_participants` UPDATE
events (not `whisper_group_message_reads` INSERTs) so seen-by updates
live as other members open the thread while you're viewing it.

There is no Activity-feed or push notification for new Echoes, by
design. 1:1 Whispers never had one either — the `notifications` table
explicitly excludes whisper-type events from Activity. Building an
Activity/push notification that only fired for groups would break "one
source of truth" for messaging awareness. Instead, the Whispers
tab-bar unread dot (previously 1:1-only) now also lights up for unread
group Echoes, using the same `last_read_at`-cursor pattern described
above — same mechanism, same visual language, just extended to cover
group threads.

---

# Profiles

Profiles show:

avatar

display name

username

current live Echo

About

Listening To

Tuned In

Live Echo count

Profile should never expose Archives to other users.

Only the owner can access Archives.

---

# Activity

Activity contains:

Tune In requests

Accepted requests

Reciprocal Tune In

Comments

Reactions

Future notifications

Every notification should have exactly one source of truth.

Avoid duplicate cards.

Avoid duplicate request states.

---

# Onboarding Philosophy

The onboarding is contextual.

It is NOT one long tutorial.

It appears naturally as users discover the product.

Current flow:

Welcome

↓

Latest Echoes

↓

Record button

↓

User explores

↓

Whispers tutorial (first visit)

↓

Profile tutorial (first visit)

↓

Echo Impact tutorial (after first Echo)

Never combine all onboarding into one long flow.

Never restart onboarding after completion.

Each module has its own completion flag.

---

# UI Philosophy

Always prefer:

less

not more.

If a component can be removed, remove it.

Whitespace is valuable.

Animation should feel like:

Apple

Linear

Arc Browser

Not TikTok.

---

# Animation Rules

Animations should:

never bounce excessively

never be playful

never feel cartoonish

feel physical

feel smooth

feel expensive

Default easing should be calm.

Avoid long animation chains.

---

# Implementation Philosophy

When changing code:

Understand the existing architecture first.

Read relevant files.

Do not rewrite unrelated code.

Avoid introducing duplicate state.

Avoid introducing duplicate navigation.

Avoid creating parallel implementations.

Prefer extending existing systems.

---

# Before Coding

Before modifying anything:

1. Read this CLAUDE.md completely.
2. Read FREQUENCY_DESIGN.md.
3. Inspect the existing implementation.
4. Explain the current architecture.
5. Then implement.

Never start coding immediately.

---

# When Fixing Bugs

Never patch symptoms.

Always identify the root cause.

Explain:

- why it happened
- where it happened
- why the fix works

Avoid hacks.

Avoid temporary fixes.

---

# Database Rules

Never:

disable RLS

rewrite applied migrations

modify production data without necessity

Always create reconciliation migrations if schema drift exists.

Preserve backwards compatibility whenever possible.

---

# Coding Style

Prefer:

small functions

clear naming

strong typing

minimal abstraction

Avoid:

dead code

duplicate logic

magic values

copy-paste implementations

---

# Working With Me

I am the product designer.

I am not an experienced programmer.

Explain technical decisions in plain English.

When proposing changes:

show the reasoning

describe tradeoffs

keep explanations concise

If something is risky:

tell me BEFORE changing it.

If something could break production:

stop and explain first.

---

# Preferred Workflow

I prefer building features incrementally.

Implement one step.

Verify.

Fix bugs.

Then continue.

Avoid implementing five major features at once.

---

# Success Criteria

Every change should improve at least one of:

clarity

calmness

premium feel

simplicity

performance

consistency

If it doesn't improve one of those, reconsider the implementation.

Frequency should feel like a product people fall in love with within the first 30 seconds.