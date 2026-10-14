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

const ITEMS = [
  'Dhara answers drawn exclusively from official sources',
  'Bharatiya Nyaya Sanhita (BNS)',
  'Constitution of India',
  'Supreme Court judgments',
  'Ministry of Law & Justice',
  'National Legal Services Authority (NALSA)',
  'Not legal advice — consult a qualified advocate before acting',
  'Your data is encrypted and never shared with police or courts',
];

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
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* ── Invisible horizontal scroll to measure real text width ────────── */}
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.measurer}
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

      {/* ── Animated doubled ticker (seamless loop via translate) ─────────── */}
      {singleWidth > 0 && (
        <Animated.View
          style={[styles.row, { transform: [{ translateX }] }]}
        >
          <Text style={[styles.text, { color: tc, width: singleWidth }]}>
            {SINGLE}
          </Text>
          <Text style={[styles.text, { color: tc, width: singleWidth }]}>
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
