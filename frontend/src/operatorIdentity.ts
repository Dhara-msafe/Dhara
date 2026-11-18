/**
 * Single source of truth for DHARA's operator/entity identity shown in
 * consent, privacy, and footer text across the app.
 *
 * grievanceOfficerName and grievanceContactEmail are owner-confirmed as of
 * this update. If either is ever reset to a placeholder in the future,
 * isGrievanceContactPlaceholder() below will fail-closed and the consumer
 * UI (app/consent.tsx) will hide the grievance officer line automatically.
 *
 * privacyContactEmail is the general privacy / data-controller inbox used
 * in Data & Privacy screens and the Terms & Conditions CONTACT clause.
 * It is intentionally distinct from grievanceContactEmail (the statutory
 * DPDP grievance officer role handled by Varuna Moses).
 */
export const operatorName = 'MSafe Solutions Inc.';
export const indiaEntity = 'Calviltech Digital Solutions Pvt Ltd';
export const grievanceOfficerName = 'Varuna Moses';
export const grievanceContactEmail = 'varuna@calviltech.com';
export const privacyContactEmail = 'callistus@askdhara.in';

/**
 * Canonical public privacy-policy URL.
 * Changed from dhara.msafesolutions.com/privacy.html → askdhara.in/privacy.html
 * on 2026-11-17 per owner instruction.  Single source of truth; import this
 * wherever the URL is opened or displayed — never hardcode the string.
 */
export const privacyPolicyUrl = 'https://askdhara.in/privacy.html';

/**
 * True when the grievance officer name and/or email is still an
 * unconfirmed placeholder. Consumers MUST use this to decide whether to
 * render the grievance officer line at all — never invent a name/email
 * to fill the gap.
 */
export const isGrievanceContactPlaceholder = (): boolean =>
  grievanceOfficerName.includes('to be confirmed') || grievanceContactEmail.includes('to be confirmed');
