/**
 * Dhara Legal Aid — Web Portal
 * ─────────────────────────────
 * Responsive chat interface for desktop / tablet browsers.
 * Accessible at /web in the Expo Router.
 *
 * Features:
 *   • SSE streaming from /api/chat/stream
 *   • Language selector: English · Telugu · Kannada
 *   • Verified-source citations with short labels
 *   • New-conversation isolation (UUID pre-generated)
 *   • Responsive max-width centred layout
 *   • Navy & gold Dhara branding
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, Redirect } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { verifiedLabel, isStale, STALE_WARNING_TEXT } from '@/src/citationStaleness';

// ─── Types ────────────────────────────────────────────────────────────────────

type Citation = {
  key: string;
  short_label: string;
  citation: string;
  official_text: string;
  verified_at: string;
  source_url: string;
};

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'en', name: 'English',  native: 'English' },
  { code: 'te', name: 'Telugu',   native: 'తెలుగు'  },
  { code: 'kn', name: 'Kannada',  native: 'ಕನ್ನಡ'   },
];

const QUICK_QUERIES = [
  { text: 'My cheque bounced — what is the notice deadline?',  icon: 'receipt-outline' as const },
  { text: 'What are my rights during a police stop?',          icon: 'shield-half-outline' as const },
  { text: 'How do I file an RTI application?',                 icon: 'eye-outline' as const },
  { text: 'Escalation path for a domestic violence case',      icon: 'home-outline' as const },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

// ─── Component ────────────────────────────────────────────────────────────────

export default function WebPortal() {
  const { token, loading } = useAuth();

  const [messages, setMessages]   = useState<Msg[]>([]);
  const [input,    setInput]      = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [langCode,  setLangCode]  = useState('en');
  const [error,     setError]     = useState<string | null>(null);

  const scrollRef   = useRef<ScrollView>(null);
  const convKeyRef  = useRef(0);

  const selectedLang = LANGUAGES.find((l) => l.code === langCode) ?? LANGUAGES[0];

  // ── Send / Stream ────────────────────────────────────────────────────────────

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || streaming || !token) return;

      setError(null);
      const userId      = generateId();
      const assistantId = generateId();

      setMessages((prev) => [
        ...prev,
        { id: userId,      role: 'user',      content: q },
        { id: assistantId, role: 'assistant', content: '' },
      ]);
      setInput('');
      setStreaming(true);

      const capturedConvKey = convKeyRef.current;

      try {
        const res = await fetch(`${API_BASE}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message:         q,
            session_id:      sessionId,
            language:        selectedLang.code,
            language_name:   selectedLang.name,
            language_native: selectedLang.native,
            mode:            'basic',
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: err?.detail ?? 'Something went wrong. Please try again.' }
                : m,
            ),
          );
          return;
        }

        const reader  = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) return;

        let buffer    = '';
        let acc       = '';
        const citations: Citation[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            let payload: any;
            try { payload = JSON.parse(jsonStr); } catch { continue; }
            if (!payload?.type) continue;

            switch (payload.type) {
              case 'session':
                if (payload.session_id && capturedConvKey === convKeyRef.current) {
                  setSessionId(payload.session_id);
                }
                break;

              case 'citation':
                if (payload.citation) citations.push(payload.citation as Citation);
                break;

              case 'delta':
                acc += payload.text ?? '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: acc, citations: [...citations] }
                      : m,
                  ),
                );
                break;

              case 'final':
                if (payload.text) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: payload.text, citations: [...citations] }
                        : m,
                    ),
                  );
                }
                break;

              case 'error':
                setError(payload.message ?? 'An error occurred.');
                break;
            }
          }
        }
      } catch (e: any) {
        setError(e?.message ?? 'Network error. Please check your connection.');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: 'Could not load a response.' } : m,
          ),
        );
      } finally {
        setStreaming(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      }
    },
    [streaming, token, sessionId, selectedLang],
  );

  // ── New Conversation ─────────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    convKeyRef.current += 1;
    setMessages([]);
    setSessionId(generateId());
    setInput('');
    setError(null);
  }, []);

  // ── Don't render until auth resolves ────────────────────────────────────────

  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <View style={styles.topbar}>
        <View style={styles.topbarInner}>
          {/* Brand */}
          <View style={styles.brand}>
            <Image
              source={require('../assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.brandName}>Dhara</Text>
              <Text style={styles.brandSub}>Legal Aid</Text>
            </View>
          </View>

          {/* Language chips */}
          <View style={styles.langRow}>
            {LANGUAGES.map((l) => (
              <Pressable
                key={l.code}
                testID={`lang-${l.code}`}
                style={[styles.langChip, langCode === l.code && styles.langChipActive]}
                onPress={() => setLangCode(l.code)}
              >
                <Text
                  style={[styles.langChipText, langCode === l.code && styles.langChipTextActive]}
                >
                  {l.native}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* New chat */}
          <Pressable style={styles.newBtn} onPress={startNewChat} testID="new-chat-btn">
            <Ionicons name="add-circle-outline" size={15} color={theme.dhara.gold} />
            <Text style={styles.newBtnText}>New</Text>
          </Pressable>

          {/* Back to app */}
          <Link href="/(tabs)" asChild>
            <Pressable style={styles.appBtn}>
              <Ionicons name="phone-portrait-outline" size={15} color={theme.dhara.textOnNavyMuted} />
              <Text style={styles.appBtnText}>App</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <View style={styles.content}>
        <View style={styles.inner}>

          {/* Error banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.error} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => setError(null)}>
                <Ionicons name="close" size={16} color={theme.colors.error} />
              </Pressable>
            </View>
          )}

          {/* Messages / Empty state */}
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              messages.length === 0 && styles.scrollEmpty,
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Empty state */}
            {messages.length === 0 && (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="scale-outline" size={36} color={theme.dhara.navy} />
                </View>
                <Text style={styles.emptyTitle}>Ask anything about Indian law</Text>
                <Text style={styles.emptySubtitle}>
                  Answers grounded in verified statutes — IPC · BNSS · RTI Act · Consumer
                  Protection Act · and more.
                </Text>
                <View style={styles.quickGrid}>
                  {QUICK_QUERIES.map((q) => (
                    <Pressable
                      key={q.text}
                      style={styles.quickCard}
                      onPress={() => send(q.text)}
                      testID={`quick-${q.icon}`}
                    >
                      <Ionicons name={q.icon} size={18} color={theme.dhara.navy} style={{ marginBottom: 6 }} />
                      <Text style={styles.quickText}>{q.text}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Message bubbles */}
            {messages.map((m) => (
              <View
                key={m.id}
                style={[
                  styles.msgRow,
                  m.role === 'user' ? styles.msgRowUser : styles.msgRowAI,
                ]}
              >
                {/* AI avatar */}
                {m.role === 'assistant' && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>ध</Text>
                  </View>
                )}

                {/* Bubble */}
                <View
                  style={[
                    styles.bubble,
                    m.role === 'user' ? styles.bubbleUser : styles.bubbleAI,
                  ]}
                >
                  {/* Content */}
                  {m.content ? (
                    <Text style={[styles.bubbleText, m.role === 'user' && styles.bubbleTextUser]}>
                      {m.content}
                    </Text>
                  ) : (
                    m.role === 'assistant' && streaming && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator size="small" color={theme.dhara.navy} />
                        <Text style={styles.thinkingText}>Dhara is thinking…</Text>
                      </View>
                    )
                  )}

                  {/* Citations */}
                  {m.citations && m.citations.length > 0 && (
                    <View style={styles.citWrap}>
                      <View style={styles.citHeader}>
                        <Ionicons name="library-outline" size={11} color={theme.colors.brand} />
                        <Text style={styles.citHeaderText}>Sources</Text>
                      </View>
                      {m.citations.map((c) => (
                        <View key={c.key} style={styles.citCard}>
                          <View style={styles.citTop}>
                            <View style={styles.citChip}>
                              <Text style={styles.citChipText}>{c.short_label}</Text>
                            </View>
                            <Text style={styles.citDate}>{verifiedLabel(c.verified_at)}</Text>
                          </View>
                          {isStale(c.verified_at) && (
                            <View style={styles.citStaleRow}>
                              <Ionicons name="time-outline" size={12} color={theme.colors.warning} />
                              <Text style={styles.citStaleText}>{STALE_WARNING_TEXT}</Text>
                            </View>
                          )}
                          <Text style={styles.citTitle}>{c.citation}</Text>
                          <Text style={styles.citBody} numberOfLines={5}>
                            {c.official_text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>

          {/* ── Input bar ──────────────────────────────────────────────────── */}
          <View style={styles.inputWrap}>
            <View style={styles.inputRow}>
              <TextInput
                testID="web-input"
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={`Ask in ${selectedLang.native} — type your legal question…`}
                placeholderTextColor={theme.colors.onSurfaceSecondary}
                multiline
                maxLength={800}
                editable={!streaming}
                onKeyPress={(e: any) => {
                  // Submit on Enter (desktop), allow Shift+Enter for newline
                  if (
                    Platform.OS === 'web' &&
                    e.nativeEvent.key === 'Enter' &&
                    !e.nativeEvent.shiftKey
                  ) {
                    e.preventDefault?.();
                    send(input);
                  }
                }}
              />
              <Pressable
                testID="web-send-btn"
                style={[
                  styles.sendBtn,
                  (!input.trim() || streaming) && styles.sendBtnDisabled,
                ]}
                onPress={() => send(input)}
                disabled={!input.trim() || streaming}
              >
                {streaming ? (
                  <ActivityIndicator size="small" color={theme.dhara.textOnNavy} />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={theme.dhara.textOnNavy} />
                )}
              </Pressable>
            </View>
            <Text style={styles.disclaimer}>
              Dhara provides legal information only, not legal advice. Consult a licensed advocate
              for your specific situation.
            </Text>
          </View>

        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet;

const styles = S.create({
  safe: {
    flex: 1,
    backgroundColor: theme.dhara.navy,
  },

  // ── Topbar ─────────────────────────────────────────────────────────────────

  topbar: {
    backgroundColor: theme.dhara.navy,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(211,182,117,0.25)',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  topbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
    gap: theme.spacing.md,
    flexWrap: 'wrap',
  },

  // Brand
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flex: 1,
  },
  logo: {
    width: 36,
    height: 36,
    aspectRatio: 1,
    borderRadius: 8,
  },
  brandName: {
    fontFamily: theme.fonts.display,
    fontSize: 20,
    fontWeight: '700',
    color: theme.dhara.textOnNavy,
    letterSpacing: 0.3,
  },
  brandSub: {
    fontSize: 11,
    color: theme.dhara.gold,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Language chips
  langRow: {
    flexDirection: 'row',
    gap: 6,
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(211,182,117,0.4)',
    backgroundColor: 'transparent',
  },
  langChipActive: {
    backgroundColor: theme.dhara.gold,
    borderColor: theme.dhara.gold,
  },
  langChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.dhara.gold,
  },
  langChipTextActive: {
    color: theme.dhara.navy,
  },

  // New chat button
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(211,182,117,0.4)',
  },
  newBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.dhara.gold,
  },

  // App link
  appBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  appBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.dhara.textOnNavyMuted,
  },

  // ── Main content area ───────────────────────────────────────────────────────

  content: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  inner: {
    flex: 1,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.error,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
  },
  errorText: {
    flex: 1,
    color: theme.colors.error,
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Scroll / Messages ───────────────────────────────────────────────────────

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  scrollEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xxl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.dhara.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.lg,
    // Web shadow
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(20,54,90,0.10)' } as any,
    }),
  },
  emptyTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.dhara.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: theme.dhara.textSecondary,
    textAlign: 'center',
    maxWidth: 460,
    lineHeight: 22,
    marginBottom: theme.spacing.xxl,
  },

  // Quick query grid
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    maxWidth: 720,
    width: '100%',
  },
  quickCard: {
    width: 168,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    ...Platform.select({
      web: { boxShadow: '0 1px 6px rgba(20,54,90,0.07)', cursor: 'pointer' } as any,
    }),
  },
  quickText: {
    fontSize: 13,
    color: theme.dhara.textPrimary,
    lineHeight: 18,
    fontWeight: '500',
  },

  // ── Message rows ────────────────────────────────────────────────────────────

  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  msgRowUser: {
    justifyContent: 'flex-end',
  },
  msgRowAI: {
    justifyContent: 'flex-start',
  },

  // Avatar
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.dhara.navy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  avatarText: {
    color: theme.dhara.gold,
    fontSize: 15,
    fontWeight: '800',
  },

  // Bubble
  bubble: {
    maxWidth: '76%',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  bubbleUser: {
    backgroundColor: theme.dhara.navy,
    borderBottomRightRadius: 4,
  },
  bubbleAI: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 6px rgba(20,54,90,0.06)' } as any,
    }),
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 23,
    color: theme.dhara.textPrimary,
  },
  bubbleTextUser: {
    color: theme.dhara.textOnNavy,
  },
  thinkingText: {
    fontSize: 13,
    color: theme.dhara.textSecondary,
    fontStyle: 'italic',
  },

  // ── Citations ────────────────────────────────────────────────────────────────

  citWrap: {
    marginTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  citHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  citHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.brand,
    letterSpacing: 0.5,
  },
  citCard: {
    borderWidth: 1,
    borderColor: theme.colors.brandSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    backgroundColor: '#FFFBEC',
    gap: 6,
  },
  citTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  citChip: {
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  citChipText: {
    color: theme.colors.onBrandPrimary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  citDate: {
    fontSize: 10,
    color: theme.colors.onSurfaceSecondary,
  },
  citStaleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  citStaleText: { fontSize: 10, color: theme.colors.warning, fontWeight: '600' },
  citTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.dhara.textPrimary,
  },
  citBody: {
    fontSize: 12,
    color: theme.dhara.textSecondary,
    lineHeight: 18,
  },

  // ── Input bar ────────────────────────────────────────────────────────────────

  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    ...Platform.select({
      web: {
        boxShadow: '0 0 0 3px rgba(18,50,140,0)',
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      } as any,
    }),
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.onSurface,
    minHeight: 24,
    maxHeight: 120,
    lineHeight: 22,
    outlineStyle: 'none' as any,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.dhara.navy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  sendBtnDisabled: {
    backgroundColor: theme.colors.borderStrong,
    ...Platform.select({
      web: { cursor: 'not-allowed' } as any,
    }),
  },
  disclaimer: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
