/**
 * Chat suggestion chips.
 *
 * The two language-aware getters are the live path; TOPIC_SUGGESTIONS is used
 * when the user arrives from a specific "Know Your Rights" card (?topicId=...).
 */
import type React from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type Suggestion = { text: string; icon: IconName };

/** Suggestion chips — translated per user language. */
export function getBasicSuggestions(langCode: string): Suggestion[] {
  return [
    { text: t('home.suggestion1', langCode), icon: 'receipt-outline' },
    { text: t('home.suggestion2', langCode), icon: 'shield-outline' },
    { text: t('home.suggestion3', langCode), icon: 'car-outline' },
    { text: t('home.suggestion4', langCode), icon: 'shield-checkmark-outline' },
  ];
}

export function getProSuggestions(langCode: string): Suggestion[] {
  return [
    { text: t('home.proSuggestion1', langCode), icon: 'document-text-outline' },
    { text: t('home.proSuggestion2', langCode), icon: 'bag-handle-outline' },
    { text: t('home.proSuggestion3', langCode), icon: 'eye-outline' },
    { text: t('home.proSuggestion4', langCode), icon: 'trending-up-outline' },
  ];
}

/**
 * Contextual suggestion chips shown when the user arrives via a specific
 * "Know Your Rights" card's "Ask Dhara more" button (passes ?topicId=...).
 * Keys match the `id` field in backend/rights_topics_data.py. Without this,
 * every topic card dropped the user onto the same generic 4 chips
 * (cheque-bounce / UPI fraud / helmet) regardless of which card they opened.
 */
export const TOPIC_SUGGESTIONS: Record<string, Suggestion[]> = {
  'police-stop': [
    { text: 'Can police stop and question me without a reason?', icon: 'shield-outline' },
    { text: 'Do I have to show ID during a police stop?', icon: 'card-outline' },
    { text: 'Can I refuse to let police search my vehicle?', icon: 'car-outline' },
    { text: 'What if an officer refuses to show their ID card?', icon: 'alert-circle-outline' },
  ],
  arrest: [
    { text: 'What are my rights if I am arrested?', icon: 'lock-closed-outline' },
    { text: 'Can police arrest me without a warrant?', icon: 'document-text-outline' },
    { text: 'How soon must I be produced before a magistrate?', icon: 'time-outline' },
    { text: 'Can I call a lawyer right after my arrest?', icon: 'call-outline' },
  ],
  fir: [
    { text: 'What if the police refuse to file my FIR?', icon: 'document-text-outline' },
    { text: 'Can I file an FIR online or in another city?', icon: 'globe-outline' },
    { text: 'What is a Zero FIR?', icon: 'help-circle-outline' },
    { text: 'How long does police have to investigate after an FIR?', icon: 'time-outline' },
  ],
  'women-safety': [
    { text: 'Can police force me to visit the station as a woman?', icon: 'heart-outline' },
    { text: 'How do I file a workplace sexual harassment complaint?', icon: 'briefcase-outline' },
    { text: 'What is the POSH Act Internal Committee?', icon: 'shield-checkmark-outline' },
    { text: 'Can my statement be recorded at my home instead?', icon: 'home-outline' },
  ],
  traffic: [
    { text: 'What is the fine for riding without a helmet?', icon: 'car-outline' },
    { text: 'What is the helmet law for a child riding pillion?', icon: 'shield-checkmark-outline' },
    { text: 'Can police seize my vehicle on the spot?', icon: 'alert-circle-outline' },
    { text: 'Do I need to carry original documents while driving?', icon: 'document-text-outline' },
  ],
  rti: [
    { text: 'How do I file an RTI application?', icon: 'eye-outline' },
    { text: 'What is the fee for filing an RTI?', icon: 'cash-outline' },
    { text: 'What if I get no response to my RTI in 30 days?', icon: 'time-outline' },
    { text: 'Draft a first appeal for an unanswered RTI', icon: 'document-text-outline' },
  ],
  consumer: [
    { text: 'I received a defective product — what are my rights?', icon: 'bag-handle-outline' },
    { text: 'How do I file a consumer complaint online?', icon: 'globe-outline' },
    { text: 'What is the time limit to file a consumer case?', icon: 'time-outline' },
    { text: 'Can I get a refund for an undelivered online order?', icon: 'cash-outline' },
  ],
  'domestic-violence': [
    { text: 'How do I get a protection order against domestic violence?', icon: 'shield-checkmark-outline' },
    { text: 'Can I stay in my shared household during a dispute?', icon: 'home-outline' },
    { text: 'How do I contact a Protection Officer in my district?', icon: 'call-outline' },
    { text: 'What is the helpline number for domestic violence?', icon: 'alert-circle-outline' },
  ],
};
