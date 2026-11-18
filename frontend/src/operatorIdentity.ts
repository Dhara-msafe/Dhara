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
export const grievanceContactEmail = 'grievances@askdhara.in'; // B-70 owner-confirmed 17 Nov
export const privacyContactEmail = 'callistus@askdhara.in';

/**
 * Interim app service privacy-policy URL.
 *
 * dhara.msafesolutions.com/privacy.html is the document that covers actual
 * DHARA service data processing (voice, evidence, guardian, AI providers,
 * retention periods, etc.).  askdhara.in/privacy.html is the marketing-website
 * notice; it explicitly states it does not cover the application.
 *
 * PENDING — before this URL can change to askdhara.in/privacy.html, the
 * askdhara.in page must be expanded to describe full app data processing.
 * See V2_2_STATUS_TABLE.md "Privacy Policy" row for the gap checklist.
 *
 * Changed from dhara.msafesolutions.com → askdhara.in on 2026-11-17 (error),
 * reverted to dhara.msafesolutions.com on 2026-11-17 (this change).
 *
 * ScalaHosting action still required on dhara.msafesolutions.com/privacy.html:
 *   §9 contact must be updated to callistus@askdhara.in + Varuna Moses.
 */
export const privacyPolicyUrl = 'https://dhara.msafesolutions.com/privacy.html';

/**
 * Future canonical URL — set privacyPolicyUrl to this once the full app
 * service policy is published and verified live at askdhara.in.
 */
export const privacyPolicyUrlFuture = 'https://askdhara.in/privacy.html';

/**
 * True when the grievance officer name and/or email is still an
 * unconfirmed placeholder. Consumers MUST use this to decide whether to
 * render the grievance officer line at all — never invent a name/email
 * to fill the gap.
 */
export const isGrievanceContactPlaceholder = (): boolean =>
  grievanceOfficerName.includes('to be confirmed') || grievanceContactEmail.includes('to be confirmed');
