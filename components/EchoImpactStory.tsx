import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import SpringIn from '@/components/SpringIn';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import type { EchoImpactInsight } from '@/lib/echoImpact';

/**
 * The sheet's opening. The theme is the largest thing on screen -- it is the
 * answer to "what happened to this Echo", which is what the user came to
 * find out. "Echo Impact" itself shrinks to an eyebrow.
 */
export function EchoImpactHeading({
  eyebrow,
  theme,
  subtitle,
}: {
  eyebrow: string;
  theme: string;
  subtitle?: string;
}) {
  return (
    <SpringIn style={styles.heading}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.theme}>{theme}</Text>
      {!!subtitle?.trim() && <Text style={styles.subtitle}>{subtitle}</Text>}
    </SpringIn>
  );
}

// A figure is worth showing only if it counts something that happened.
// Percentages stay ("0%" is still a real reading); a bare zero does not.
function hasCount(number: number | string) {
  const value = String(number).trim();

  if (value.length === 0) return false;

  return value !== '0';
}

/**
 * How an Echo's Impact reads.
 *
 * This used to be a grid of metric tiles led by a 34pt number, which made a
 * private, emotional thing look like an analytics dashboard. The numbers are
 * still true and still shown -- they just stopped being the headline.
 *
 * Each observation is now a numbered entry: a sequence numeral and thin line
 * icon on a rail, a short title, and one human sentence set at reading size.
 * The figure sits underneath as a quiet footnote, so the sentence is what the
 * eye lands on and the number is what confirms it. Rows are separated by
 * hairlines rather than boxed into cards, because a card with a big number in
 * it reads as a KPI tile no matter what the copy says.
 *
 * Shared by the Profile modal and Archives, which previously each rendered
 * this list their own way and had already drifted apart -- Archives led with
 * the number, Profile led with an icon bubble.
 *
 * Data contract is unchanged: whatever the Phase 2/3 pipeline produced,
 * mapped to insights by echoImpactStoryFromAIImpact. The Final Reflection is
 * still absent entirely when the AI returned no closing line.
 */
export default function EchoImpactStory({ insights }: { insights: EchoImpactInsight[] }) {
  if (insights.length === 0) return null;

  let observationNumber = 0;

  return (
    <View style={styles.list}>
      {insights.map((insight, index) => {
        const isReflection = insight.tone === 'reflection';
        const isFirst = index === 0;

        if (!isReflection) observationNumber += 1;

        return (
          <SpringIn
            key={`${insight.title}-${index}`}
            delay={90 + index * 70}
            style={[
              styles.row,
              !isFirst && styles.rowDivided,
              isReflection && styles.reflectionRow,
            ]}
          >
            {isReflection ? (
              <View style={styles.reflectionCopy}>
                <Text style={styles.reflectionLabel}>{insight.title}</Text>
                <Text style={styles.reflectionBody}>{insight.body}</Text>
              </View>
            ) : (
              <>
                {/*
                  Thin line icons rather than the emoji the old cards used --
                  the design bible calls for SF Symbol-style glyphs, and an
                  emoji is the one element on this sheet that reads as a
                  consumer app. `icon` is already derived from the metric.
                */}
                <View style={styles.rail}>
                  <Text style={styles.index}>
                    {String(observationNumber).padStart(2, '0')}
                  </Text>
                  <Ionicons
                    name={insight.icon as keyof typeof Ionicons.glyphMap}
                    size={17}
                    color={C.accent}
                  />
                </View>

                <View style={styles.copy}>
                  <Text style={styles.title}>{insight.title}</Text>
                  <Text style={styles.body}>{insight.body}</Text>

                  {/*
                    The measurement, demoted to a footnote. Kept because the
                    observation should be checkable, not because the count is
                    the point -- and dropped entirely when it is zero, since
                    "0 Whisper shares" is exactly the scoreboard artefact this
                    layout exists to remove.
                  */}
                  {hasCount(insight.number) && (
                    <Text style={styles.footnote}>
                      {insight.number}
                      {insight.label ? ` ${insight.label}` : ''}
                    </Text>
                  )}
                </View>
              </>
            )}
          </SpringIn>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: 6,
    paddingBottom: 4,
  },

  // Sentence case, not the tracked uppercase micro-label of a generic
  // design system -- nothing else in Frequency shouts in caps.
  eyebrow: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
  },

  // Pitched between the app's two established header scales: full screens
  // open at 44/800/-1.2, existing sheets at 26/800/-0.4. This is a sheet,
  // so it stays in sheet range -- but it is a destination rather than a
  // form, so it sits at the top of that range and keeps the tight tracking
  // that makes the app's headers feel like headers.
  theme: {
    color: C.text,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 39,
    letterSpacing: -1,
  },

  subtitle: {
    color: C.muted,
    fontSize: 18,
    lineHeight: 26,
  },

  list: {
    paddingTop: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 24,
  },

  // A quiet editorial rail: the sequence numeral above a thin glyph. It
  // gives the sheet the feeling of turning through something rather than
  // scanning a list, without adding a single loud element.
  rail: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
    width: 26,
  },

  index: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },

  // A hairline instead of a card edge: it groups the rows into one reading
  // rather than four competing panels.
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(226,237,232,0.10)',
  },

  copy: {
    flex: 1,
    gap: 7,
  },

  title: {
    color: C.accentSoft,
    fontSize: 15,
    fontWeight: '700',
  },

  // The app's paragraph voice, exactly: 17/400 with no tracking, the same
  // as comment bodies, bios and every empty state. Tightened tracking is
  // reserved for large heavy headers here -- applying it to running text
  // makes the letterforms read as a different typeface than the rest of
  // the app, which is precisely what it looked like at 21/-0.5.
  body: {
    color: C.text,
    fontSize: 17,
    lineHeight: 26,
  },

  footnote: {
    color: C.faint,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },

  reflectionRow: {
    borderTopColor: 'rgba(168,205,183,0.20)',
    paddingTop: 22,
  },

  reflectionCopy: {
    flex: 1,
    gap: 8,
  },

  reflectionLabel: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
  },

  reflectionBody: {
    color: C.accentSoft,
    fontSize: 17,
    lineHeight: 26,
  },
});
