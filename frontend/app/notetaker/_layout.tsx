import { Stack } from 'expo-router';
import { theme } from '@/src/theme';

export default function NotetakerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
