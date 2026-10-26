/**
 * CalcPro.tsx — Disguise calculator screen
 *
 * Renders a pixel-accurate iOS Calculator clone.  It operates as a fully
 * functional arithmetic calculator so a casual observer sees nothing unusual.
 *
 * UNLOCK: Type the PIN (default "5765") and press "=".
 *   - No operation pending → display shows PIN → onUnlock() fires.
 *   - Any other number + "=" behaves exactly like a normal calculator.
 *
 * PIN can be overridden by the caller (stored externally in SecureStore).
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Default PIN ──────────────────────────────────────────────────────────────
/** Digits the user types before pressing "=" to unlock the real app. */
export const CALC_DEFAULT_PIN = '5765';

// ── Layout constants ─────────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
// 4 buttons per row with equal gaps; 12px outer padding on each side
const OUTER = 12;
const GAP   = 12;
const BTN_W = Math.floor((SCREEN_W - OUTER * 2 - GAP * 3) / 4);
// Keep buttons roughly square — cap at a reasonable height for tall phones
const BTN_H = Math.min(BTN_W, Math.floor((SCREEN_H * 0.65 - GAP * 4) / 5));
// Zero button spans two columns
const BTN_ZERO_W = BTN_W * 2 + GAP;

// ── Colours (iOS Calculator palette) ─────────────────────────────────────────
const C = {
  bg:       '#000000',
  display:  '#FFFFFF',
  num:      '#333333',       // dark grey buttons (digits, dot)
  fn:       '#A5A5A5',       // light grey (AC, +/−, %)
  op:       '#FF9500',       // orange (÷ × − + =)
  opActive: '#FFFFFF',       // inverted when that op is active
  txtNum:   '#FFFFFF',
  txtFn:    '#000000',
  txtOp:    '#FFFFFF',
  txtOpActive: '#FF9500',
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Op = '+' | '−' | '×' | '÷' | null;
type BtnKind = 'fn' | 'op' | 'num' | 'zero';

// ── Arithmetic ────────────────────────────────────────────────────────────────
function compute(a: number, op: Op, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b !== 0 ? a / b : NaN;
    default:  return b;
  }
}

function fmt(n: number): string {
  if (!isFinite(n) || isNaN(n)) return 'Error';
  // Trim floating-point noise then cap at 9 chars
  const s = parseFloat(n.toPrecision(9)).toString();
  return s.length > 10 ? parseFloat(n.toPrecision(6)).toString() : s;
}

// ── Button grid definition ────────────────────────────────────────────────────
type BtnDef = { label: string; kind: BtnKind };
const ROWS: BtnDef[][] = [
  [{ label: 'AC', kind: 'fn' }, { label: '+/-', kind: 'fn' }, { label: '%', kind: 'fn' }, { label: '÷', kind: 'op' }],
  [{ label: '7',  kind: 'num' }, { label: '8', kind: 'num' }, { label: '9', kind: 'num' }, { label: '×', kind: 'op' }],
  [{ label: '4',  kind: 'num' }, { label: '5', kind: 'num' }, { label: '6', kind: 'num' }, { label: '−', kind: 'op' }],
  [{ label: '1',  kind: 'num' }, { label: '2', kind: 'num' }, { label: '3', kind: 'num' }, { label: '+', kind: 'op' }],
  [{ label: '0',  kind: 'zero' }, { label: '.', kind: 'num' }, { label: '=', kind: 'op' }],
];

// ── Component ─────────────────────────────────────────────────────────────────
interface CalcProProps {
  onUnlock: () => void;
  pin?: string;
}

export function CalcPro({ onUnlock, pin = CALC_DEFAULT_PIN }: CalcProProps) {
  const insets = useSafeAreaInsets();

  // ── Calculator state ───────────────────────────────────────────────────────
  const [display,    setDisplay]    = useState('0');
  const [prevVal,    setPrevVal]    = useState<number | null>(null);
  const [pendingOp,  setPendingOp]  = useState<Op>(null);
  const [freshOp,    setFreshOp]    = useState(false); // just pressed an operator
  const [justCalc,   setJustCalc]   = useState(false); // just pressed =
  const [activeOp,   setActiveOp]   = useState<Op>(null); // highlighted operator

  // ── Handlers ───────────────────────────────────────────────────────────────
  const pressDigit = useCallback((d: string) => {
    setActiveOp(null);
    if (freshOp || justCalc || display === '0') {
      setDisplay(d);
      setFreshOp(false);
      setJustCalc(false);
    } else {
      if (display.replace('-', '').replace('.', '').length < 9) {
        setDisplay(prev => prev + d);
      }
    }
  }, [display, freshOp, justCalc]);

  const pressDot = useCallback(() => {
    if (freshOp || justCalc) {
      setDisplay('0.');
      setFreshOp(false);
      setJustCalc(false);
      return;
    }
    if (!display.includes('.')) setDisplay(prev => prev + '.');
  }, [display, freshOp, justCalc]);

  const pressAC = useCallback(() => {
    setDisplay('0');
    setPrevVal(null);
    setPendingOp(null);
    setFreshOp(false);
    setJustCalc(false);
    setActiveOp(null);
  }, []);

  const pressPlusMinus = useCallback(() => {
    setDisplay(prev => fmt(parseFloat(prev) * -1));
  }, []);

  const pressPercent = useCallback(() => {
    setDisplay(prev => fmt(parseFloat(prev) / 100));
  }, []);

  const pressOp = useCallback((nextOp: Op) => {
    const cur = parseFloat(display);
    if (prevVal !== null && pendingOp && !freshOp) {
      const result = compute(prevVal, pendingOp, cur);
      const rs = fmt(result);
      setDisplay(rs);
      setPrevVal(result);
    } else {
      setPrevVal(cur);
    }
    setPendingOp(nextOp);
    setFreshOp(true);
    setJustCalc(false);
    setActiveOp(nextOp);
  }, [display, prevVal, pendingOp, freshOp]);

  const pressEquals = useCallback(() => {
    // ── Unlock check ─────────────────────────────────────────────────────────
    // Unlock if: no pending operation, display exactly matches PIN.
    // To a casual observer this looks like someone typed a number and hit =.
    if (!pendingOp && !freshOp && display === pin) {
      onUnlock();
      return;
    }

    const cur = parseFloat(display);
    if (prevVal !== null && pendingOp) {
      const result = compute(prevVal, pendingOp, cur);
      setDisplay(fmt(result));
      setPrevVal(null);
      setPendingOp(null);
      setFreshOp(false);
      setJustCalc(true);
      setActiveOp(null);
    }
  }, [display, prevVal, pendingOp, freshOp, pin, onUnlock]);

  function handlePress(label: string) {
    switch (label) {
      case 'AC':  return pressAC();
      case '+/-': return pressPlusMinus();
      case '%':   return pressPercent();
      case '÷':   return pressOp('÷');
      case '×':   return pressOp('×');
      case '−':   return pressOp('−');
      case '+':   return pressOp('+');
      case '=':   return pressEquals();
      case '.':   return pressDot();
      default:    return pressDigit(label);
    }
  }

  // ── Button style resolver ─────────────────────────────────────────────────
  function btnBg(kind: BtnKind, label: string): string {
    const isActive = label === activeOp;
    if (kind === 'op')  return isActive ? C.opActive : C.op;
    if (kind === 'fn')  return C.fn;
    return C.num; // 'num' and 'zero'
  }
  function btnTextColor(kind: BtnKind, label: string): string {
    const isActive = label === activeOp;
    if (kind === 'op')  return isActive ? C.txtOpActive : C.txtOp;
    if (kind === 'fn')  return C.txtFn;
    return C.txtNum;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const topPad = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 44,
  );
  const botPad = Math.max(insets.bottom, 20);

  return (
    <View style={[s.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      {/* ── Display ── */}
      <View style={s.displayArea}>
        <Text
          style={s.displayText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.3}
        >
          {display}
        </Text>
      </View>

      {/* ── Button pad ── */}
      <View style={s.pad}>
        {ROWS.map((row, ri) => (
          <View key={ri} style={s.row}>
            {row.map(({ label, kind }) => {
              const isZero = kind === 'zero';
              const bg  = btnBg(kind, label);
              const clr = btnTextColor(kind, label);
              return (
                <TouchableOpacity
                  key={label}
                  activeOpacity={0.75}
                  onPress={() => handlePress(label)}
                  style={[
                    s.btn,
                    { backgroundColor: bg },
                    isZero && s.btnZeroOverride,
                  ]}
                  accessibilityLabel={label}
                >
                  <Text style={[s.btnTxt, { color: clr }, isZero && s.btnTxtZero]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'flex-end',
  },
  displayArea: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    minHeight: BTN_H * 1.4,
  },
  displayText: {
    color: C.display,
    fontSize: Math.min(96, BTN_H * 1.1),
    fontWeight: '200',
    letterSpacing: -2,
    textAlign: 'right',
  },
  pad: {
    paddingHorizontal: OUTER,
    paddingBottom: 4,
    gap: GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  btn: {
    width:        BTN_W,
    height:       BTN_H,
    borderRadius: BTN_H / 2,
    alignItems:   'center',
    justifyContent: 'center',
  },
  btnZeroOverride: {
    width:         BTN_ZERO_W,
    alignItems:    'flex-start',
    paddingLeft:   BTN_W * 0.38,
  },
  btnTxt: {
    fontSize:   Math.min(34, BTN_H * 0.44),
    fontWeight: '400',
  },
  btnTxtZero: {
    // inherits from btnTxt — no override needed
  },
});
