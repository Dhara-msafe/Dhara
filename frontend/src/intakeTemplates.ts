/**
 * Intake template library for Advocate Door.
 * 4 common categories for Indian legal practice.
 * Each template defines structured questions the client fills in.
 */

import { theme } from './theme';

export type QuestionType = 'text' | 'textarea';

export interface IntakeQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  placeholder?: string;
}

export interface IntakeTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;  // Ionicons name
  color: string; // accent color for the card
  questions: IntakeQuestion[];
}

export const INTAKE_TEMPLATES: IntakeTemplate[] = [
  {
    id: 'criminal',
    title: 'Criminal Matter',
    description: 'FIR, arrest, bail, police complaint',
    icon: 'shield-outline',
    color: '#C73236',
    questions: [
      {
        id: 'incident_date',
        label: 'When did the incident occur?',
        placeholder: 'e.g., 15 June 2026',
        type: 'text',
        required: true,
      },
      {
        id: 'incident_description',
        label: 'Describe what happened',
        placeholder: 'Tell us in your own words — Hindi or English is fine',
        type: 'textarea',
        required: true,
      },
      {
        id: 'accused',
        label: 'Is the accused known to you? Who are they?',
        placeholder: 'Name or relationship if known',
        type: 'text',
      },
      {
        id: 'fir_status',
        label: 'Has an FIR been filed?',
        placeholder: 'FIR number and police station, or "Not yet filed"',
        type: 'text',
      },
      {
        id: 'injuries',
        label: 'Were there any injuries or property damage?',
        placeholder: 'Describe briefly',
        type: 'text',
      },
      {
        id: 'relief',
        label: 'What outcome are you hoping for?',
        placeholder: 'e.g., file FIR, bail, protection order…',
        type: 'textarea',
        required: true,
      },
    ],
  },
  {
    id: 'civil',
    title: 'Civil Dispute',
    description: 'Contracts, money recovery, injunctions',
    icon: 'document-text-outline',
    color: theme.colors.primary,
    questions: [
      {
        id: 'dispute_nature',
        label: 'What is the dispute about?',
        placeholder: 'Unpaid loan, breach of contract, fraud…',
        type: 'textarea',
        required: true,
      },
      {
        id: 'opposing_party',
        label: 'Who is the opposing party?',
        placeholder: 'Name and address if known',
        type: 'text',
        required: true,
      },
      {
        id: 'amount',
        label: 'What amount or value is involved?',
        placeholder: 'e.g., ₹2,50,000',
        type: 'text',
      },
      {
        id: 'documents',
        label: 'What documents do you have?',
        placeholder: 'Agreements, receipts, WhatsApp chats, bank statements…',
        type: 'textarea',
      },
      {
        id: 'prior_action',
        label: 'Have you sent any legal notice or taken prior action?',
        placeholder: 'Yes/No — and details if yes',
        type: 'text',
      },
      {
        id: 'relief',
        label: 'What relief are you seeking?',
        placeholder: 'Recovery of money, injunction, compensation…',
        type: 'textarea',
        required: true,
      },
    ],
  },
  {
    id: 'family',
    title: 'Family Matter',
    description: 'Divorce, custody, maintenance, domestic violence',
    icon: 'people-outline',
    color: '#1E5BD0',
    questions: [
      {
        id: 'matter_type',
        label: 'What is the family issue?',
        placeholder: 'Divorce, custody, maintenance, domestic violence…',
        type: 'text',
        required: true,
      },
      {
        id: 'marriage_details',
        label: 'Date and place of marriage (if applicable)',
        placeholder: 'e.g., 12 Feb 2018, Mumbai',
        type: 'text',
      },
      {
        id: 'children',
        label: 'Are children involved? Ages and current situation?',
        placeholder: 'Ages, who they live with, any custody order…',
        type: 'text',
      },
      {
        id: 'violence',
        label: 'Is there any domestic violence or abuse?',
        placeholder: 'Describe briefly — this information is kept confidential',
        type: 'textarea',
      },
      {
        id: 'financial',
        label: 'Describe the financial situation',
        placeholder: 'Income of each party, joint property, assets, debts…',
        type: 'textarea',
      },
      {
        id: 'relief',
        label: 'What outcome are you hoping for?',
        placeholder: 'Divorce, custody, maintenance amount, protection order…',
        type: 'textarea',
        required: true,
      },
    ],
  },
  {
    id: 'property',
    title: 'Property / Tenancy',
    description: 'Land disputes, eviction, title, rent',
    icon: 'home-outline',
    color: '#087951',
    questions: [
      {
        id: 'property_description',
        label: 'Describe the property',
        placeholder: 'Location, type (flat/plot/house), approximate size',
        type: 'text',
        required: true,
      },
      {
        id: 'ownership',
        label: 'What is your claim to this property?',
        placeholder: 'Owner, tenant, co-owner, inherited…',
        type: 'textarea',
        required: true,
      },
      {
        id: 'dispute_party',
        label: 'Who is the other party in this dispute?',
        placeholder: 'Landlord, tenant, buyer, neighbour, builder…',
        type: 'text',
      },
      {
        id: 'docs',
        label: 'What property documents do you have?',
        placeholder: 'Sale deed, registry, khata, tenancy agreement, rent receipts…',
        type: 'textarea',
      },
      {
        id: 'notice',
        label: 'Has any notice or legal demand been served?',
        placeholder: 'Eviction notice, court summons, demand letter…',
        type: 'text',
      },
      {
        id: 'relief',
        label: 'What are you seeking?',
        placeholder: 'Eviction, title transfer, compensation, injunction…',
        type: 'textarea',
        required: true,
      },
    ],
  },
];

export function getTemplate(id: string): IntakeTemplate | undefined {
  return INTAKE_TEMPLATES.find(t => t.id === id);
}
