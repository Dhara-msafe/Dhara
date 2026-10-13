/**
 * Talk to DHARA — Step 6 helper: the one place that decides whether a voice
 * session's confirmed facts may be kept between app restarts, or must stay
 * session-only.
 *
 * Per the approved plan: no new dependencies are added in this step, so
 * `deviceSecure` is always passed as false until expo-local-authentication is
 * separately approved — meaning every platform (Android, iPhone, web)
 * resolves to 'session_only' today. Web is additionally always session_only
 * via voicePlatform's own rule. This is deliberately a no-behaviour-change
 * wrapper: nothing new is persisted by this file; it exists so any future
 * "keep this matter" action has a single tested gate to call.
 */
import { Platform } from 'react-native';
import { retentionOn, toVoicePlatform } from './core/voicePlatform';
import type { RetentionDecision } from './core/voicePolicy';

export function getVoiceRetentionDecision(opts: {
  signedIn: boolean;
  consentedToKeep: boolean;
}): RetentionDecision {
  return retentionOn(toVoicePlatform(Platform.OS), {
    signedIn: opts.signedIn,
    deviceSecure: false, // expo-local-authentication not yet approved
    consentedToKeep: opts.consentedToKeep,
  });
}
