// W1-J02 (12 Nov 2026): password field label with an (i) icon. Hovering the
// icon (web) or tapping it (phone, where there is no hover) shows the password
// rules, each ticked as the typed password meets it.
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { PASSWORD_RULES } from '@/src/passwordRule';

export function PasswordLabelWithRules({ label, password, labelStyle }: {
  label: string; password: string; labelStyle: StyleProp<TextStyle>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={styles.row}>
        <Text style={labelStyle}>{label}</Text>
        <Pressable
          testID="password-rules-icon"
          accessibilityRole="button"
          accessibilityLabel="Password rules"
          accessibilityState={{ expanded: open }}
          onHoverIn={() => setOpen(true)}
          onHoverOut={() => setOpen(false)}
          onPress={() => setOpen(o => !o)}
          hitSlop={10}
          style={styles.icon}
        >
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>
      </View>
      {open && (
        <View testID="password-rules" style={styles.box} accessibilityLiveRegion="polite">
          <Text style={styles.title}>Your password needs:</Text>
          {PASSWORD_RULES.map(r => {
            const ok = r.test(password);
            return (
              <View key={r.key} style={styles.ruleRow} testID={`password-rule-${r.key}`}>
                <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={16}
                  color={ok ? theme.colors.success : theme.colors.onSurfaceTertiary} />
                <Text style={[styles.rule, ok && styles.ruleOk]}>{r.label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  box: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, gap: 6,
  },
  title: { color: theme.colors.onSurfaceSecondary, fontWeight: '600', fontSize: 13 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  ruleOk: { color: theme.colors.success },
});
