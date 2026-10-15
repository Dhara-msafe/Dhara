/**
 * Single source of truth for DHARA's operator/entity identity shown in
 * consent, privacy, and footer text across the app.
 *
 * grievanceOfficerName is intentionally a placeholder — the owner has not
 * yet supplied a confirmed grievance officer name. Do not invent one.
 *
 * grievanceContactEmail is left as the pre-existing, already-functional
 * grievance@calviltech.com address (consistent with indiaEntity's real
 * domain) — NOT a newly-fabricated address — but it still needs explicit
 * owner confirmation that this is the correct, monitored inbox before it
 * is treated as final/publishable.
 */
export const operatorName = 'MSafe Solutions Inc.';
export const indiaEntity = 'Calviltech Digital Solutions Pvt Ltd';
export const grievanceOfficerName = 'Grievance Officer (name to be confirmed by owner)';
export const grievanceContactEmail = 'grievance@calviltech.com';

/**
 * True when the grievance officer name and/or email is still an
 * unconfirmed placeholder. Consumers MUST use this to decide whether to
 * render the grievance officer line at all — never invent a name/email
 * to fill the gap.
 */
export const isGrievanceContactPlaceholder = (): boolean =>
  grievanceOfficerName.includes('to be confirmed') || grievanceContactEmail.includes('to be confirmed');
