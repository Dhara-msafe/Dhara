/**
 * Redesign v3 parts gallery — test builds only (internal_qa profile).
 *
 * Shows every shared part from src/ui/kit.tsx on one page, laid out as the
 * approved prototype's Home screen followed by the remaining parts, so the
 * design can be checked on any phone size before screens are rebuilt on it.
 * Static: no data is loaded and nothing here calls the server.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { OUTBOUND_PROFILE } from '@/src/outbound';
import {
  AppHeader, Screen, TitleBlock, Panel, Body, Button, ButtonRow, Tile, TileGrid,
  Chip, Badge, KeyValueRow, ProgressSteps,
} from '@/src/ui/kit';
import { useSizeClass } from '@/src/ui/useSizeClass';

export default function UiKitGallery() {
  const size = useSizeClass();
  if (OUTBOUND_PROFILE !== 'internal_qa') return <Redirect href="/" />;
  return (
    <Screen testID="ui-kit" header={<AppHeader showBack={false} />}>
      <TitleBlock greeting eyebrow="Parts gallery · test build" title="Namaste" sub="Your safety. Your people. Your choices." />

      <ButtonRow>
        <Button label="Type" icon="create-outline" variant="outline" />
        <Button label="Scan a notice" icon="camera-outline" variant="outline" />
      </ButtonRow>

      <Panel tone="blue" title="Women’s Shield">
        <Body>Safe journeys, trusted people, evidence, rights and support.</Body>
        <View style={st.gapTop}>
          <TileGrid inset={32}>
            <Tile icon="navigate-outline" label="Head Out" hint="Plan a safe check-in" />
            <Tile icon="people-outline" label="Trusted Circle" hint="Choose your people" />
            <Tile icon="warning-outline" label="Emergency" hint="112 and other options" alert />
            <Tile icon="lock-closed-outline" label="Evidence Locker" hint="Keep records private" />
          </TileGrid>
        </View>
      </Panel>

      <Panel title="Know your rights">
        <Body>Understand next steps from official sources.</Body>
        <Button label="Explore rights and next steps" variant="outline" full />
      </Panel>

      <TitleBlock eyebrow="Step 3 of 5 · Arrival area" title="When should we check?" sub="The arrival radius describes an area near your destination." />
      <ProgressSteps step={3} />
      <View style={st.chips}>
        <Chip label="100 m" onPress={() => {}} />
        <Chip label="200 m" onPress={() => {}} active />
        <Chip label="300 m" onPress={() => {}} />
      </View>

      <Panel title="Your journey">
        <KeyValueRow label="Destination" value="University Hostel" />
        <KeyValueRow label="Arrival area" value="200 metres" />
        <KeyValueRow label="Private check-in" value="Every 10 min" />
        <View style={st.badges}><Badge label="Journey active" /><Badge label="Offline" tone="yellow" /><Badge label="Missed" tone="red" /><Badge label="Draft" tone="gray" /></View>
      </Panel>

      <Panel tone="warn" title="Location is uncertain"><Body>You may check in manually.</Body></Panel>
      <Panel tone="success" title="Near your destination?"><Body>Please confirm when you have arrived.</Body><Button label="I have arrived" variant="green" full /></Panel>
      <Panel tone="danger" title="Emergency help"><Body>If you are in immediate danger, call 112.</Body><Button label="View 112 emergency options" variant="red" icon="call" full /></Panel>

      <Button label="Continue" full />
      <Button label="Save for later" variant="gold" full />
      <ButtonRow>
        <Button label="I’m safe" variant="green" icon="checkmark" />
        <Button label="Need help" variant="softRed" icon="warning-outline" />
      </ButtonRow>
      <Button label="Not available yet" full disabled />

      <Panel title="This phone">
        <KeyValueRow label="Size class" value={`${size.width}${size.short ? ' · short' : ''}`} />
        <KeyValueRow label="Window" value={`${Math.round(size.windowWidth)} × ${Math.round(size.windowHeight)}`} />
        <KeyValueRow label="Side margin" value={String(size.margin)} />
      </Panel>
    </Screen>
  );
}

const st = StyleSheet.create({
  gapTop: { marginTop: 10 },
  chips: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 6 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 },
});
