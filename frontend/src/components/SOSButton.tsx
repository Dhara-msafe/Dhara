import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

import { openExternal } from '@/src/outbound';
type Helpline = {
  label: string;
  number: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const HELPLINES: Helpline[] = [
  { label: 'Emergency (All-in-one)', number: '112', icon: 'alert-circle' },
  { label: 'Police', number: '100', icon: 'shield' },
  { label: 'Women Helpline', number: '181', icon: 'woman' },
  { label: 'Child Helpline', number: '1098', icon: 'happy' },
  { label: 'Legal Aid (NALSA)', number: '15100', icon: 'briefcase' },
  { label: 'Ambulance', number: '108', icon: 'medkit' },
];

/**
 * SOS helpline entry point — lives on the Settings tab.
 *
 * variant="floating" renders the big red pill; pass `inline` so it sits inside
 * the Settings row instead of being absolutely positioned (an absolutely
 * positioned FAB used to cover the chat composer / mic button).
 * variant="chip" is the small header chip.
 */
export function SOSButton({
  variant = 'chip',
  inline = false,
}: { variant?: 'chip' | 'floating'; inline?: boolean }) {
  const [open, setOpen] = useState(false);

  const dial = (number: string) => {
    setOpen(false);
    openExternal(`tel:${number}`).catch(() => {});
  };

  return (
    <>
      {variant === 'floating' ? (
        <Pressable
          testID="sos-button-floating"
          style={[styles.floating, inline && styles.floatingInline]}
          onPress={() => setOpen(true)}
          accessibilityLabel="Emergency helplines"
        >
          <Ionicons name="call" size={16} color="#FFFFFF" />
          <Text style={styles.floatingText}>SOS</Text>
        </Pressable>
      ) : (
        <Pressable testID="sos-button" style={styles.headerChip} onPress={() => setOpen(true)}>
          <Ionicons name="call" size={13} color="#FFFFFF" />
          <Text style={styles.headerChipText}>SOS</Text>
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Ionicons name="call" size={20} color={theme.colors.error} />
              <Text style={styles.sheetTitle}>Emergency Helplines</Text>
              <Pressable testID="sos-close" onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            {HELPLINES.map((h) => (
              <Pressable
                key={h.number}
                testID={`sos-dial-${h.number}`}
                style={styles.row}
                onPress={() => dial(h.number)}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={h.icon} size={20} color={theme.colors.error} />
                </View>
                <Text style={styles.rowLabel}>{h.label}</Text>
                <View style={styles.numberPill}>
                  <Ionicons name="call" size={12} color={theme.colors.onBrandPrimary} />
                  <Text style={styles.numberText}>{h.number}</Text>
                </View>
              </Pressable>
            ))}
            <Text style={styles.note}>Calls go directly to government helplines. Dhara is not an emergency service.</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    right: 0,
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
    paddingRight: 10,
    height: 48,
    minWidth: 64,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    backgroundColor: '#B91C1C',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: -2, height: 2 },
    elevation: 8,
    zIndex: 999,
  },
  floatingText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  floatingInline: {
    position: 'relative',
    right: undefined,
    top: undefined,
    borderRadius: 24,
    paddingHorizontal: 18,
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.error,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  headerChipText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  sheetTitle: { flex: 1, fontFamily: theme.fonts.display, fontSize: 18, fontWeight: '700', color: theme.colors.onSurface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    minHeight: 52,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, color: theme.colors.onSurface, fontSize: 15, fontWeight: '600' },
  numberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.error,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
  },
  numberText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  note: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: theme.spacing.md, textAlign: 'center' },
});
