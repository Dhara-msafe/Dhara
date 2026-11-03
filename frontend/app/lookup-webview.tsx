import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

import { openExternal } from '@/src/outbound';
const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

const INJECT = `
  (function() {
    var s = document.createElement('style');
    s.innerHTML = 'header,nav,.navbar,.nav,#header,.top-nav,footer,#footer,.footer,.breadcrumb{display:none!important;}body{padding-top:8px!important;}.case-details-table{font-size:14px!important;}';
    document.head.appendChild(s);
    var obs = new MutationObserver(function() {
      var r = document.querySelector('.case-list,#divCaseList,.search-result');
      if (r) r.scrollIntoView({ behavior: 'smooth' });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  })();
  true;
`;

export default function LookupWebView() {
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const decodedUrl = decodeURIComponent(url ?? '');
  const [loading, setLoading] = useState(true);
  const webRef = useRef<WebView>(null);

  if (!decodedUrl) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.btn}>
            <Ionicons name="arrow-back-outline" size={22} color={GOLD} />
          </TouchableOpacity>
          <Text style={s.title}>eCourt Lookup</Text>
        </View>
        <View style={s.center}>
          <Text style={{ color: '#374151' }}>No URL provided.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.btn}>
          <Ionicons name="arrow-back-outline" size={22} color={GOLD} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{title || 'eCourt Lookup'}</Text>
        <TouchableOpacity onPress={() => openExternal(decodedUrl)} style={s.btn}>
          <Ionicons name="open-outline" size={20} color={GOLD} />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={s.loadingBar}>
          <ActivityIndicator color={GOLD} size="small" />
          <Text style={s.loadingText}>Loading case data…</Text>
        </View>
      )}

      <WebView
        ref={webRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1 }}
        startInLoadingState={false}
        injectedJavaScript={INJECT}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        userAgent="Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36"
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: NAVY,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e4d7a',
  },
  btn:   { padding: 6 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginHorizontal: 8 },
  loadingBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8F6F0', paddingHorizontal: 16, paddingVertical: 8 },
  loadingText: { color: NAVY, fontSize: 13 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
