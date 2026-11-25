import { Stack } from 'expo-router';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';

export default function VisitorLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        headerBackTitle: 'Back',
        // Redesign v3: the same navy header as the rest of the app (back,
        // title, SOS 112) instead of the platform's default bar.
        header: ({ options }) => <ScreenHeader title={typeof options.title === 'string' ? options.title : 'Visitor Mode'} />,
      }}
    >
      <Stack.Screen name="index"         options={{ title: 'Visitor Mode' }} />
      <Stack.Screen name="intent"        options={{ title: 'How Can We Help?' }} />
      <Stack.Screen name="emergency"     options={{ title: 'Emergency Help' }} />
      <Stack.Screen name="lost-passport" options={{ title: 'Lost Passport' }} />
      <Stack.Screen name="visa-frro"     options={{ title: 'Visa / FRRO' }} />
      <Stack.Screen name="cyber-fraud"   options={{ title: 'Cyber Fraud' }} />
      <Stack.Screen name="interpreter"   options={{ title: 'Two-Way Interpreter' }} />
    </Stack>
  );
}
