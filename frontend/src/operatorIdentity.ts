/**
 * Single source of truth for DHARA's operator/entity identity shown in
 * consent, privacy, and footer text across the app.
 *
 * grievanceOfficerName and grievanceContactEmail are owner-confirmed as of
 * this update. If either is ever reset to a placeholder in the future,
 * isGrievanceContactPlaceholder() below will fail-closed and the consumer
 * UI (app/consent.tsx) will hide the grievance officer line automatically.
 */
export const operatorName = 'MSafe Solutions Inc.';
export const indiaEntity = 'Calviltech Digital Solutions Pvt Ltd';
export const grievanceOfficerName = 'Varuna Moses';
export const grievanceContactEmail = 'varuna@calviltech.com';

/**
 * True when the grievance officer name and/or email is still an
 * unconfirmed placeholder. Consumers MUST use this to decide whether to
 * render the grievance officer line at all — never invent a name/email
 * to fill the gap.
 */
export const isGrievanceContactPlaceholder = (): boolean =>
  grievanceOfficerName.includes('to be confirmed') || grievanceContactEmail.includes('to be confirmed');
