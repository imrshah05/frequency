# Frequency Design Bible

## Philosophy

Frequency is not a traditional social media app.

It should feel calm, premium and intentional.

Every screen should feel spacious and elegant.

Less UI.
More emotion.

---

# Visual Identity

Mood:

- Calm
- Premium
- Warm
- Minimal
- Modern
- Human

Think:

- Apple Music
- Notion
- Arc Browser
- Linear
- Gentle Spotify

Never:

- TikTok
- Snapchat
- Loud Instagram
- Bright gradients
- Neon colors

---

# Color Palette

Background
#111614

Surface
#18211B

Card
#243127

Accent
#6BA882

Text
#E2EDE8

Muted text
#91A098

Dividers
rgba(255,255,255,0.08)

---

# Typography

Primary font

SF Pro Display

Headers

Large
Heavy
Lots of breathing room

Body

Regular

Small labels

Medium weight

Never use decorative fonts.

---

# Spacing

Whitespace is a feature.

Never make layouts feel crowded.

Prefer larger margins.

Large sections should have 40–60px spacing.

Cards should have generous padding.

---

# Shapes

Large corner radius.

Buttons:

18–24px radius.

Cards:

24–32px radius.

Everything should feel soft.

---

# Motion

Animations should be subtle.

Nothing should bounce aggressively.

Everything should fade.

Everything should glide.

---

# Feed

Each Echo should feel like its own room.

One Echo occupies one screen.

No clutter.

No unnecessary buttons.

The audio is always the hero.

---

# Echo Impact

A quiet, private read on what an Echo's 24 hours were like. For the
person who recorded it and nobody else.

Never a dashboard. Never a scoreboard. Never a number that invites
comparison with anyone else's Echo.

The numbers must be honest, which means they must be stable. An Echo's
Impact is frozen the moment its run ends and never changes afterward —
reopening an old Echo months later shows exactly what it showed the
first time. A story that quietly rewrites itself is not a memory.

A quiet Echo is not a failed Echo. One nobody played still gets a real
Impact, written from what is true — it was said out loud, it had its
day, it is kept. Never a wall of zeros, never "only", never anything
that reads as a scolding.

Counted things have to read like language, not like a database. "1
person", never "1 people". "Brought someone back once", never "back 1
times".

An Impact says a thing once. Three observations means three genuinely
different things that happened — never the same fact reworded, and
never a closing line that repeats what a card just said. If only one
thing worth saying happened, the Impact is one observation long. A
short honest Impact is better than a padded one, and nothing is ever
invented to reach a count.

Only what actually happened gets mentioned. Absence is never narrated:
no "no replays yet", no "nobody shared it". A metric that did not clear
its bar simply is not in the story, and the writing never hints that
something is missing.

The closing line is optional. It earns its place only by tying the
selected facts into something none of them says alone; otherwise the
Impact ends on its last observation.

"Stayed with it" means they actually heard it, not that the audio
happened to reach its end. Someone who listens to nine tenths of an
Echo and closes the app has heard it. Someone who taps play and walks
away has not, however long the clip ran on without them.

Night belongs to the listener, not the creator. If someone in Tokyo
plays an Echo at 11pm their time, that is a late-night listen — the
creator's clock has nothing to do with it.

New ears are worth naming. When people who have never heard your voice
before find an Echo, that is the most interesting thing that can happen
to it. It is always a count and never a name: the Impact says how many
first-time listeners there were, never who. Below two, it stays quiet
entirely — with a single listener, a count of one would point at a
specific person, and that is not an aggregate.

Older Echoes never show a broken or empty version of any of this. An
Echo recorded before these signals existed simply tells the story it
can with what it has, and says nothing about what it cannot measure.

An Impact is not something to check. It arrives.

While an Echo is live, its creator sees two numbers on it and no more:
how many people pressed play, and how many hearts it has. Everything
else that could be said about it is held back. Watching completion
rate tick up on your own voice for twenty-four hours is not
reflection, it is a scoreboard, and it changes what people record.

The Impact then comes to them once the run is over — a full-screen
moment, not a badge and not a row in a list. It is the only screen in
Frequency that takes over the app, and it earns that by happening once
per Echo and never again.

Each Echo gets its own moment. Three Echoes finishing overnight means
three arrivals, one after another, each with its own entrance — never
one screen summarising all three. A combined digest is a report, and a
report is the thing this feature exists not to be.

Nothing is lost by looking away. Closing the reveal is finishing it;
the Impact is in Archives from then on, permanently, exactly as it was
sealed. So the moment can be grand without being a trap.

## How Echo Impact looks

Echo Impact follows the shared frosted-glass system — the same material,
palette and spring as Search and the Whisper sheets. It does not have a
look of its own.

It is a reading, not a report. Opening it should feel like finding out
what happened, not opening a dashboard. So there are no metric tiles, no
grid, and no number set in display type. Each observation is a glyph, a
short title, and one human sentence; the figure sits underneath in small
faint type, there to be checked rather than read first. The sentence is
the largest thing in the row.

Rows are divided by hairlines, never boxed into cards. A card with a
number in it reads as a KPI tile no matter how warm the copy is.

Each observation is numbered, on a thin rail with its icon — it should
feel like turning through something, not scanning a list. Icons are the
app's line glyphs, never emoji; an emoji is the one element that makes
this read as a consumer app rather than Frequency.

Nothing shouts in capitals. Tracked uppercase micro-labels belong to a
generic design system, not to this one.

Type follows the app's existing two header scales rather than inventing
a third: full screens open at 44/800/-1.2, sheets at 26/800/-0.4. Echo
Impact is a sheet but a destination, so it sits at the top of the sheet
range with the same tight tracking.

A zero is never printed as a figure. "0 Whisper shares" is a scoreboard
artefact; if nothing happened, the sentence carries it alone.

The shape holds at any length. One observation is a single quiet
statement, not a sparse grid missing its other tiles.

## How the reveal looks

Two beats, and the first one measures nothing.

It opens on true black — the only place in the app that leaves the
#111614 surface behind, so it reads as Frequency stepping out of the
way rather than as another screen. The mark breathes slowly behind an
accent halo, the Echo is named in its own words, and the single thing
to do is decide to look. Landing straight on the numbers would make
this a notification; the pause is what makes it a moment.

The second beat is the Impact itself, on the same frosted glass as
every other sheet, rendered by the same `EchoImpactStory` that Profile
and Archives use. The reveal does not get a private way of drawing an
observation — it gets a different way of arriving at one.

Between two Echoes the screen holds on black for a beat. Long enough
that the next one reads as a separate arrival, short enough that it
never feels like waiting.

The only concession to there being more than one is a small faint
"2 of 3" under the button, and only when there is more than one.
Without it a second full screen reads as the app repeating itself.

**Shared components extracted here, for reuse by future screens:**

- `components/GlassSheet.tsx` — the frosted bottom sheet. Bloom behind
  the blur, blur, sheen on top, handle, backdrop, `animationType="slide"`.
  Any sheet should use this rather than rebuilding the material.
- `components/EchoImpactStory.tsx` — `EchoImpactStory` and
  `EchoImpactHeading`. Archives and the reveal both render Impact
  through these. Profile used to as well, before the Impact stopped
  being readable while an Echo was live; the two that remain had each
  had their own copy once and had already drifted (Archives led with
  the number, Profile with an icon bubble).
- `components/EchoImpactReveal.tsx` — one Echo's reveal, both beats. It
  knows nothing about queues or persistence: it renders one Echo and
  says when the person is done with it.
- `components/EchoImpactRevealHost.tsx` — what is waiting, in what
  order, and marking each one seen. Mounted once at the root.

---

# Frequency Profile

Feels like a personal journal.

Minimal.

Quiet.

Elegant.

Large profile photo.

Large name.

Very little visual noise.

---

# Buttons

Filled buttons:

Accent green.

Text:

Almost black.

Secondary buttons:

Outlined.

Thin borders.

---

# Cards

Use soft surfaces.

Never pure black.

Never harsh borders.

Use extremely thin separators.

---

# Icons

Simple.

SF Symbols whenever possible.

Thin.

Minimal.

---

# Overall Rule

Whenever making UI decisions ask:

"Would Apple ship this?"

If the answer is no,

make it simpler.

---

# Whispers

1:1 Whispers feel like a quiet exchange between two people.

Group Whispers (additive, new) are a small circle, not a group chat.

Capped at 12 participants.

Echoes drop in chronologically, not as a back-and-forth exchange.

Should still feel calm and intimate, never busy or noisy. Tone,
spacing, animation, and restraint stay Frequency's — but the message
layout itself is the familiar chat-bubble convention, matching 1:1
Whispers exactly, not a novel feed layout. Familiarity won out over
inventing a new pattern here.

Starting a group is a quiet, single small action from the Whispers
inbox — not a prominent flow. The primary action in the app is still
recording, never this.

The participant picker is just people you're already tuned in with.
No open invite links, no adding strangers.

No admin badges, no crowns, no "owner" language anywhere in the UI.
Everyone in a group Whisper has equal standing.

The thread is right-aligned bubbles for your own Echoes, left-aligned
for everyone else's, with an avatar beside each one — same visual
language as 1:1 Whispers. Consecutive Echoes from the same sender
group together. A small name label appears above the first bubble in
a run from someone else, so attribution stays clear with more than
two people in the thread.

Nothing ever auto-plays. Opening a group thread should feel like
walking into a quiet room, not being greeted by a queue of audio
already talking. Every Echo is heard because someone chose to tap it.

"Seen by" is small overlapping profile-photo icons under an Echo,
Instagram-DM style — not text. Shown once another member has opened
the thread since that Echo arrived, same as "seen" works in Instagram
DMs — not tied to whether they specifically played it. A fresh Echo
nobody's opened the thread since shows nothing. Caps at 3 icons with a
"+N" beyond that, tap to see everyone.

No new notification surface for groups. A dot on the Whispers tab is
enough — it is exactly how 1:1 Whispers already say "something's
here," so group Echoes say it the same way. Nothing louder, nothing
that interrupts.