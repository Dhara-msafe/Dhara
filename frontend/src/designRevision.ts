/**
 * Presentation-only rollback flag for the Nov 2026 UI-revision pilot batch
 * (DHARA_UI_Revision v2.1 — Missing person entry, Person details, Officer
 * card). Toggling this switches a handful of colours/accessible-names back
 * and forth — it never touches stored data, auth, routing, consent records
 * or any API behaviour.
 *
 * Default ON. Set EXPO_PUBLIC_UI_REVISION_V1=false to instantly revert the
 * pilot screens to their pre-revision look for a rollback test.
 */
export const UI_REVISION_V1 = process.env.EXPO_PUBLIC_UI_REVISION_V1 !== 'false';
