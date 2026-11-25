import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { t } from '@/src/i18n';

/**
 * Non-dismissible legal disclaimer banner — localized.
 * Rendered below the tab bar, inside the layout's bottom safe area.
 */
export const DISCLAIMER_TEXT =
  'DHARA provides legal information, not legal advice. This does not create an advocate-client relationship. Verify with a qualified advocate before acting. © Callistus Moses · MSafe Solutions.';

export function DisclaimerBanner({ testID = 'global-disclaimer' }: { testID?: string }) {
  const { language } = useAuth();
  const text = t('disclaimer', language.code);
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name="shield-half" size={14} color={theme.colors.brand} style={{ marginTop: 1 }} />
      <Text style={styles.text} numberOfLines={4}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  text: {
    flex: 1,
    color: theme.dhara.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter',
    opacity: 0.8,
  },
});
