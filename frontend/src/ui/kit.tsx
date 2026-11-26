/**
 * DHARA shared parts (redesign v3, 26 Nov 2026).
 *
 * One set of building blocks so every screen has the same header, cards,
 * buttons and spacing, following the approved standalone.html prototype:
 *   AppHeader   back · "DHARA" wordmark + tagline · "SOS 112" pill
 *   Screen      frame that leaves room for the status bar and Android's
 *               navigation buttons, with the size-class side margins
 *   TitleBlock  small gold label, bold title, grey line
 *   Panel       white card with a thin border; blue / warn / danger / success tints
 *   Button      one shape, six colours
 *   Tile        icon + label + one small line, for 2-per-row grids
 *   Chip, Badge, KeyValueRow, ProgressSteps, TileGrid
 *
 * Sizes follow the prototype (title 24, card heading 15, body 13). Two
 * differences on purpose: nothing is under 12 and every tap target is at
 * least 48 (the prototype draws some at 10-11 and 34-44); and icons are the
 * app's line icons instead of emoji so they look the same on every phone.
 */
import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  type StyleProp, type ViewStyle, type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useSizeClass } from './useSizeClass';
import { FONT_SCALE_CAP, columnWidth } from './sizeClass';
import { useHeaderSosPresent } from './headerSos';

const c = theme.colors;
const f = theme.fonts;
const t = theme.type;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Header ──────────────────────────────────────────────────────────────

/**
 * Light status-bar icons while a dark (navy) header is on the focused screen;
 * back to dark icons when it loses focus. Imperative because tab screens stay
 * mounted, so a mounted <StatusBar> on a hidden tab would win.
 */
export function useLightStatusBar(): void {
  useFocusEffect(React.useCallback(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []));
}

/**
 * Solid strip behind the status bar, for screens whose header scrolls with
 * the content: without it, scrolled content shows through under the clock.
 */
export function StatusBarCap({ color = c.deepNavy }: { color?: string }) {
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  if (!insets.top) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: color, zIndex: 50 }} />;
}

export function SosPill112({ onPress, testID = 'header-sos' }: { onPress?: () => void; testID?: string }) {
  const router = useRouter();
  useHeaderSosPresent();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="SOS. Emergency help and 112"
      hitSlop={8}
      onPress={onPress ?? (() => router.push('/emergency'))}
      style={({ pressed }) => [s.sos, pressed && s.pressed]}
    >
      <Ionicons name="warning" size={14} color="#fff" />
      <Text style={s.sosText} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>SOS 112</Text>
    </Pressable>
  );
}

export function AppHeader({
  showBack = true, onBack, tagline = 'Your legal rights. Always with you.', showSos = true, right, testID = 'app-header',
}: {
  showBack?: boolean; onBack?: () => void; tagline?: string; showSos?: boolean; right?: React.ReactNode; testID?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  useLightStatusBar();
  return (
    <LinearGradient
      testID={testID}
      colors={[c.deepNavy, c.brandTertiary]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      // The header colour runs behind the status bar; its content starts below it.
      style={[s.header, { paddingTop: insets.top + (size.short ? 8 : 12), paddingHorizontal: size.margin }]}
    >
      <View style={s.headerLeft}>
        {showBack && (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home')))}
            style={({ pressed }) => [s.back, pressed && s.pressed]}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
        )}
        <View style={s.brandWrap}>
          <Text style={s.brand} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome} numberOfLines={1}>DHARA</Text>
          {!size.short && !!tagline && (
            <Text style={s.tagline} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome} numberOfLines={1}>{tagline}</Text>
          )}
        </View>
      </View>
      <View style={s.headerRight}>
        {right}
        {showSos && <SosPill112 />}
      </View>
    </LinearGradient>
  );
}

// ── Screen frame ────────────────────────────────────────────────────────

export function Screen({
  children, header, footer, scroll = true, tabBarBelow = false, contentStyle, testID,
}: {
  children: React.ReactNode;
  /** Usually <AppHeader />. It handles the status-bar space itself. */
  header?: React.ReactNode;
  /** Pinned under the content (e.g. the main action). Gets the bottom inset. */
  footer?: React.ReactNode;
  scroll?: boolean;
  /** True on tab screens: the tab bar already covers the bottom inset. */
  tabBarBelow?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const bottom = tabBarBelow ? 0 : insets.bottom;
  const pad: ViewStyle = {
    paddingHorizontal: size.margin,
    paddingTop: header ? 18 : insets.top + 18,
    paddingBottom: (footer ? 0 : bottom) + 16,
    width: '100%', maxWidth: size.maxContentWidth, alignSelf: 'center',
  };
  return (
    <View style={s.screen} testID={testID}>
      {header}
      {scroll ? (
        <ScrollView style={s.flex} contentContainerStyle={[pad, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[s.flex, pad, contentStyle]}>{children}</View>
      )}
      {footer && (
        <View style={[s.footer, { paddingHorizontal: size.margin, paddingBottom: bottom + 12 }]}>{footer}</View>
      )}
    </View>
  );
}

// ── Title block ─────────────────────────────────────────────────────────

export function TitleBlock({ eyebrow, title, sub, greeting = false }: {
  eyebrow?: string; title: string; sub?: string; greeting?: boolean;
}) {
  const size = useSizeClass();
  return (
    <View style={s.titleBlock}>
      {!!eyebrow && <Text style={s.eyebrow} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{eyebrow}</Text>}
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}
        style={[s.title, { fontSize: greeting ? size.title + 1 : size.title, lineHeight: Math.round((greeting ? size.title + 1 : size.title) * 1.2) }]}
      >{title}</Text>
      {!!sub && <Text style={s.sub} maxFontSizeMultiplier={FONT_SCALE_CAP.body}>{sub}</Text>}
    </View>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────

export type PanelTone = 'default' | 'blue' | 'warn' | 'danger' | 'success';
const PANEL_TONE: Record<PanelTone, { bg: string; border: string }> = {
  default: { bg: c.paper, border: c.border },
  blue: { bg: c.blueBg, border: c.blueBorder },
  warn: { bg: c.warnBg, border: c.warnBorder },
  danger: { bg: c.dangerBg, border: c.dangerBorder },
  success: { bg: c.successBg, border: c.successBorder },
};

export function Panel({ tone = 'default', title, children, style, testID }: {
  tone?: PanelTone; title?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const size = useSizeClass();
  const k = PANEL_TONE[tone];
  return (
    <View testID={testID} style={[s.panel, { backgroundColor: k.bg, borderColor: k.border, marginVertical: size.gap / 2 }, style]}>
      {!!title && <Text style={s.panelTitle} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{title}</Text>}
      {children}
    </View>
  );
}

/** Body text for inside a Panel (or anywhere a paragraph is needed). */
export function Body({ children, style, muted = true }: { children: React.ReactNode; style?: StyleProp<TextStyle>; muted?: boolean }) {
  return <Text style={[s.body, !muted && { color: c.ink }, style]} maxFontSizeMultiplier={FONT_SCALE_CAP.body}>{children}</Text>;
}

// ── Button ──────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'gold' | 'green' | 'red' | 'softRed' | 'outline';
const BTN: Record<ButtonVariant, { bg: string; border: string; fg: string }> = {
  primary: { bg: c.navy, border: c.navy, fg: '#FFFFFF' },
  gold: { bg: c.gold, border: '#D6AC51', fg: c.onGold },
  green: { bg: c.safeGreen, border: c.safeGreen, fg: '#FFFFFF' },
  red: { bg: c.error, border: c.error, fg: '#FFFFFF' },
  softRed: { bg: c.dangerBg, border: c.softRedBorder, fg: c.softRedText },
  outline: { bg: c.paper, border: c.outlineBorder, fg: c.navy },
};

export function Button({
  label, onPress, variant = 'primary', icon, full = false, disabled = false, loading = false, style, testID, accessibilityLabel,
}: {
  label: string; onPress?: () => void; variant?: ButtonVariant; icon?: IconName; full?: boolean;
  disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string;
}) {
  const size = useSizeClass();
  const k = BTN[variant];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn, { backgroundColor: k.bg, borderColor: k.border, minHeight: size.button },
        full && s.btnFull, off && s.btnOff, pressed && s.pressed, style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={k.fg} />
        : <>
            {!!icon && <Ionicons name={icon} size={18} color={k.fg} />}
            <Text style={[s.btnText, { color: k.fg }]} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{label}</Text>
          </>}
    </Pressable>
  );
}

/** Two or more buttons side by side, equal width. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={s.btnRow}>{React.Children.map(children, (ch) => <View style={s.flex}>{ch}</View>)}</View>;
}

// ── Tiles ───────────────────────────────────────────────────────────────

export function Tile({ icon, label, hint, onPress, alert = false, width, testID }: {
  icon: IconName; label: string; hint?: string; onPress?: () => void; alert?: boolean; width?: number; testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={({ pressed }) => [s.tile, alert && s.tileAlert, width != null && { width }, pressed && s.pressed]}
    >
      <Ionicons name={icon} size={26} color={alert ? c.error : c.navy} />
      <Text style={s.tileLabel} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{label}</Text>
      {!!hint && <Text style={s.tileHint} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{hint}</Text>}
    </Pressable>
  );
}

/** Lays children out in the size class's tile columns. Pass the width left inside its container. */
export function TileGrid({ children, columns, inset = 0 }: { children: React.ReactNode; columns?: number; inset?: number }) {
  const size = useSizeClass();
  const cols = columns ?? size.tileColumns;
  const gap = 9;
  const guessed = Math.min(size.windowWidth, size.maxContentWidth) - size.margin * 2 - inset;
  // Polish: measure the grid's real width. The guess above ignores borders,
  // so it could come out a pixel too wide and push the second tile onto a
  // new row. The guess is only used for the first frame.
  const [measured, setMeasured] = React.useState<number | null>(null);
  const w = columnWidth(measured ?? guessed, cols, gap);
  return (
    <View style={[s.grid, { gap }]} onLayout={(e) => {
      const width = Math.floor(e.nativeEvent.layout.width);
      if (width > 0 && width !== measured) setMeasured(width);
    }}>
      {React.Children.map(children, (ch) =>
        React.isValidElement(ch) ? React.cloneElement(ch as React.ReactElement<{ width?: number }>, { width: w }) : ch)}
    </View>
  );
}

// ── Small parts ─────────────────────────────────────────────────────────

export function Chip({ label, onPress, active = false, testID }: { label: string; onPress?: () => void; active?: boolean; testID?: string }) {
  const Comp: any = onPress ? Pressable : View;
  return (
    <Comp testID={testID} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: active } : undefined}
      style={[s.chip, onPress && s.chipTap, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{label}</Text>
    </Comp>
  );
}

export type BadgeTone = 'green' | 'yellow' | 'red' | 'gray';
const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  green: { bg: '#EAF7EF', fg: '#08764B' }, yellow: { bg: '#FFF1D8', fg: '#8A520B' },
  red: { bg: '#FFEBED', fg: '#B02525' }, gray: { bg: '#EEF1F5', fg: '#516473' },
};
export function Badge({ label, tone = 'green' }: { label: string; tone?: BadgeTone }) {
  const k = BADGE[tone];
  return <View style={[s.badge, { backgroundColor: k.bg }]}><Text style={[s.badgeText, { color: k.fg }]} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{label}</Text></View>;
}

export function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvLabel} maxFontSizeMultiplier={FONT_SCALE_CAP.body}>{label}</Text>
      <Text style={s.kvValue} maxFontSizeMultiplier={FONT_SCALE_CAP.body}>{value}</Text>
    </View>
  );
}

/** The prototype's gold step bar, placed directly under a screen's header. */
export function StepStrip({ step, total, testID = 'step-strip' }: { step: number; total: number; testID?: string }) {
  const size = useSizeClass();
  return (
    <View testID={testID} style={{ paddingHorizontal: size.margin, paddingTop: 12, backgroundColor: c.background }}>
      <ProgressSteps step={step} total={total} />
    </View>
  );
}

export function ProgressSteps({ step, total = 5 }: { step: number; total?: number }) {
  return (
    <View style={s.progress} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 0, max: total, now: step }}>
      {Array.from({ length: total }, (_, i) => <View key={i} style={[s.progressSeg, i < step && s.progressOn]} />)}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  screen: { flex: 1, backgroundColor: c.cream },
  footer: { paddingTop: 10, backgroundColor: c.cream, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 13 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.33)' },
  brandWrap: { flexShrink: 1 },
  brand: { color: '#fff', fontFamily: f.brand, fontSize: 22, letterSpacing: 1.3 },
  tagline: { color: c.headerTagline, fontFamily: f.body, fontSize: 12, marginTop: 1 },
  sos: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 13, borderRadius: 999, backgroundColor: c.sosRed, borderWidth: 1, borderColor: c.sosBorder },
  sosText: { color: '#fff', fontFamily: f.displayBold, fontSize: 13 },

  titleBlock: { marginBottom: 14 },
  eyebrow: { color: c.goldText, fontFamily: f.displayBold, fontSize: t.eyebrow, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  title: { color: c.ink, fontFamily: f.displayBold, letterSpacing: -0.4 },
  sub: { color: c.muted, fontFamily: f.body, fontSize: t.body, lineHeight: 19, marginTop: 6 },

  panel: { borderWidth: 1, borderRadius: theme.radius.lg, padding: 15 },
  panelTitle: { color: c.ink, fontFamily: f.bodyBold, fontSize: t.panelTitle, marginBottom: 8 },
  body: { color: '#50677D', fontFamily: f.body, fontSize: t.body, lineHeight: 19 },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: theme.radius.md, paddingHorizontal: 15, paddingVertical: 12 },
  btnFull: { alignSelf: 'stretch', marginTop: 8 },
  btnOff: { opacity: 0.46 },
  btnText: { fontFamily: f.bodyBold, fontSize: t.button, textAlign: 'center', flexShrink: 1 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 9 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { backgroundColor: c.tileBg, borderWidth: 1, borderColor: c.tileBorder, borderRadius: theme.radius.tile, paddingVertical: 15, paddingHorizontal: 12, minHeight: 104, flexGrow: 1 },
  tileAlert: { backgroundColor: '#FFF0EF', borderColor: c.dangerBorder },
  tileLabel: { color: c.navy, fontFamily: f.displayBold, fontSize: 14, marginTop: 8 },
  tileHint: { color: '#5D6F84', fontFamily: f.body, fontSize: t.small, lineHeight: 16, marginTop: 4 },

  chip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: '#EDF3FD' },
  chipTap: { minHeight: 44, justifyContent: 'center', backgroundColor: c.paper, borderWidth: 1, borderColor: '#D8E0E8', borderRadius: theme.radius.field, paddingHorizontal: 13 },
  chipActive: { backgroundColor: '#E9F1FF', borderColor: '#306AD3', borderWidth: 2, paddingHorizontal: 12 },
  chipText: { color: '#25466F', fontFamily: f.bodySemiBold, fontSize: t.small },
  chipTextActive: { color: '#144AAC' },

  badge: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 30 },
  badgeText: { fontFamily: f.displayBold, fontSize: t.small },

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginVertical: 6 },
  kvLabel: { color: c.muted, fontFamily: f.body, fontSize: t.body, flexShrink: 1 },
  kvValue: { color: c.ink, fontFamily: f.bodyBold, fontSize: t.body, textAlign: 'right', flexShrink: 1 },

  progress: { flexDirection: 'row', gap: 4, marginBottom: 13 },
  progressSeg: { flex: 1, height: 5, borderRadius: 5, backgroundColor: '#DDE6EE' },
  progressOn: { backgroundColor: c.gold },
});
