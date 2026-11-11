/**
 * ConfirmModal — small in-app confirmation dialog for the notetaker module.
 *
 * BATCH N1-B2 / N2: native `Alert.alert`/`window.confirm`-style dialogs are
 * being phased out (full replacement is BATCH N4's `ConfirmModal`). Per the
 * founder's instruction, any NEW confirmation added in N1-B2/N2 must use a
 * real in-app component instead — this is that small version, built to be
 * promoted/reused as the shared ConfirmModal in N4 rather than thrown away.
 *
 * Uses React Native's own <Modal> (works on web, iOS and Android) — never
 * Alert.alert/confirm/crossAlert.
 */
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '@/src/theme';

const c = theme.colors;

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Renders the confirm button in the error colour for destructive actions (withdraw, discard). */
  destructive?: boolean;
  /** Shows a spinner on the confirm button and disables both buttons. */
  loading?: boolean;
  /** Optional extra content rendered between the message and the buttons (e.g. a details list). */
  children?: React.ReactNode;
}

export default function ConfirmModal({
  visible, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  onConfirm, onCancel, destructive = false, loading = false, children,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {children}
          <View style={styles.row}>
            <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelBtnText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmBtn, destructive && styles.confirmBtnDestructive]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.confirmBtnText}>{confirmLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: c.surface, borderRadius: 16, padding: 20, gap: 4 },
  title: { fontFamily: theme.fonts.display, fontSize: 18, color: c.navy, marginBottom: 6 },
  message: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  confirmBtn: { flex: 1, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmBtnDestructive: { backgroundColor: c.error },
  confirmBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: '#fff' },
});
