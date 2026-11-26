/**
 * FirSectionDrawer — Issue 9
 * Slide-in right drawer showing suggested & dropped BNS sections.
 * Used in both fir-draft/index.tsx (with jump) and fir-draft/result.tsx.
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
// NF-UI-REV-11 (Group I follow-up, DHARA UI Revision v2.2.1): presentation-
// only rollback flag + visible keyboard-focus ring + missing a11y labels.
// No section-suggestion/drop logic changes. Shared by fir-draft/index.tsx
// and fir-draft/result.tsx.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(320, SCREEN_WIDTH * 0.82);

const NAVY   = theme.colors.primary;
const GOLD   = theme.colors.gold;
const CREAM  = theme.colors.surfaceSecondary;
const SURFACE = '#FFFAF2';
const MUTED  = '#4A5A6E';
const BORDER = '#E6DFD1';
const RED    = '#C73236';
const GREEN  = '#087951';

export interface SectionItem {
  section_number: string;
  section_heading: string;
  section_text?: string;
}

export interface DroppedSection {
  section_number: string;
  reason_dropped: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  suggestedSections: SectionItem[];
  droppedSections: DroppedSection[];
  /** Optional: called when user taps "Jump ↑" — scroll to the section message in chat */
  onJump?: () => void;
}

export default function FirSectionDrawer({
  visible, onClose, suggestedSections, droppedSections, onJump,
}: Props) {
  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: DRAWER_WIDTH,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  if (!visible) return null;

  const hasSections = suggestedSections.length > 0;
  const hasDropped = droppedSections.length > 0;

  return (
    <>
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close BNS sections panel" />

      {/* Drawer panel */}
      <Animated.View style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
        {/* Header */}
        <View style={styles.drawerHeader}>
          <View style={styles.drawerHeaderLeft}>
            <Ionicons name="list-outline" size={20} color={NAVY} style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>BNS Sections</Text>
          </View>
          <Pressable onPress={onClose} style={(s) => [styles.closeBtn, focusRingStyle(s)]} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={MUTED} />
          </Pressable>
        </View>

        <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>
          {/* Suggested sections */}
          {hasSections && (
            <View style={styles.sectionGroup}>
              <View style={styles.groupHeader}>
                <View style={[styles.groupDot, { backgroundColor: GREEN }]} />
                <Text style={styles.groupLabel}>Suggested ({suggestedSections.length})</Text>
                {onJump && (
                  <Pressable style={(s) => [styles.jumpAllBtn, focusRingStyle(s)]} onPress={() => { onJump(); onClose(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Jump to chat">
                    <Ionicons name="arrow-up-circle-outline" size={14} color={GOLD} />
                    <Text style={styles.jumpAllText}>Jump to chat</Text>
                  </Pressable>
                )}
              </View>
              {suggestedSections.map((s) => (
                <View key={s.section_number} style={styles.sectionCard}>
                  <View style={styles.sectionCardTop}>
                    <View style={styles.sectionBadge}>
                      <Text style={styles.sectionBadgeText}>BNS {s.section_number}</Text>
                    </View>
                    {onJump && (
                      <Pressable
                        style={(st) => [styles.jumpBtn, focusRingStyle(st)]}
                        onPress={() => { onJump(); onClose(); }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Jump to BNS ${s.section_number} in chat`}
                      >
                        <Ionicons name="arrow-up-outline" size={13} color={GOLD} />
                        <Text style={styles.jumpBtnText}>Jump ↑</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.sectionHeading}>{s.section_heading}</Text>
                  {s.section_text ? (
                    <Text style={styles.sectionText} numberOfLines={3}>{s.section_text}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* Dropped sections */}
          {hasDropped && (
            <View style={[styles.sectionGroup, { marginTop: hasSections ? 16 : 0 }]}>
              <View style={styles.groupHeader}>
                <View style={[styles.groupDot, { backgroundColor: RED }]} />
                <Text style={styles.groupLabel}>Not applicable ({droppedSections.length})</Text>
              </View>
              {droppedSections.map((s) => (
                <View key={s.section_number} style={[styles.sectionCard, styles.droppedCard]}>
                  <View style={styles.sectionBadge}>
                    <Text style={[styles.sectionBadgeText, { color: MUTED }]}>BNS {s.section_number}</Text>
                  </View>
                  <Text style={styles.droppedReason}>{s.reason_dropped}</Text>
                </View>
              ))}
            </View>
          )}

          {!hasSections && !hasDropped && (
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={36} color={BORDER} />
              <Text style={styles.emptyText}>
                {'Sections will appear here after your\nincident details are processed.'}
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Disclaimer */}
        <View style={styles.drawerFooter}>
          <Ionicons name="information-circle-outline" size={13} color={MUTED} />
          <Text style={styles.footerText}>
            Sections are indicative only — the investigating officer determines final sections.
          </Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: SURFACE,
    zIndex: 101,
    shadowColor: '#000',
    shadowOffset: { width: -3, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 12,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CREAM,
  },
  drawerHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  drawerTitle: { fontSize: 14, fontFamily: 'InterBold', color: NAVY },
  closeBtn: { padding: 4 },
  drawerScroll: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  sectionGroup: { marginBottom: 8 },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
  },
  groupDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  groupLabel: { fontSize: 12, fontFamily: 'InterSemiBold', color: MUTED, flex: 1 },
  jumpAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: CREAM, borderRadius: 10,
    borderWidth: 1, borderColor: GOLD,
  },
  jumpAllText: { fontSize: 12, color: GOLD, fontFamily: 'InterSemiBold'},
  sectionCard: {
    backgroundColor: CREAM,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  droppedCard: { backgroundColor: '#FFF0F0', borderColor: '#EFC7C7', opacity: 0.8 },
  sectionCardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
  },
  sectionBadge: {
    backgroundColor: NAVY, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  sectionBadgeText: { fontSize: 12, fontFamily: 'InterBold', color: '#fff', letterSpacing: 0.3 },
  sectionHeading: { fontSize: 12, fontFamily: 'InterSemiBold', color: NAVY, lineHeight: 16 },
  sectionText: { fontFamily: 'Inter', fontSize: 12, color: MUTED, lineHeight: 16, marginTop: 4 },
  jumpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FFF4E6', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: GOLD,
  },
  jumpBtnText: { fontSize: 12, color: GOLD, fontFamily: 'InterSemiBold'},
  droppedReason: { fontFamily: 'Inter', fontSize: 12, color: '#C73236', marginTop: 4, lineHeight: 15 },
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 },
  emptyText: {
    fontFamily: 'Inter', fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 12, lineHeight: 18,
  },
  drawerFooter: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
    backgroundColor: CREAM,
  },
  footerText: { fontFamily: 'Inter', fontSize: 11, color: MUTED, lineHeight: 14, flex: 1 },
});
