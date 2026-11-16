import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { UI_REVISION_V1 } from '@/src/designRevision';

export default function Index() {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    (async () => {
      if (token) {
        router.replace('/(tabs)/home');
        return;
      }
      // First launch → user picks a language before login
      const savedLang = await AsyncStorage.getItem('gk_lang');
      router.replace(savedLang ? '/login' : '/language');
    })();
  }, [token, loading, router]);

  return (
    <View style={styles.c} testID="splash-screen">
      <Image
        source={require('../assets/images/dhara_icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator color={theme.colors.gold} style={{ marginTop: 32 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  // UI-revision pilot (reversible via UI_REVISION_V1): a fixed 260x260 logo
  // plus 40px horizontal padding needs 340px of width, which overflows a
  // 320-360px-wide phone screen. A percentage width with a max-width cap
  // keeps the same look on wide screens and shrinks correctly on narrow
  // ones; resizeMode="contain" (unchanged) keeps the aspect ratio.
  logo: UI_REVISION_V1
    ? { width: '65%', maxWidth: 260, aspectRatio: 1 }
    : { width: 260, height: 260, resizeMode: 'contain' },
});
