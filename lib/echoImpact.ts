import { completionRate as metricCompletionRate, type EchoImpactMetrics } from './echoMetrics';

export type { EchoImpactMetrics };

// Counted nouns are written once, here, so a metric of 1 never reads as
// "1 people" or "back 1 times". Every interpolation below that is followed
// by a noun goes through one of these.
function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function counted(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

export type EchoImpactInsight = {
  icon: string;
  emoji?: string;
  title: string;
  number: number | string;
  label: string;
  body: string;
  tone?: 'normal' | 'reflection';
};

export type EchoImpactStory = {
  personalityTitle: string;
  storySubtitle: string;
  insights: EchoImpactInsight[];
};

export type AIEchoImpactCard = {
  emoji: string;
  title: string;
  number: string;
  metric_label: string;
  story: string;
};

export type AIEchoImpact = {
  id: string;
  voice_note_id: string;
  user_id: string;
  theme: string;
  subtitle: string;
  cards: AIEchoImpactCard[];
  final_reflection: string;
  metrics_snapshot: Record<string, unknown>;
  model: string | null;
  prompt_version: string;
  generated_at: string;
  updated_at: string;
};

function iconForMetric(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes('play')) return 'play-circle-outline';
  if (normalized.includes('completion') || normalized.includes('stayed')) return 'checkmark-circle-outline';
  if (normalized.includes('replay') || normalized.includes('return')) return 'repeat-outline';
  if (normalized.includes('like') || normalized.includes('heart')) return 'heart-outline';
  if (normalized.includes('comment') || normalized.includes('reply')) return 'chatbubble-ellipses-outline';
  if (normalized.includes('whisper') || normalized.includes('share')) return 'paper-plane-outline';
  if (normalized.includes('night') || normalized.includes('midnight')) return 'moon-outline';

  return 'sparkles-outline';
}

export function echoImpactStoryFromAIImpact(impact: AIEchoImpact): EchoImpactStory {
  const insights: EchoImpactInsight[] = impact.cards.map((card) => ({
    icon: iconForMetric(card.metric_label),
    emoji: card.emoji,
    title: card.title,
    number: card.number,
    label: card.metric_label,
    body: card.story,
  }));

  // The closing line is optional from Phase 2 onward: it only exists when
  // it ties the selected facts together into something none of them says
  // alone. An Impact without one ends on its last observation rather than
  // on an empty card.
  const closing = impact.final_reflection?.trim();

  if (closing) {
    insights.push({
      icon: 'sparkles-outline',
      title: 'Final Reflection',
      number: '',
      label: '',
      body: closing,
      tone: 'reflection',
    });
  }

  return {
    personalityTitle: impact.theme,
    storySubtitle: impact.subtitle,
    insights,
  };
}

type EchoImpactTheme =
  | 'Passed Along'
  | 'Night Companion'
  | 'Quiet Comfort'
  | 'Replay Magnet'
  | 'Conversation Starter'
  | 'Small Room, Strong Signal'
  | 'Stayed Until The End'
  | 'Quietly Loved'
  | 'Slow Bloom'
  | 'Still Finding Its People';

const completionRate = metricCompletionRate;

function nightShare(metrics: EchoImpactMetrics) {
  if (metrics.plays === 0) return 0;

  return metrics.nightPlays / metrics.plays;
}

function totalActivity(metrics: EchoImpactMetrics) {
  return (
    metrics.plays +
    metrics.completions +
    metrics.replays +
    metrics.hearts +
    metrics.comments +
    metrics.shares
  );
}

function compactCount(count: number, fallback = 0) {
  return Number.isFinite(count) ? count : fallback;
}

function chooseTheme(metrics: EchoImpactMetrics): EchoImpactTheme {
  const rate = completionRate(metrics);
  const lowActivity = totalActivity(metrics) <= 2;
  const lowPlays = metrics.plays > 0 && metrics.plays <= 3;
  const highCompletion = metrics.completions > 0 && (rate >= 60 || metrics.completions >= 3);
  const highNight = metrics.nightPlays > 0 && (metrics.nightPlays >= 2 || nightShare(metrics) >= 0.5);

  if (lowActivity) return 'Still Finding Its People';
  if (metrics.shares >= 2 || (metrics.shares > 0 && metrics.shares >= metrics.comments)) return 'Passed Along';
  if (highNight) return 'Night Companion';
  if (metrics.replays >= 2 || (metrics.replays > 0 && metrics.replays >= metrics.shares)) return 'Replay Magnet';
  if (metrics.comments >= 2 || (metrics.comments > 0 && metrics.comments >= metrics.hearts)) return 'Conversation Starter';
  if (lowPlays && highCompletion) return 'Small Room, Strong Signal';
  if (highCompletion) return 'Stayed Until The End';
  if (metrics.hearts > 0) return 'Quietly Loved';
  if (metrics.plays > 0) return 'Slow Bloom';

  return 'Quiet Comfort';
}

function themeNickname(theme: EchoImpactTheme) {
  switch (theme) {
    case 'Passed Along':
      return 'Ripple Maker';
    case 'Night Companion':
      return 'Midnight Companion';
    case 'Replay Magnet':
      return 'Worth Another Listen';
    case 'Conversation Starter':
      return 'Spark Starter';
    case 'Stayed Until The End':
      return 'Final Word Energy';
    default:
      return theme;
  }
}

function storySubtitle(theme: EchoImpactTheme) {
  switch (theme) {
    case 'Passed Along':
      return 'This Echo did not stay in one place.';
    case 'Night Companion':
      return 'This Echo found people when the day got quiet.';
    case 'Replay Magnet':
      return 'Some voices are worth hearing twice.';
    case 'Conversation Starter':
      return 'This Echo gave people something to say back.';
    case 'Small Room, Strong Signal':
      return 'This Echo felt small, but personal.';
    case 'Stayed Until The End':
      return 'People stayed with this voice all the way through.';
    case 'Quietly Loved':
      return 'This Echo collected a few soft yeses.';
    case 'Slow Bloom':
      return 'This Echo is taking the scenic route to its people.';
    case 'Still Finding Its People':
      return 'This Echo is still carrying itself quietly.';
    case 'Quiet Comfort':
    default:
      return 'This Echo felt small, but personal.';
  }
}

function shareBody(count: number) {
  if (count === 1) return 'Someone heard this and thought, "you need to hear this too."';
  if (count <= 5) return 'This Echo quietly travelled from person to person.';

  return 'Your Echo kept escaping into new conversations.';
}

function heartBody(count: number) {
  if (count === 0) return 'No hearts yet, but this Echo is still carrying itself nicely.';
  if (count === 1) return 'One quiet little yes for your voice.';
  if (count <= 5) return 'A few people left little yeses behind.';

  return 'This one collected a soft little crowd of hearts.';
}

function playBody(count: number) {
  if (count === 0) return 'This Echo is still waiting for its first listener.';
  if (count === 1) return 'One person chose to spend a moment with your voice.';
  if (count <= 5) return 'A few people gave your voice a little part of their day.';

  return 'This Echo found a small crowd of ears.';
}

function completionBody(rate: number) {
  if (rate >= 80) return 'They did not just tap in. They stayed with your voice.';
  if (rate >= 40) return 'People stayed around long enough to catch the shape of this thought.';

  return 'This Echo left a small trace, even in a short listen.';
}

function nightBody(count: number) {
  if (count === 1) return 'One listen arrived after the lights went low.';
  if (count <= 5) return 'Your Echo found people when the world got quiet.';

  return 'This one became a small signal for the late-night crowd.';
}

function replayBody(count: number) {
  if (count === 1) return 'One person came back for the second pass.';
  if (count <= 5) return 'Apparently one listen was not quite enough.';

  return 'This Echo made a habit of pulling people back in.';
}

function ripples(metrics: EchoImpactMetrics) {
  return metrics.shares + metrics.comments;
}

function finalReflection(theme: EchoImpactTheme, metrics: EchoImpactMetrics): EchoImpactInsight {
  const totalRipples = ripples(metrics);
  const reached = counted(metrics.plays, 'person', 'people');
  const rippled = `${totalRipples} little ${plural(totalRipples, 'ripple')}`;
  let body = `During its 24-hour journey, this Echo reached ${reached}, sparked ${rippled}, and gathered ${counted(metrics.hearts, 'heart')}.\n\nNot every Echo needs to be loud. Sometimes it just needs the right ears.`;
  let number: number | string = metrics.plays;
  let label = plural(metrics.plays, 'person reached', 'people reached');

  if (theme === 'Passed Along') {
    number = totalRipples;
    label = `little ${plural(totalRipples, 'ripple')}`;
    body = `Before settling into Your Echoes, this one travelled through ${rippled}.\n\nIt did not need a spotlight. It found a path.`;
  } else if (theme === 'Night Companion') {
    number = metrics.nightPlays;
    label = `night ${plural(metrics.nightPlays, 'listener')}`;
    body = `This Echo spent part of its life with ${counted(metrics.nightPlays, 'night listener')}.\n\nSome thoughts know exactly when to arrive.`;
  } else if (theme === 'Quiet Comfort') {
    body = `This Echo reached ${reached} quietly. That still counts.\n\nA soft signal is still a signal.`;
  } else if (theme === 'Small Room, Strong Signal') {
    number = `${completionRate(metrics)}%`;
    label = 'stayed with it';
    body = `This Echo reached ${reached}, and ${completionRate(metrics)}% stayed with it.\n\nA small room can still carry a strong signal.`;
  } else if (theme === 'Replay Magnet') {
    number = metrics.replays;
    label = `return ${plural(metrics.replays, 'listen')}`;
    body = metrics.replays === 1
      ? 'This Echo brought someone back once before settling into Your Echoes.\n\nSome voices leave a little doorway open.'
      : `This Echo brought people back ${metrics.replays} times before settling into Your Echoes.\n\nSome voices leave a little doorway open.`;
  } else if (theme === 'Conversation Starter') {
    number = metrics.comments;
    label = `${plural(metrics.comments, 'reply', 'replies')} started`;
    body = `This Echo sparked ${counted(metrics.comments, 'reply', 'replies')} and ${counted(metrics.shares, 'Whisper share')}.\n\nIt gave the room something to answer.`;
  } else if (theme === 'Stayed Until The End') {
    number = `${completionRate(metrics)}%`;
    label = 'completion rate';
    body = `${completionRate(metrics)}% stayed with this Echo until the end.\n\nThat is a quiet kind of attention.`;
  } else if (theme === 'Quietly Loved') {
    number = metrics.hearts;
    label = `${plural(metrics.hearts, 'heart')} gathered`;
    body = `This Echo gathered ${counted(metrics.hearts, 'heart')} from ${counted(metrics.plays, 'listener')}.\n\nA few little yeses can be plenty.`;
  } else if (theme === 'Slow Bloom') {
    body = `This Echo reached ${reached} during its 24-hour life.\n\nSome Echoes bloom slowly, then keep their shape.`;
  } else if (theme === 'Still Finding Its People') {
    body = `This Echo reached ${reached} and sparked ${rippled}.\n\nEvery Echo starts somewhere. This one is still carrying itself quietly.`;
  }

  return {
    icon: 'sparkles-outline',
    title: 'Final Reflection',
    number,
    label,
    body,
    tone: 'reflection',
  };
}

function sharedCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'paper-plane-outline',
      title: 'Whisper Journeys',
      number: metrics.shares,
      label: plural(metrics.shares, 'Whisper share', 'Whisper shares'),
      body: shareBody(metrics.shares),
    },
    {
      icon: 'git-branch-outline',
      title: 'Ripple Effect',
      number: ripples(metrics),
      label: plural(ripples(metrics), 'conversation sparked', 'conversations sparked'),
      body: 'This Echo kept moving after it ended.',
    },
    {
      icon: 'heart-outline',
      title: 'Quietly Loved',
      number: metrics.hearts,
      label: plural(metrics.hearts, 'heart landed here', 'hearts landed here'),
      body: heartBody(metrics.hearts),
    },
  ];
}

function nightCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  const rate = completionRate(metrics);

  return [
    {
      icon: 'moon-outline',
      title: 'Night Owls',
      number: metrics.nightPlays,
      label: 'listened after 10 PM',
      body: nightBody(metrics.nightPlays),
    },
    {
      icon: 'checkmark-circle-outline',
      title: 'Stayed Late',
      number: rate >= 50 ? `${rate}%` : metrics.completions,
      label: 'stayed until the end',
      body: completionBody(rate),
    },
    {
      icon: 'repeat-outline',
      title: 'Worth Another Listen',
      number: metrics.replays,
      label: 'came back again',
      body: metrics.replays > 0 ? replayBody(metrics.replays) : 'The night kept this one close, even without a replay.',
    },
  ];
}

function smallRoomCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'radio-outline',
      title: 'Small Room',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: 'A small room. A focused little group of listeners.',
    },
    {
      icon: 'pulse-outline',
      title: 'Strong Signal',
      number: `${completionRate(metrics)}%`,
      label: 'stayed with it',
      body: completionBody(completionRate(metrics)),
    },
    {
      icon: 'heart-outline',
      title: 'Gentle Hearts',
      number: metrics.hearts,
      label: plural(metrics.hearts, 'heart landed here', 'hearts landed here'),
      body: heartBody(metrics.hearts),
    },
  ];
}

function replayCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'repeat-outline',
      title: 'Worth Another Listen',
      number: metrics.replays,
      label: 'came back again',
      body: replayBody(metrics.replays),
    },
    {
      icon: 'play-circle-outline',
      title: 'Return Path',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: playBody(metrics.plays),
    },
    {
      icon: 'checkmark-circle-outline',
      title: 'Stayed With It',
      number: completionRate(metrics) >= 50 ? `${completionRate(metrics)}%` : metrics.completions,
      label: 'stayed until the end',
      body: completionBody(completionRate(metrics)),
    },
  ];
}

function conversationCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'chatbubble-ellipses-outline',
      title: 'Spark Starter',
      number: metrics.comments,
      label: plural(metrics.comments, 'reply started here', 'replies started here'),
      body: metrics.comments === 1
        ? 'One reply found its way back. That is how sparks begin.'
        : 'This Echo gave people something to say back.',
    },
    {
      icon: 'paper-plane-outline',
      title: 'Private Threads',
      number: metrics.shares,
      label: plural(metrics.shares, 'Whisper share', 'Whisper shares'),
      body: metrics.shares > 0 ? shareBody(metrics.shares) : 'Some thoughts travel best through a quieter doorway.',
    },
    {
      icon: 'heart-outline',
      title: 'Warm Reply',
      number: metrics.hearts,
      label: plural(metrics.hearts, 'heart landed here', 'hearts landed here'),
      body: heartBody(metrics.hearts),
    },
  ];
}

function completionCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  const rate = completionRate(metrics);

  return [
    {
      icon: 'checkmark-circle-outline',
      title: 'Final Word Energy',
      number: rate >= 50 ? `${rate}%` : metrics.completions,
      label: 'stayed until the end',
      body: completionBody(rate),
    },
    {
      icon: 'play-circle-outline',
      title: 'Found The Room',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: playBody(metrics.plays),
    },
    {
      icon: 'repeat-outline',
      title: 'Second Pass',
      number: metrics.replays,
      label: 'came back again',
      body: metrics.replays > 0 ? replayBody(metrics.replays) : 'Some Echoes leave a little reason to return later.',
    },
  ];
}

function lovedCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'heart-outline',
      title: 'Quietly Loved',
      number: metrics.hearts,
      label: plural(metrics.hearts, 'heart landed here', 'hearts landed here'),
      body: heartBody(metrics.hearts),
    },
    {
      icon: 'play-circle-outline',
      title: 'Found A Few Ears',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: playBody(metrics.plays),
    },
    {
      icon: 'checkmark-circle-outline',
      title: 'Stayed Softly',
      number: metrics.completions,
      label: 'stayed until the end',
      body: completionBody(completionRate(metrics)),
    },
  ];
}

function slowBloomCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'leaf-outline',
      title: 'Slow Bloom',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: playBody(metrics.plays),
    },
    {
      icon: 'lock-closed-outline',
      title: 'Held Close',
      number: metrics.shares,
      label: plural(metrics.shares, 'Whisper share', 'Whisper shares'),
      body: metrics.shares > 0 ? shareBody(metrics.shares) : 'For now, this one is keeping its story close.',
    },
    {
      icon: 'chatbubble-outline',
      title: 'Quiet Replies',
      number: metrics.comments,
      label: plural(metrics.comments, 'reply started here', 'replies started here'),
      body: metrics.comments > 0
        ? 'A reply found its way back. That is a small spark.'
        : 'Some Echoes leave people thinking before they answer.',
    },
  ];
}

function stillFindingCards(metrics: EchoImpactMetrics): EchoImpactInsight[] {
  return [
    {
      icon: 'leaf-outline',
      title: 'Still Finding Its People',
      number: metrics.plays,
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      body: playBody(metrics.plays),
    },
    {
      icon: 'lock-closed-outline',
      title: 'Held Close',
      number: metrics.shares,
      label: plural(metrics.shares, 'Whisper share', 'Whisper shares'),
      body: 'No shares yet. This Echo is keeping its story close for now.',
    },
    {
      icon: 'chatbubble-outline',
      title: 'Quiet Replies',
      number: metrics.comments,
      label: plural(metrics.comments, 'reply started here', 'replies started here'),
      body: 'No replies yet. Some Echoes leave people thinking quietly.',
    },
  ];
}

function cardsForTheme(theme: EchoImpactTheme, metrics: EchoImpactMetrics) {
  switch (theme) {
    case 'Passed Along':
      return sharedCards(metrics);
    case 'Night Companion':
      return nightCards(metrics);
    case 'Replay Magnet':
      return replayCards(metrics);
    case 'Conversation Starter':
      return conversationCards(metrics);
    case 'Small Room, Strong Signal':
      return smallRoomCards(metrics);
    case 'Stayed Until The End':
      return completionCards(metrics);
    case 'Quietly Loved':
      return lovedCards(metrics);
    case 'Slow Bloom':
      return slowBloomCards(metrics);
    case 'Still Finding Its People':
      return stillFindingCards(metrics);
    case 'Quiet Comfort':
    default:
      return lovedCards(metrics);
  }
}

// Future AI hook:
// OpenAI/AI storytelling can replace this local theme engine later. The AI
// layer should use transcript + EchoImpactMetrics to generate the theme
// nickname, card copy, and final reflection while returning this same shape.
export function buildEchoImpactInsights(metrics: EchoImpactMetrics): EchoImpactStory {
  const safeMetrics = {
    plays: compactCount(metrics.plays),
    completions: compactCount(metrics.completions),
    replays: compactCount(metrics.replays),
    hearts: compactCount(metrics.hearts),
    comments: compactCount(metrics.comments),
    shares: compactCount(metrics.shares),
    nightPlays: compactCount(metrics.nightPlays),
  };
  const theme = chooseTheme(safeMetrics);
  const cards = cardsForTheme(theme, safeMetrics);

  cards.push(finalReflection(theme, safeMetrics));

  return {
    personalityTitle: themeNickname(theme),
    storySubtitle: storySubtitle(theme),
    insights: cards.slice(0, 5),
  };
}
