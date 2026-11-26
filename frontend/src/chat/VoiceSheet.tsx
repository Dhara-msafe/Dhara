/**
 * Voice pop-up for Ask DHARA (redesign v3, stage 8).
 *
 * Replaces the red recording bar. Tap the mic once and this sheet rises over
 * a dimmed screen: a gold mic with rings that follow the voice, "Listening…",
 * a timer, and Cancel / Done. After Done it shows "Understanding what you
 * said…" until the speech has been turned into text, then closes.
 *
 * Ways out while listening (all discard the recording):
 *   - the back arrow at the top left of the sheet,
 *   - the Cancel button,
 *   - the phone's own Back button or gesture.
 * Tapping the dimmed area does nothing on purpose: a stray touch must not
 * throw away what someone has just said.
 *
 * Motion: the rings only scale and fade, on the native driver, so they keep
 * moving while the app is busy. With "reduce motion" on, they hold still.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const c = theme.colors;
const f = theme.fonts;
const NATIVE = Platform.OS !== 'web';

/** dBFS from the recorder (about -60 quiet … 0 loud) → 0…1. */
export function levelFromDb(db: number | null | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  const v = (db + 55) / 45; // -55 dB → 0, -10 dB → 1
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Ease the shared level value toward a new reading, so the rings glide. */
export function driveVoiceLevel(level: Animated.Value, db: number | null | undefined): void {
  Animated.timing(level, {
    toValue: levelFromDb(db), duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE,
  }).start();
}

export type VoiceSheetPhase = 'listening' | 'understanding';

export function VoiceSheet({
  visible, phase, elapsedSeconds, level, languageName, onDone, onCancel,
}: {
  visible: boolean;
  phase: VoiceSheetPhase;
  elapsedSeconds: number;
  /** 0…1, driven by driveVoiceLevel. */
  level: Animated.Value;
  languageName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const idle = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const listening = phase === 'listening';

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // A slow, calm pulse underneath the voice level, so the mic never looks dead
  // in a quiet moment (and on web, where there is no loudness reading).
  useEffect(() => {
    if (!visible || !listening || reduceMotion) { idle.stopAnimation(); idle.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(idle, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(idle, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible, listening, reduceMotion, idle]);

  useEffect(() => {
    if (!visible) { rise.setValue(0); return; }
    Animated.timing(rise, { toValue: 1, duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [visible, reduceMotion, rise]);

  // Each ring: its own share of the voice level plus the idle pulse.
  const rings = useMemo(() => [0.30, 0.22, 0.14].map((gain) => Animated.add(
    Animated.add(new Animated.Value(0.86), Animated.multiply(level, gain)),
    Animated.multiply(idle, 0.05),
  )), [level, idle]);

  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const ss = String(elapsedSeconds % 60).padStart(2, '0');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // The phone's Back button or gesture: leave without sending.
      onRequestClose={() => { if (listening) onCancel(); }}
    >
      <View style={s.scrim} testID="voice-sheet-scrim">
        <Animated.View
          testID="voice-sheet"
          accessibilityViewIsModal
          // 27 Nov: the sheet is always fully solid — it only slides up. It
          // used to fade in too, and a fade caught part-way let the Ask
          // screen show through it, so it read as a layer over the old UI.
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 16 }, {
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
          }]}
        >
          <View style={s.topRow}>
            {listening ? (
              <Pressable
                testID="voice-sheet-back"
                accessibilityRole="button"
                accessibilityLabel="Back. Stop without sending"
                hitSlop={8}
                onPress={onCancel}
                style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
              >
                <Ionicons name="chevron-back" size={22} color={c.navy} />
              </Pressable>
            ) : <View style={s.backBtn} />}
            <View style={s.handle} />
            <View style={s.backBtn} />
          </View>

          <View style={s.eyebrowRow}>
            {listening && <View style={s.recDot} />}
            <Text style={s.eyebrow} maxFontSizeMultiplier={1.15}>
              {listening ? `Recording in ${languageName}` : 'Got it'}
            </Text>
          </View>

          <View style={s.stage}>
            {listening ? (
              <>
                <Animated.View style={[s.ring, s.ring3, { transform: [{ scale: rings[0] }] }]} />
                <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: rings[1] }] }]} />
                <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: rings[2] }] }]} />
              </>
            ) : (
              <View style={[s.ring, s.ring1, { backgroundColor: c.goldLight }]} />
            )}
            <View style={s.core}>
              {listening
                ? <Ionicons name="mic" size={38} color={c.navy} />
                : <ActivityIndicator color={c.navy} />}
            </View>
          </View>

          <Text style={s.title} accessibilityLiveRegion="polite" accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            {listening ? 'Listening…' : 'Understanding what you said…'}
          </Text>
          <Text style={s.sub} maxFontSizeMultiplier={1.3}>
            {listening ? 'Speak naturally. Tap Done when you finish.' : 'Turning your voice into text. This takes a moment.'}
          </Text>

          {listening && (
            <Text style={s.timer} testID="voice-sheet-timer" accessibilityLabel={`${elapsedSeconds} seconds recorded`} maxFontSizeMultiplier={1.15}>
              {mm}:{ss}
            </Text>
          )}

          {listening && (
            <View style={s.actions}>
              <Pressable
                testID="voice-sheet-cancel"
                accessibilityRole="button"
                accessibilityLabel="Cancel. Stop without sending"
                onPress={onCancel}
                style={({ pressed }) => [s.btn, s.btnCancel, pressed && s.pressed]}
              >
                <Text style={[s.btnText, { color: c.navy }]} maxFontSizeMultiplier={1.15}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="voice-sheet-done"
                accessibilityRole="button"
                accessibilityLabel="Done. Send what I said"
                onPress={onDone}
                style={({ pressed }) => [s.btn, s.btnDone, pressed && s.pressed]}
              >
                <Text style={[s.btnText, { color: '#FFFFFF' }]} maxFontSizeMultiplier={1.15}>Done</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(6,26,48,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.background, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 8, alignItems: 'center',
  },
  topRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 4, borderRadius: 4, backgroundColor: c.lines },
  pressed: { opacity: 0.7 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.emergencyRed },
  eyebrow: { fontFamily: f.bodyBold, fontSize: 12, letterSpacing: 1, color: c.goldText, textTransform: 'uppercase' },
  stage: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ring: { position: 'absolute', borderRadius: 999 },
  ring3: { width: 220, height: 220, backgroundColor: c.goldLight },
  ring2: { width: 168, height: 168, backgroundColor: '#FBDF9F' },
  ring1: { width: 124, height: 124, backgroundColor: '#F1C868' },
  core: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: f.displayBold, fontSize: 22, lineHeight: 27, color: c.ink, textAlign: 'center', marginTop: 8 },
  sub: { fontFamily: f.body, fontSize: 13, lineHeight: 19, color: c.muted, textAlign: 'center', marginTop: 4 },
  timer: { fontFamily: f.bodyBold, fontSize: 28, color: c.navy, fontVariant: ['tabular-nums'], marginTop: 12 },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnCancel: { flex: 1, backgroundColor: c.paper, borderWidth: 1, borderColor: c.outlineBorder },
  btnDone: { flex: 2, backgroundColor: c.navy },
  btnText: { fontFamily: f.bodyBold, fontSize: 14 },
});
