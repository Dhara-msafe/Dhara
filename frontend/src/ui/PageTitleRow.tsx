/**
 * One title row for every screen opened from Me (26 Nov 2026, Vivek).
 *
 * Sits directly under the shared DHARA header (or at the top of the screen
 * on wide web, where the header is replaced by the sidebar). Same back
 * arrow, same title style and the same left edge on every screen:
 *
 *   [ < ]  Title                          InterExtraBold 20, navy
 *          Subtitle, at most two lines…   Inter 13, grey
 *
 * Measurements are fixed here so the title starts at exactly the same x on
 * every screen: 8 px row padding + 48 px back target + 4 px gap = 60 px.
 * A long subtitle wraps to two lines and then ends with "…" (no scrolling
 * text: it is hard to read and needs a pause control under WCAG 2.2.2);
 * screen readers always get the full text.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { focusRingStyle } from '../a11yFocus';

const c = theme.colors;

export const PAGE_TITLE = {
  rowPaddingLeft: 8,
  backSize: 48,
  gap: 4,
  titleSize: 20,
  titleLine: 26,
  subtitleSize: 13,
  subtitleLine: 18,
  subtitleLines: 2,
} as const;

export function PageTitleRow({
  title, subtitle, onBack, right, backTestID = 'page-back', testID = 'page-title-row',
}: {
  title: string;
  subtitle?: string;
  /** Optional control at the right end (e.g. Advocates' profile button). */
  right?: React.ReactNode;
  /** Where Back goes. Default: the previous screen, or Me when there is none. */
  onBack?: () => void;
  backTestID?: string;
  testID?: string;
}) {
  const router = useRouter();
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/me')));
  return (
    <View style={s.row} testID={testID}>
      <Pressable
        testID={backTestID}
        onPress={goBack}
        hitSlop={4}
        style={(st) => [s.back, focusRingStyle(st)]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={c.navy} />
      </Pressable>
      <View style={s.text}>
        <Text style={s.title} numberOfLines={2} accessibilityRole="header" maxFontSizeMultiplier={1.4}>{title}</Text>
        {subtitle ? (
          <Text
            style={s.subtitle}
            numberOfLines={PAGE_TITLE.subtitleLines}
            ellipsizeMode="tail"
            accessibilityLabel={subtitle}
            maxFontSizeMultiplier={1.4}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PAGE_TITLE.gap,
    paddingLeft: PAGE_TITLE.rowPaddingLeft,
    paddingRight: 16,
    paddingVertical: 8,
    minHeight: 64,
    backgroundColor: c.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  back: { width: PAGE_TITLE.backSize, height: PAGE_TITLE.backSize, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  title: { color: c.navy, fontFamily: theme.fonts.displayBold, fontSize: PAGE_TITLE.titleSize, lineHeight: PAGE_TITLE.titleLine },
  subtitle: { color: c.onSurfaceSecondary, fontFamily: theme.fonts.body, fontSize: PAGE_TITLE.subtitleSize, lineHeight: PAGE_TITLE.subtitleLine, marginTop: 2 },
});
