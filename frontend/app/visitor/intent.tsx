/**
 * Visitor Mode — V2: Intent Router
 * Selects between Emergency and Lost Passport workflows.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { loadVisitorSession, VisitorSession, getStateLocalLang, HINDI_LANG } from '@/src/visitor/session';

import { openExternal } from '@/src/outbound';
const C = theme.colors;

const WORKFLOWS = [
  {
    id: 'emergency',
    icon: 'alert-circle' as const,
    color: C.error,
    bg: '#FEF2F2',
    border: '#FECACA',
    titles: { en: 'Emergency Help', fr: 'Aide d\'urgence', de: 'Notfallhilfe', es: 'Ayuda de emergencia', hi: 'आपातकालीन सहायता' } as Record<string, string>,
    subs:   { en: 'Accident, assault, theft, medical', fr: 'Accident, agression, vol, urgence', de: 'Unfall, Überfall, Diebstahl', es: 'Accidente, asalto, robo, emergencia', hi: 'दुर्घटना, हमला, चोरी, चिकित्सा' } as Record<string, string>,
    route: '/visitor/emergency',
  },
  {
    id: 'lost-passport',
    icon: 'document-outline' as const,
    color: C.primary,
    bg: C.navySoft,
    border: '#BFDBFE',
    titles: { en: 'Lost Passport', fr: 'Passeport perdu', de: 'Reisepass verloren', es: 'Pasaporte perdido', hi: 'पासपोर्ट खो गया' } as Record<string, string>,
    subs:   { en: 'FIR, embassy, FRRO process', fr: 'FIR, ambassade, FRRO', de: 'FIR, Botschaft, FRRO', es: 'FIR, embajada, FRRO', hi: 'FIR, दूतावास, FRRO' } as Record<string, string>,
    route: '/visitor/lost-passport',
  },
  {
    id: 'visa-frro',
    icon: 'calendar-outline' as const,
    color: '#7C3AED',
    bg: '#F5F3FF',
    border: '#DDD6FE',
    titles: { en: 'Visa / FRRO', fr: 'Visa / FRRO', de: 'Visum / FRRO', es: 'Visa / FRRO', hi: 'वीजा / FRRO' } as Record<string, string>,
    subs:   { en: 'Extension, overstay, appointment', fr: 'Extension, dépassement, rendez-vous', de: 'Verlängerung, Überschreitung', es: 'Extensión, exceso de estadía', hi: 'विस्तार, ओवरस्टे, अपॉइंटमेंट' } as Record<string, string>,
    route: '/visitor/visa-frro',
  },
  {
    id: 'cyber-fraud',
    icon: 'shield-outline' as const,
    color: '#D97706',
    bg: '#FFFBEB',
    border: '#FDE68A',
    titles: { en: 'Cyber Fraud', fr: 'Fraude en ligne', de: 'Cyberbetrug', es: 'Fraude cibernético', hi: 'साइबर धोखाधड़ी' } as Record<string, string>,
    subs:   { en: 'Scam, online fraud, helpline 1930', fr: 'Arnaque, fraude en ligne, hotline 1930', de: 'Betrug, Online-Fraud, Hotline 1930', es: 'Estafa, fraude en línea, 1930', hi: 'स्कैम, ऑनलाइन फ्रॉड, हेल्पलाइन 1930' } as Record<string, string>,
    route: '/visitor/cyber-fraud',
  },
  {
    id: 'interpreter',
    icon: 'language-outline' as const,
    color: '#059669',
    bg: '#ECFDF5',
    border: '#A7F3D0',
    titles: { en: 'Two-Way Interpreter', fr: 'Interprète bidirectionnel', de: 'Zwei-Wege-Dolmetscher', es: 'Intérprete bidireccional', hi: 'दो-तरफ़ा दुभाषिया' } as Record<string, string>,
    // DHARA-B021: "{LANG}" is substituted at render time with the tourist's
    // actual state's local language — this used to hard-code "Hindi"/"हिंदी"
    // even for states like Tamil Nadu. See getStateLocalLang() in
    // src/visitor/session.ts (single source of truth, shared with interpreter.tsx).
    subs:   { en: 'Speak ↔ {LANG} in real time', fr: 'Parler ↔ {LANG} en temps réel', de: 'Sprechen ↔ {LANG} in Echtzeit', es: 'Hablar ↔ {LANG} en tiempo real', hi: 'आपकी भाषा ↔ {LANG}' } as Record<string, string>,
    route: '/visitor/interpreter',
  },
];

export default function VisitorIntent() {
  const router = useRouter();
  const [session, setSession] = useState<VisitorSession | null>(null);

  useEffect(() => {
    loadVisitorSession().then(s => setSession(s));
  }, []);

  const lc = session?.touristLang.code || 'en';
  const t = (map: Record<string, string>) => map[lc] || map['en'] || '';
  const localLang = session ? getStateLocalLang(session.indianState) : HINDI_LANG;
  const cardSub = (w: typeof WORKFLOWS[number]) =>
    w.id === 'interpreter' ? t(w.subs).replace('{LANG}', lc === 'hi' ? localLang.native : localLang.label) : t(w.subs);

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.topBadge}>
          <Ionicons name="location-outline" size={14} color={C.primary} />
          <Text style={s.topBadgeText}>{session.indianStateName} · {session.touristLang.native}</Text>
        </View>

        <Text style={s.heading}>How can we help you?</Text>
        <Text style={s.sub}>Choose the situation that best describes your need.</Text>

        <View style={s.workflows}>
          {WORKFLOWS.map(w => (
            <Pressable
              key={w.id}
              style={({ pressed }) => [s.card, { backgroundColor: w.bg, borderColor: w.border }, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(w.route as any)}
            >
              <View style={[s.iconWrap, { backgroundColor: w.color + '22' }]}>
                <Ionicons name={w.icon} size={32} color={w.color} />
              </View>
              <View style={s.cardText}>
                <Text style={[s.cardTitle, { color: w.color }]}>{t(w.titles)}</Text>
                <Text style={s.cardSub}>{cardSub(w)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={w.color} />
            </Pressable>
          ))}
        </View>

        <Text style={s.alwaysNote}>
          ℹ️ In any emergency, call <Text style={{ fontWeight: '800' }}>112</Text> immediately.
        </Text>

        <Pressable style={s.callBtn} testID="visitor-intent-call-112" onPress={() => {
          openExternal('tel:112');
        }}>
          <Ionicons name="call" size={20} color="#fff" />
          <Text style={s.callBtnText}>Call 112 — Emergency</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 },

  topBadge:     {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.navySoft, borderRadius: 20, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 20,
  },
  topBadgeText: { fontSize: 12, color: C.primary, fontWeight: '600' },

  heading: { fontSize: 24, fontWeight: '800', color: C.primary, marginBottom: 6 },
  sub:     { fontSize: 14, color: C.onSurfaceTertiary, marginBottom: 24, lineHeight: 20 },

  workflows: { gap: 14 },
  card:      {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 18, borderWidth: 1.5,
  },
  iconWrap:  { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardText:  { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  cardSub:   { fontSize: 12, color: C.onSurfaceTertiary, lineHeight: 17 },

  alwaysNote: {
    fontSize: 13, color: C.onSurfaceTertiary, textAlign: 'center',
    marginTop: 24, marginBottom: 12, lineHeight: 19,
  },
  callBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: C.error, borderRadius: 14, paddingVertical: 16,
  },
  callBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
