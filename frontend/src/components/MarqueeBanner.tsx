/**
 * MarqueeBanner — scrolling verified-sources ticker.
 * Works like the disclaimer banners on ChatGPT / Claude.
 *
 * Usage:
 *   <MarqueeBanner />                          ← navy bg, white text
 *   <MarqueeBanner variant="light" />          ← light bg, navy text
 *   <MarqueeBanner speed={70} />               ← custom speed px/sec
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, ScrollView } from 'react-native';
import { theme } from '../theme';

/**
 * v2.2 rollout phase 5a — NEEDS LEGAL OK BEFORE MERGE.
 * Two banner lines break the v2.2 content rules: "drawn exclusively from
 * official sources" is a claim the app cannot back up, and "Your data is
 * encrypted and never shared with police or courts" is a blanket
 * encryption claim plus a promise no one can make against a court order.
 * Behind EXPO_PUBLIC_UI_V22_P5_BANNER (default OFF) they are replaced by
 * the owner-approved lines below; the second reuses the approved consent
 * notice wording. Every other item is unchanged. Flag OFF = today's text.
 */
export const UI_V22_P5_BANNER = process.env.EXPO_PUBLIC_UI_V22_P5_BANNER === 'true';

export const BANNER_SOURCES_LINE =
  'Answers draw on Indian law (BNS 2023, BNSS, Constitution). Not legal advice.';
export const BANNER_PRIVACY_LINE =
  'We never share your complaint with the police or anyone else. Only you decide whether to file it.';

const LEGACY_ITEMS = [
  'Dhara answers drawn exclusively from official sources',
  'Bharatiya Nyaya Sanhita (BNS)',
  'Constitution of India',
  'Supreme Court judgments',
  'Ministry of Law & Justice',
  'National Legal Services Authority (NALSA)',
  'Not legal advice — consult a qualified advocate before acting',
  'Your data is encrypted and never shared with police or courts',
];

export const ITEMS = UI_V22_P5_BANNER
  ? LEGACY_ITEMS.map((item, i) =>
      i === 0 ? BANNER_SOURCES_LINE
      : i === LEGACY_ITEMS.length - 1 ? BANNER_PRIVACY_LINE
      : item)
  : LEGACY_ITEMS;

const SEP = '   ·   ';
// Single pass text
const SINGLE = ITEMS.join(SEP) + SEP;

interface Props {
  speed?: number;     // pixels per second (default 52)
  variant?: 'dark' | 'light';
}

export function MarqueeBanner({ speed = 52, variant = 'dark' }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [singleWidth, setSingleWidth] = useState(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const isDark = variant === 'dark';
  const bg  = isDark ? theme.colors.primary         : theme.colors.surfaceSecondary;
  const tc  = isDark ? 'rgba(255,255,255,0.82)'     : theme.colors.onSurfaceTertiary;
  const dot = isDark ? 'rgba(255,255,255,0.30)'     : theme.colors.border;

  useEffect(() => {
    if (singleWidth <= 0) return;
    // Stop any previous animation cleanly
    animRef.current?.stop();
    translateX.setValue(0);

    const duration = (singleWidth / speed) * 1000;

    const anim = Animated.loop(
      Animated.timing(translateX, {
        toValue: -singleWidth,
        duration,
        useNativeDriver: true,
      })
    );
    animRef.current = anim;
    anim.start();

    return () => {
      animRef.current?.stop();
    };
  }, [singleWidth, speed, translateX]);

  return (
    <View
      style={[styles.wrap, { backgroundColor: bg, borderBottomColor: dot }]}
      pointerEvents="none"
    >
      {/* B-75 (21 Nov retest): the ticker text appeared THREE times on web
          (page text / screen readers): this measurer stayed mounted forever
          next to the two loop copies. It is now removed once measured, and
          the second loop copy is hidden from assistive tech, so exactly one
          readable copy exists. */}
      {/* ── Invisible horizontal scroll to measure real text width ────────── */}
      {singleWidth === 0 && (
        <ScrollView
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={styles.measurer}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            style={[styles.text, { color: tc }]}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0 && singleWidth === 0) setSingleWidth(w);
            }}
          >
            {SINGLE}
          </Text>
        </ScrollView>
      )}

      {/* ── Animated doubled ticker (seamless loop via translate) ─────────── */}
      {singleWidth > 0 && (
        <Animated.View
          style={[styles.row, { transform: [{ translateX }] }]}
        >
          <Text style={[styles.text, { color: tc, width: singleWidth }]}>
            {SINGLE}
          </Text>
          {/* Visual-only duplicate for the seamless loop. */}
          <Text
            style={[styles.text, { color: tc, width: singleWidth }]}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {SINGLE}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 27,
    overflow: 'hidden',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  measurer: {
    position: 'absolute',
    opacity: 0,
    top: 0,
    left: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontSize: 11,
    letterSpacing: 0.12,
    paddingHorizontal: 14,
    lineHeight: 27,
    flexShrink: 0,
  },
});
