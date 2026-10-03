/**
 * Ready-to-send notice drafts.
 *
 * The text is assembled HERE on the device from a fixed template — no LLM call.
 * That keeps every legal deadline and phrase deterministic (a model must never
 * invent a statutory period) and costs nothing to generate.
 *
 * Statute references are deliberately written in the drafts: unlike chat
 * answers, a legal notice is meaningless to the receiving side without them,
 * and these strings come from the verified corpus, not from a model.
 */

export type DraftType = 'cheque_bounce' | 'deposit_refund' | 'unpaid_salary' | 'sp_complaint';

export type DraftField = {
  key: string;
  label: string;
  placeholder: string;
  keyboard?: 'default' | 'numeric';
  multiline?: boolean;
};

export type DraftSpec = {
  type: DraftType;
  title: string;
  subtitle: string;
  icon: 'card-outline' | 'home-outline' | 'briefcase-outline' | 'shield-outline';
  /** The deadline the user must respect — shown prominently before they draft */
  deadline: string;
  fields: DraftField[];
  build: (v: Record<string, string>) => string;
};

const today = () =>
  new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

const val = (v: Record<string, string>, k: string, fallback = '____________') =>
  (v[k] || '').trim() || fallback;

export const DRAFTS: DraftSpec[] = [
  {
    type: 'cheque_bounce',
    title: 'Cheque bounce demand notice',
    subtitle: 'Statutory notice to the person who gave you the bounced cheque',
    icon: 'card-outline',
    deadline:
      'Must reach the drawer within 30 DAYS of the bank return memo. The drawer then gets 15 days to pay before you can file the complaint.',
    fields: [
      { key: 'sender_name', label: 'Your full name', placeholder: 'Ramesh Kumar' },
      { key: 'sender_address', label: 'Your address', placeholder: 'House no, street, city, PIN', multiline: true },
      { key: 'receiver_name', label: 'Name of the person who gave the cheque', placeholder: 'Suresh Traders / Mr. Suresh' },
      { key: 'receiver_address', label: 'Their address', placeholder: 'Shop / house address', multiline: true },
      { key: 'cheque_no', label: 'Cheque number', placeholder: '000123', keyboard: 'numeric' },
      { key: 'cheque_date', label: 'Date on the cheque', placeholder: '05-05-2026' },
      { key: 'amount', label: 'Cheque amount (₹)', placeholder: '50000', keyboard: 'numeric' },
      { key: 'bank_name', label: 'Bank the cheque was drawn on', placeholder: 'State Bank of India, MG Road branch' },
      { key: 'return_date', label: 'Date of the bank return memo', placeholder: '12-05-2026' },
      { key: 'return_reason', label: 'Reason on the return memo', placeholder: 'Funds insufficient' },
      { key: 'liability', label: 'What the money was for', placeholder: 'goods supplied on 20-04-2026 against invoice 114' },
    ],
    build: (v) => `LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Date: ${today()}

From:
${val(v, 'sender_name')}
${val(v, 'sender_address')}

To:
${val(v, 'receiver_name')}
${val(v, 'receiver_address')}

Sub: Demand for payment of ₹${val(v, 'amount', '______')} against dishonoured cheque no. ${val(v, 'cheque_no', '______')}

Sir / Madam,

1. You issued cheque no. ${val(v, 'cheque_no', '______')} dated ${val(v, 'cheque_date', '__________')} for ₹${val(v, 'amount', '______')} drawn on ${val(v, 'bank_name')} in my favour, towards discharge of your legally enforceable liability for ${val(v, 'liability')}.

2. The said cheque was presented for payment within its validity period and was returned unpaid by the bank on ${val(v, 'return_date', '__________')} with the remark "${val(v, 'return_reason', '______')}". The bank's return memo is with me.

3. The dishonour of the cheque constitutes an offence under Section 138 of the Negotiable Instruments Act, 1881.

4. By this notice, served within thirty days of my receiving information of the dishonour as required by clause (b) of the proviso to Section 138, I call upon you to pay the sum of ₹${val(v, 'amount', '______')} to me WITHIN FIFTEEN DAYS of receipt of this notice.

5. If you fail to pay within the said fifteen days, I shall be constrained to initiate criminal proceedings against you under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881, before the competent court, and to seek interim compensation under Section 143A, entirely at your risk, cost and consequences.

6. A copy of this notice is retained for record.

Yours faithfully,

${val(v, 'sender_name')}
(Signature)

SEND BY: registered post with acknowledgement due AND by email/WhatsApp. Keep the postal receipt, the acknowledgement card and the bank return memo — these three documents are your proof of the 30-day compliance.`,
  },
  {
    type: 'deposit_refund',
    title: 'Security deposit refund notice',
    subtitle: 'Notice to a landlord who has not returned your deposit',
    icon: 'home-outline',
    deadline:
      'Send it as soon as the deposit is overdue. Keep proof of handing over vacant possession — that is the date the refund becomes due.',
    fields: [
      { key: 'sender_name', label: 'Your full name', placeholder: 'Anita Sharma' },
      { key: 'sender_address', label: 'Your current address', placeholder: 'New address, city, PIN', multiline: true },
      { key: 'landlord_name', label: "Landlord's name", placeholder: 'Mr. Verma' },
      { key: 'landlord_address', label: "Landlord's address", placeholder: 'Address, city, PIN', multiline: true },
      { key: 'premises', label: 'Rented premises address', placeholder: 'Flat 3B, Green Apartments, ...', multiline: true },
      { key: 'rent', label: 'Monthly rent (₹)', placeholder: '15000', keyboard: 'numeric' },
      { key: 'deposit', label: 'Deposit paid (₹)', placeholder: '45000', keyboard: 'numeric' },
      { key: 'vacate_date', label: 'Date you handed over possession', placeholder: '30-04-2026' },
      { key: 'dues', label: 'Any dues you accept (write NIL if none)', placeholder: 'NIL' },
    ],
    build: (v) => `NOTICE FOR REFUND OF SECURITY DEPOSIT

Date: ${today()}

From:
${val(v, 'sender_name')}
${val(v, 'sender_address')}

To:
${val(v, 'landlord_name')}
${val(v, 'landlord_address')}

Sub: Refund of security deposit of ₹${val(v, 'deposit', '______')} for the premises ${val(v, 'premises')}

Sir / Madam,

1. I was your tenant in the premises ${val(v, 'premises')} at a monthly rent of ₹${val(v, 'rent', '______')} and had paid you a security deposit of ₹${val(v, 'deposit', '______')}.

2. I handed over vacant and peaceful possession of the premises to you on ${val(v, 'vacate_date', '__________')} along with the keys. The premises were handed over in the same condition, subject to normal wear and tear.

3. My dues towards rent and utilities as on the date of handover are: ${val(v, 'dues', 'NIL')}.

4. Under the tenancy agreement and the state tenancy law applicable to these premises, the security deposit is refundable on handover of vacant possession after deducting only lawful dues. Despite my repeated requests, the deposit has not been refunded to me.

5. I therefore call upon you to refund ₹${val(v, 'deposit', '______')}, less only the dues stated in paragraph 3, WITHIN FIFTEEN DAYS of receipt of this notice, by bank transfer or cheque in my name.

6. If the amount is not refunded within the said period, I shall be constrained to approach the Rent Authority / Rent Controller and the appropriate civil forum for recovery of the deposit with interest and costs, entirely at your risk and cost.

Yours faithfully,

${val(v, 'sender_name')}
(Signature)

SEND BY: registered post with acknowledgement due AND by email/WhatsApp. Attach the rent agreement, the deposit payment proof and the handover photos or acknowledgement.`,
  },
  {
    type: 'unpaid_salary',
    title: 'Unpaid salary demand notice',
    subtitle: 'Notice to an employer who has withheld your wages',
    icon: 'briefcase-outline',
    deadline:
      'Monthly wages are due by the 7th of the next month; on exit, full settlement is due within 2 working days. A claim can be filed for up to 3 years.',
    fields: [
      { key: 'sender_name', label: 'Your full name', placeholder: 'Mohammed Iqbal' },
      { key: 'sender_address', label: 'Your address', placeholder: 'Address, city, PIN', multiline: true },
      { key: 'employer_name', label: 'Employer / company name', placeholder: 'ABC Services Pvt Ltd' },
      { key: 'employer_address', label: 'Employer address', placeholder: 'Registered office address', multiline: true },
      { key: 'designation', label: 'Your designation', placeholder: 'Machine operator' },
      { key: 'joining_date', label: 'Date of joining', placeholder: '01-06-2024' },
      { key: 'monthly_wage', label: 'Monthly wage (₹)', placeholder: '18000', keyboard: 'numeric' },
      { key: 'period', label: 'Period for which wages are unpaid', placeholder: 'March 2026 and April 2026' },
      { key: 'amount', label: 'Total amount due (₹)', placeholder: '36000', keyboard: 'numeric' },
      { key: 'exit_status', label: 'Still working / left on (date)', placeholder: 'still working' },
    ],
    build: (v) => `NOTICE DEMANDING PAYMENT OF UNPAID WAGES

Date: ${today()}

From:
${val(v, 'sender_name')}
${val(v, 'sender_address')}

To:
The Employer / Authorised Signatory
${val(v, 'employer_name')}
${val(v, 'employer_address')}

Sub: Non-payment of wages of ₹${val(v, 'amount', '______')} for ${val(v, 'period')}

Sir / Madam,

1. I joined your establishment on ${val(v, 'joining_date', '__________')} as ${val(v, 'designation')} at a monthly wage of ₹${val(v, 'monthly_wage', '______')}. Employment status: ${val(v, 'exit_status')}.

2. My wages for ${val(v, 'period')}, amounting in total to ₹${val(v, 'amount', '______')}, have not been paid to me despite repeated oral requests.

3. Under Section 17 of the Code on Wages, 2019, wages of a monthly-paid employee must be paid before the expiry of the seventh day of the succeeding month, and where the employment has ended by removal, dismissal, retrenchment or resignation, all wages payable must be paid within two working days.

4. I therefore call upon you to pay the said sum of ₹${val(v, 'amount', '______')} to me, along with all other amounts lawfully due (including any statutory bonus, gratuity and leave encashment), WITHIN SEVEN DAYS of receipt of this notice.

5. If payment is not made within the said period, I shall file a claim before the authority appointed under Section 45 of the Code on Wages, 2019, and a grievance on the SAMADHAN portal of the Ministry of Labour & Employment, seeking the amount due together with compensation, which the authority may award up to ten times the amount found due, entirely at your risk and cost.

Yours faithfully,

${val(v, 'sender_name')}
(Signature)

SEND BY: registered post with acknowledgement due AND by email to the HR/company email. Keep your appointment letter, payslips, bank statement and attendance proof — file a claim online at samadhan.labour.gov.in if the employer does not pay.`,
  },
  {
    type: 'sp_complaint',
    title: 'Complaint to the Superintendent of Police',
    subtitle: 'When a police station refuses to register your FIR / Zero FIR',
    icon: 'shield-outline',
    deadline:
      'Send this as soon as a station refuses or delays registering your complaint — there is no fixed deadline, but earlier is stronger evidence of the refusal.',
    fields: [
      { key: 'sender_name', label: 'Your full name', placeholder: 'Priya Nair' },
      { key: 'sender_address', label: 'Your address', placeholder: 'Address, city, PIN', multiline: true },
      { key: 'station_name', label: 'Police station that refused', placeholder: 'XYZ Police Station' },
      { key: 'incident_date', label: 'Date of the incident', placeholder: '01-05-2026' },
      { key: 'incident_place', label: 'Place of the incident', placeholder: 'Near MG Road bus stop' },
      { key: 'offence_desc', label: 'What happened (brief)', placeholder: 'Describe the offence in a few lines', multiline: true },
      { key: 'refusal_date', label: 'Date you approached the station', placeholder: '03-05-2026' },
      { key: 'officer_name', label: "Officer's name/rank (if known)", placeholder: 'Sub-Inspector Rao (if known)' },
    ],
    build: (v) => `COMPLAINT TO THE SUPERINTENDENT OF POLICE

Date: ${today()}

To:
The Superintendent of Police

Sub: Refusal to register FIR at ${val(v, 'station_name')} — request to register complaint under Section 173, BNSS, 2023

Sir / Madam,

1. I am a resident of ${val(v, 'sender_address')}.

2. On ${val(v, 'incident_date', '__________')} at ${val(v, 'incident_place')}, the following offence occurred: ${val(v, 'offence_desc')}.

3. On ${val(v, 'refusal_date', '__________')}, I approached ${val(v, 'station_name')} to lodge a complaint regarding the above${v.officer_name ? ` (before ${val(v, 'officer_name')})` : ''}, but the station refused / failed to register my First Information Report.

4. Under Section 173 of the Bharatiya Nagarik Suraksha Sanhita, 2023, every police station is bound to register information disclosing a cognizable offence, irrespective of the area of occurrence — this is also known as a Zero FIR. Under Section 175 BNSS, I am entitled to approach your office directly where a station refuses to act.

5. I therefore request you to direct the Station House Officer of ${val(v, 'station_name')} to register my FIR without further delay, and to confirm the FIR number to me in writing.

6. I am willing to provide any further details or appear in person as required.

Yours faithfully,

${val(v, 'sender_name')}
(Signature)
Contact: ____________

SEND BY: registered post with acknowledgement due, AND hand-deliver a copy to the SP's office requesting a receiving stamp. You may also submit this online via your state police citizen portal or the National Cyber Crime / e-FIR portal where available. Keep a copy for your records.`,
  },
];

export const draftByType = (t: string): DraftSpec | undefined =>
  DRAFTS.find((d) => d.type === t);
