import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../auth';
import { theme } from '../theme';
import type { ConsentCopy } from '../consentCopy';

const colors = theme.colors;

export function ConsentTermsModal({ visible, onClose, copy }: {
  visible: boolean; onClose: () => void; copy: ConsentCopy;
}) {
  const [document, setDocument] = useState<{ text: string; version: string } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    setError(false);
    setDocument(null);
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/legal/terms`, { signal: controller.signal });
        if (!response.ok) throw new Error('Terms unavailable');
        const data = await response.json();
        if (typeof data.text !== 'string' || !data.text.trim() || typeof data.version !== 'string') throw new Error('Empty terms');
        if (active) setDocument(data);
      } catch { if (active) setError(true); }
      finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [visible, attempt]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="consent-terms-modal">
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text testID="consent-terms-title" style={styles.title}>{copy.termsTitle}</Text>
          <Pressable testID="consent-close-terms" accessibilityRole="button" accessibilityLabel={copy.back} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.primary} />
          </Pressable>
        </View>
        <ScrollView testID="consent-terms-scroll" contentContainerStyle={styles.content}>
          <Text testID="consent-terms-language" style={styles.note}>{copy.termsLanguage}</Text>
          {document ? <>
            <Text testID="consent-terms-version" style={styles.version}>v{document.version}</Text>
            <Text testID="consent-terms-text" selectable style={styles.body}>{document.text}</Text>
          </> : error ? <View>
            <Text testID="consent-terms-error" accessibilityRole="alert" style={styles.error}>{copy.termsError}</Text>
            <Pressable testID="consent-terms-retry" accessibilityRole="button" onPress={() => setAttempt(v => v + 1)} style={styles.button}>
              <Text style={styles.buttonText}>{copy.retry}</Text>
            </Pressable>
          </View> : <View testID="consent-terms-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.note}>{copy.loading}</Text>
          </View>}
        </ScrollView>
        <Pressable testID="consent-terms-back" accessibilityRole="button" onPress={onClose} style={[styles.button, styles.footer]}>
          <Text style={styles.buttonText}>{copy.back}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.divider },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.primary },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 32 },
  note: { fontSize: 14, lineHeight: 22, color: colors.onSurfaceSecondary, marginBottom: 16 },
  version: { color: colors.primary, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 26, color: colors.onSurface },
  error: { color: colors.error, lineHeight: 22, fontSize: 16, marginBottom: 16 },
  button: { backgroundColor: colors.primary, minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 14, borderRadius: 12 },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.onBrandPrimary },
  footer: { margin: 16 },
});