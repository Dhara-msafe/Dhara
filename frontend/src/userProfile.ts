/**
 * User-profile / interest system for DHARA.
 *
 * Stores up to 3 interests in AsyncStorage (key: dhara_user_interests_v1).
 * Each interest drives:
 *  - Home "Try saying" chips
 *  - "For you" horizontal card
 *  - Chat starter suggestion chips
 *  - Rights topic ordering
 *  - Chat empty-state headline
 */
import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/src/utils/storage';

const PROFILE_KEY = 'dhara_user_interests_v1';
export const MAX_INTERESTS = 3;

export type ProfileInterest =
  | 'women'
  | 'cyber'
  | 'police'
  | 'motor'
  | 'consumer'
  | 'rti'
  | 'domestic'
  | 'labor';

export type InterestMeta = {
  key: ProfileInterest;
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
  /** Deep-link route on tap of the For-you card CTA */
  route: string;
  /** Primary rights topic id (backend key) to sort first */
  rightsTopicId: string;
  /** Additional topic ids to promote (after primary) */
  relatedTopicIds: string[];
  /** "Try saying" chips on Home — up to 3 strings */
  homeTryQuestions: string[];
  /** Chat empty-state suggestion chips */
  chatSuggestions: { text: string; icon: string }[];
  /** For-you card data shown in the horizontal home shelf */
  forYouCard: {
    tag: string;
    title: string;
    body: string;
    route: string;
    cta: string;
  };
  /** Chat empty-state headline (replaces generic "Ask any question about your rights") */
  chatHeadline: string;
  /** Chat empty-state subline (replaces generic law-source list) */
  chatSubline: string;
};

export const INTERESTS: InterestMeta[] = [
  {
    key: 'women',
    label: "Women's Rights",
    emoji: '🛡️',
    color: '#D63384',
    bgColor: '#FFF0F7',
    route: '/women-shield',
    rightsTopicId: 'women-safety',
    relatedTopicIds: ['women-safety', 'domestic-violence', 'police-stop', 'fir'],
    homeTryQuestions: [
      '"Police won\'t take my harassment complaint"',
      '"What is the POSH Act and who does it protect?"',
      '"How do I file for a protection order?"',
    ],
    chatSuggestions: [
      { text: 'Can police force me to visit the station as a woman?', icon: 'heart-outline' },
      { text: 'How do I file a workplace sexual harassment complaint?', icon: 'briefcase-outline' },
      { text: 'How to get a protection order against domestic violence?', icon: 'shield-checkmark-outline' },
      { text: 'What is the one-stop crisis centre helpline?', icon: 'call-outline' },
    ],
    forYouCard: {
      tag: "WOMEN'S SAFETY",
      title: "Women's Shield",
      body: 'Safe journey check-in, evidence locker & trusted circle.',
      route: '/women-shield',
      cta: 'Open Shield',
    },
    chatHeadline: "Ask about women's rights",
    chatSubline: 'POSH Act · Domestic Violence · Safety Rights',
  },
  {
    key: 'cyber',
    label: 'Cyber Fraud',
    emoji: '🔐',
    color: '#6366F1',
    bgColor: '#EEF2FF',
    route: '/fraud-checklist',
    rightsTopicId: 'rti',
    relatedTopicIds: ['rti', 'consumer'],
    homeTryQuestions: [
      '"Money gone in a UPI fraud — what now?"',
      '"My OTP was stolen — is my bank liable?"',
      '"How do I report a cyber crime online?"',
    ],
    chatSuggestions: [
      { text: 'Money gone in a UPI fraud — what do I do first?', icon: 'shield-outline' },
      { text: 'My OTP was stolen — is my bank liable?', icon: 'lock-closed-outline' },
      { text: 'How to file a cybercrime complaint on cybercrime.gov.in?', icon: 'globe-outline' },
      { text: 'What is the 1930 helpline for financial fraud?', icon: 'call-outline' },
    ],
    forYouCard: {
      tag: 'CYBER SAFETY',
      title: 'Fraud victim?',
      body: 'Golden-hour checklist — call 1930 and freeze fraudulent transactions.',
      route: '/fraud-checklist',
      cta: 'Start checklist',
    },
    chatHeadline: 'Ask about cyber fraud',
    chatSubline: 'UPI Fraud · Cybercrime · IT Act & RBI Circulars',
  },
  {
    key: 'police',
    label: 'Police & FIR',
    emoji: '📋',
    color: '#1E3A5F',
    bgColor: '#EFF6FF',
    route: '/fir-draft',
    rightsTopicId: 'fir',
    relatedTopicIds: ['fir', 'police-stop', 'arrest'],
    homeTryQuestions: [
      '"Police won\'t write my FIR — what can I do?"',
      '"What is a Zero FIR?"',
      '"I was arrested — what are my rights?"',
    ],
    chatSuggestions: [
      { text: 'What if the police refuse to file my FIR?', icon: 'document-text-outline' },
      { text: 'Can police arrest me without a warrant?', icon: 'lock-closed-outline' },
      { text: 'What is a Zero FIR and where can I file it?', icon: 'help-circle-outline' },
      { text: 'What are my rights during a police stop?', icon: 'shield-outline' },
    ],
    forYouCard: {
      tag: 'POLICE & FIR',
      title: 'Draft your FIR',
      body: 'AI-guided FIR draft in your language — voice or text.',
      route: '/fir-draft',
      cta: 'Start draft',
    },
    chatHeadline: 'Ask about police & FIR',
    chatSubline: 'FIR Rights · Arrest Rights · BNSS Procedures',
  },
  {
    key: 'motor',
    label: 'Motor & Traffic',
    emoji: '🚗',
    color: '#D97706',
    bgColor: '#FFFBEB',
    route: '/(tabs)',
    rightsTopicId: 'traffic',
    relatedTopicIds: ['traffic', 'police-stop'],
    homeTryQuestions: [
      '"What is the fine for riding without a helmet?"',
      '"Can police seize my vehicle on the spot?"',
      '"How do I contest a traffic challan?"',
    ],
    chatSuggestions: [
      { text: 'What is the fine for riding without a helmet?', icon: 'car-outline' },
      { text: 'Can police seize my vehicle on the spot?', icon: 'alert-circle-outline' },
      { text: 'What documents must I carry while driving?', icon: 'document-text-outline' },
      { text: 'What are my rights if I get a traffic challan?', icon: 'receipt-outline' },
    ],
    forYouCard: {
      tag: 'TRAFFIC RIGHTS',
      title: 'Traffic challans & rights',
      body: 'Know your rights before you pay — or contest — any challan.',
      route: '/(tabs)',
      cta: 'Ask Dhara',
    },
    chatHeadline: 'Ask about motor & traffic',
    chatSubline: 'Challans · Vehicle Rights · Motor Vehicle Act',
  },
  {
    key: 'consumer',
    label: 'Consumer Rights',
    emoji: '🛒',
    color: '#059669',
    bgColor: '#ECFDF5',
    route: '/all-help',
    rightsTopicId: 'consumer',
    relatedTopicIds: ['consumer', 'rti'],
    homeTryQuestions: [
      '"E-commerce won\'t refund me — what can I do?"',
      '"I received a defective product — my rights?"',
      '"How do I file a consumer complaint?"',
    ],
    chatSuggestions: [
      { text: 'I received a defective product — what are my rights?', icon: 'bag-handle-outline' },
      { text: 'How do I file a consumer complaint online?', icon: 'globe-outline' },
      { text: "E-commerce won't give a refund — steps?", icon: 'cash-outline' },
      { text: 'What is the time limit to file a consumer case?', icon: 'time-outline' },
    ],
    forYouCard: {
      tag: 'CONSUMER',
      title: 'Protect your purchase',
      body: 'Consumer Protection Act 2019 — file a complaint online.',
      route: '/all-help',
      cta: 'Get help',
    },
    chatHeadline: 'Ask about consumer rights',
    chatSubline: 'Consumer Protection Act · RERA · Product Liability',
  },
  {
    key: 'rti',
    label: 'RTI',
    emoji: '👁️',
    color: '#7C3AED',
    bgColor: '#F5F3FF',
    route: '/(tabs)',
    rightsTopicId: 'rti',
    relatedTopicIds: ['rti', 'fir'],
    homeTryQuestions: [
      '"How do I file an RTI application?"',
      '"Government didn\'t reply to my RTI in 30 days"',
      '"Can I get an FIR copy via RTI?"',
    ],
    chatSuggestions: [
      { text: 'How do I file an RTI application?', icon: 'eye-outline' },
      { text: 'What if I get no response to my RTI in 30 days?', icon: 'time-outline' },
      { text: 'Draft a first appeal for an unanswered RTI', icon: 'document-text-outline' },
      { text: 'What information can be refused under the RTI Act?', icon: 'close-circle-outline' },
    ],
    forYouCard: {
      tag: 'RTI',
      title: 'Right to Information',
      body: 'Ask the government — draft and file an RTI in minutes.',
      route: '/(tabs)',
      cta: 'Ask Dhara',
    },
    chatHeadline: 'Ask about RTI',
    chatSubline: 'Right to Information Act 2005 · Government Records',
  },
  {
    key: 'domestic',
    label: 'Domestic Violence',
    emoji: '🏠',
    color: '#DC2626',
    bgColor: '#FEF2F2',
    route: '/women-shield',
    rightsTopicId: 'domestic-violence',
    relatedTopicIds: ['domestic-violence', 'women-safety', 'police-stop'],
    homeTryQuestions: [
      '"How do I get a protection order?"',
      '"Can I stay in my shared home during a dispute?"',
      '"What helpline can I call for domestic violence?"',
    ],
    chatSuggestions: [
      { text: 'How do I get a protection order against domestic violence?', icon: 'shield-checkmark-outline' },
      { text: 'Can I stay in my shared household during a dispute?', icon: 'home-outline' },
      { text: 'How do I contact a Protection Officer in my district?', icon: 'call-outline' },
      { text: 'What is the domestic violence helpline number?', icon: 'alert-circle-outline' },
    ],
    forYouCard: {
      tag: 'DOMESTIC SAFETY',
      title: 'Protection orders',
      body: 'PWDVA rights — protection, residence & custody orders.',
      route: '/women-shield',
      cta: 'Get help',
    },
    chatHeadline: 'Ask about domestic violence',
    chatSubline: 'PWDVA · Protection Orders · Helplines',
  },
  {
    key: 'labor',
    label: 'Labor & Salary',
    emoji: '💼',
    color: '#0891B2',
    bgColor: '#ECFEFF',
    route: '/(tabs)',
    rightsTopicId: 'consumer',
    relatedTopicIds: ['consumer', 'rti'],
    homeTryQuestions: [
      '"My employer hasn\'t paid me for 2 months"',
      '"I was fired without notice — my rights?"',
      '"How do I file a labour complaint?"',
    ],
    chatSuggestions: [
      { text: "My employer hasn't paid my salary — what do I do?", icon: 'cash-outline' },
      { text: 'I was fired without notice — what are my rights?', icon: 'briefcase-outline' },
      { text: 'How to file a complaint under the Wage Code?', icon: 'document-text-outline' },
      { text: 'What is the minimum wage in my state?', icon: 'trending-up-outline' },
    ],
    forYouCard: {
      tag: 'LABOR RIGHTS',
      title: 'Unpaid salary',
      body: 'Wage Code remedies — send a legal notice in minutes.',
      route: '/drafts/unpaid_salary',
      cta: 'Send notice',
    },
    chatHeadline: 'Ask about labor & salary',
    chatSubline: 'Wage Code · Employment Rights · Industrial Relations',
  },
];

export function useUserProfile() {
  const [interests, setInterests] = useState<ProfileInterest[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getItem(PROFILE_KEY, null).then((val) => {
      if (Array.isArray(val)) setInterests(val as ProfileInterest[]);
      setLoaded(true);
    });
  }, []);

  const saveInterests = useCallback(async (next: ProfileInterest[]) => {
    const limited = next.slice(0, MAX_INTERESTS);
    setInterests(limited);
    await storage.setItem(PROFILE_KEY, limited as any);
  }, []);

  const primaryInterest = interests.length > 0
    ? INTERESTS.find(i => i.key === interests[0]) ?? null
    : null;

  return { interests, primaryInterest, saveInterests, loaded };
}
