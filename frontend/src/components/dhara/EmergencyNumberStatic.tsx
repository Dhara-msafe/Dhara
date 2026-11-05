/**
 * EmergencyNumberStatic — Batch SAFE-SOS-001.
 *
 * Read-only display for a helpline/emergency number. Renders the number as
 * plain text — NOT a Pressable, NOT a tel: link, and never calls
 * openExternal/openPhone. Used in place of a call button on every screen
 * that previously opened the dialler, until the dialler batch is approved
 * separately after the app is live.
 *
 * Nothing here touches SMS, share, or the outbound policy in src/outbound.ts.
 */
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function EmergencyNumberStatic({
  label,
  number,
  testID,
}: {
  label: string;
  number: string;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID ?? `emergency-static-${number}`}>
      <Ionicons name="call-outline" size={16} color="#9CA3AF" />
      <View style={{ flex: 1 }}>
        <Text style={styles.number}>{number}</Text>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.badge}>Not active</Text>
    </View>
  );
}

/** Exact copy required by Batch SAFE-SOS-001 — do not alter the wording. */
export function EmergencyNotActiveNotice() {
  return (
    <Text style={styles.notice} accessibilityRole="text" testID="emergency-not-active-notice">
      Emergency calling is not active in this test version. Dial 112 on your phone if you need help.
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    opacity: 0.85,
  },
  number: { fontSize: 15, fontWeight: '700', color: '#6B7280' },
  label: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  badge: { fontSize: 10, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.3 },
  notice: { fontSize: 11, color: '#B91C1C', fontStyle: 'italic', marginTop: 6, lineHeight: 15 },
});
