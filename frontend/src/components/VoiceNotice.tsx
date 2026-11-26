import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export function VoiceNotice({ message, onPlay, onDismiss, testID }: {
  message: string;
  onPlay?: () => void;
  onDismiss: () => void;
  testID: string;
}) {
  return (
    <View style={styles.container} testID={testID} accessibilityLiveRegion="polite">
      <Text style={styles.message} testID={`${testID}-message`}>{message}</Text>
      <View style={styles.actions}>
        {onPlay && (
          <Pressable testID={`${testID}-play`} onPress={onPlay} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Ionicons name="volume-medium-outline" size={20} color={theme.colors.brand} />
            <Text style={styles.label}>Play voice</Text>
          </Pressable>
        )}
        <Pressable testID={`${testID}-dismiss`} onPress={onDismiss} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.label}>{onPlay ? 'Use text' : 'Dismiss'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: theme.colors.surfaceSecondary, flexShrink: 0 },
  message: { color: theme.colors.onSurfaceSecondary, fontFamily: 'Inter', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: theme.colors.brand, fontSize: 12, fontFamily: 'InterSemiBold'},
  pressed: { opacity: 0.6 },
});