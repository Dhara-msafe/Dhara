/**
 * Family Journey — build flags.
 *
 * Kept in its own module (no imports) so both previewCopy.ts and send.ts can
 * read it without a circular import.
 */

/** Phase 2 — real delivery. When false the feature behaves exactly as Phase 1
 *  did: everything is a local preview and nothing can leave the phone. */
export const FJ_SEND_ENABLED = process.env.EXPO_PUBLIC_FAMILY_JOURNEY_SEND_V1 === 'true';
