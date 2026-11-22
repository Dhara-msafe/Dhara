import type { Language } from './auth';

/**
 * Every language DHARA offers. Moved here from app/language.tsx (unchanged)
 * so the sign-in code can turn a profile's language code back into a full
 * Language (name, native script, TTS voice).
 */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', tts: 'en-IN' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', tts: 'hi-IN' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', tts: 'bn-IN' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', tts: 'ta-IN' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', tts: 'te-IN' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', tts: 'mr-IN' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', tts: 'gu-IN' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', tts: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', tts: 'ml-IN' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', tts: 'pa-IN' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', tts: 'or-IN' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', tts: 'as-IN' },
  { code: 'ur', name: 'Urdu', native: 'اردو', tts: 'ur-IN' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', tts: 'sd-IN' },
  { code: 'ks', name: 'Kashmiri', native: 'कॉशुर', tts: 'ks-IN' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', tts: 'ne-NP' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', tts: 'sa-IN' },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', tts: 'kok-IN' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', tts: 'mai-IN' },
  { code: 'mni', name: 'Manipuri', native: 'মৈতৈলোন্', tts: 'mni-IN' },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', tts: 'sat-IN' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', tts: 'doi-IN' },
  { code: 'brx', name: 'Bodo', native: "बर'", tts: 'brx-IN' },
];

/** The Language for a profile code, or null when the code is unknown/empty. */
export function languageForCode(code: string | null | undefined): Language | null {
  if (!code) return null;
  return LANGUAGES.find((l) => l.code === code) ?? null;
}
