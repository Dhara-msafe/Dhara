/**
 * Visitor Mode — Static content for all workflows.
 */

export type WorkflowStep = {
  id: string;
  icon: string;
  title: Record<string, string>;
  body: Record<string, string>;
  speak_hi?: string;
  callNumber?: string;
  callLabel?: Record<string, string>;
};

// ── Emergency ────────────────────────────────────────────────────────────────
export const EMERGENCY_STEPS: WorkflowStep[] = [
  {
    id: 'call_112',
    icon: 'call',
    title: { en: 'Call Emergency: 112', fr: 'Appeler le 112', de: 'Notruf: 112', es: 'Llamar al 112', hi: '112 पर कॉल करें' },
    body: {
      en: 'India\'s single emergency number. Works for police, fire, and ambulance. Free from any mobile.',
      fr: 'Numéro d\'urgence unique en Inde. Gratuit depuis tout mobile.',
      de: 'Indiens einheitliche Notrufnummer. Kostenlos von jedem Mobiltelefon.',
      es: 'Número de emergencia único de India. Gratis desde cualquier móvil.',
      hi: 'भारत का एकीकृत आपातकालीन नंबर। किसी भी मोबाइल से मुफ्त।',
    },
    speak_hi: 'मुझे तुरंत मदद चाहिए। मैं एक विदेशी पर्यटक हूँ। कृपया 112 पर कॉल करें।',
    callNumber: '112',
    callLabel: { en: 'Call 112 now', hi: '112 पर कॉल करें' },
  },
  {
    id: 'nearest_police',
    icon: 'shield-checkmark-outline',
    title: { en: 'Locate Nearest Police Station', fr: 'Commissariat le plus proche', de: 'Nächste Polizeiwache', es: 'Comisaría más cercana', hi: 'निकटतम पुलिस थाना खोजें' },
    body: {
      en: 'Tell the officer: "I am a foreign tourist. I need assistance." Show this screen if needed.',
      fr: 'Dites : "Je suis un touriste étranger. J\'ai besoin d\'aide."',
      de: 'Sagen Sie: "Ich bin ein ausländischer Tourist. Ich brauche Hilfe."',
      es: 'Diga: "Soy un turista extranjero. Necesito ayuda."',
      hi: 'अधिकारी से कहें: "मैं एक विदेशी पर्यटक हूँ। मुझे सहायता चाहिए।"',
    },
    speak_hi: 'मैं एक विदेशी पर्यटक हूँ। मुझे तत्काल सहायता की आवश्यकता है। कृपया मेरी मदद करें।',
  },
  {
    id: 'embassy',
    icon: 'flag-outline',
    title: { en: 'Contact Your Embassy', fr: 'Contacter votre ambassade', de: 'Botschaft kontaktieren', es: 'Contactar su embajada', hi: 'अपना दूतावास संपर्क करें' },
    body: {
      en: 'Your embassy can provide emergency travel documents, interpreter services, and legal assistance.',
      fr: 'Votre ambassade peut fournir des documents de voyage d\'urgence et une assistance.',
      de: 'Ihre Botschaft kann Notreisedokumente und Rechtshilfe bereitstellen.',
      es: 'Su embajada puede proporcionar documentos de viaje de emergencia y asistencia.',
      hi: 'आपका दूतावास आपातकालीन यात्रा दस्तावेज़ और कानूनी सहायता प्रदान कर सकता है।',
    },
    speak_hi: 'मुझे मेरे दूतावास से संपर्क करने में मदद चाहिए। मैं एक विदेशी पर्यटक हूँ।',
  },
];

// ── Lost Passport ─────────────────────────────────────────────────────────────
export const LOST_PASSPORT_STEPS: WorkflowStep[] = [
  {
    id: 'file_fir',
    icon: 'document-text-outline',
    title: { en: 'File a Police Report (FIR)', fr: 'Déposer une plainte (FIR)', de: 'Polizeibericht erstatten', es: 'Presentar denuncia policial', hi: 'पुलिस रिपोर्ट (FIR) दर्ज करें' },
    body: {
      en: 'Go to the nearest police station and request an FIR for lost passport. The FIR copy is required by your embassy. You can file at ANY station in India (Zero FIR right).',
      fr: 'Rendez-vous au commissariat le plus proche pour un FIR pour passeport perdu.',
      de: 'Gehen Sie zur nächsten Polizeiwache für einen FIR wegen verlorenem Reisepass.',
      es: 'Vaya a la comisaría más cercana para presentar un FIR por pérdida de pasaporte.',
      hi: 'निकटतम पुलिस थाने पर जाएँ और खोए हुए पासपोर्ट के लिए FIR दर्ज करवाएँ।',
    },
    speak_hi: 'मेरा पासपोर्ट खो गया है। मैं एक विदेशी पर्यटक हूँ। मुझे FIR दर्ज करवानी है। कृपया मेरी मदद करें।',
  },
  {
    id: 'embassy_contact',
    icon: 'flag-outline',
    title: { en: 'Contact Your Embassy / Consulate', fr: 'Contacter votre ambassade / consulat', de: 'Botschaft / Konsulat kontaktieren', es: 'Contactar su embajada / consulado', hi: 'अपने दूतावास / वाणिज्य दूतावास से संपर्क करें' },
    body: {
      en: 'Report the loss to your embassy with the FIR copy. They will issue an Emergency Travel Document (ETD). Most embassies are in New Delhi; check for consulates in major cities.',
      fr: 'Signalez la perte à votre ambassade avec la copie du FIR.',
      de: 'Melden Sie den Verlust Ihrer Botschaft mit der FIR-Kopie.',
      es: 'Informe la pérdida a su embajada con la copia del FIR.',
      hi: 'FIR की कॉपी के साथ अपने दूतावास को सूचित करें।',
    },
    speak_hi: 'मेरा पासपोर्ट खो गया है। मुझे अपने दूतावास से संपर्क करना है। क्या आप मेरी मदद कर सकते हैं?',
  },
  {
    id: 'frro',
    icon: 'business-outline',
    title: { en: 'Register with FRRO', fr: 'S\'enregistrer auprès du FRRO', de: 'Bei der FRRO registrieren', es: 'Registrarse con el FRRO', hi: 'FRRO के साथ पंजीकरण करें' },
    body: {
      en: 'The Foreigners Regional Registration Office (FRRO) handles visa extensions and emergency documentation. Apply online at indianfrro.gov.in. Required: FIR copy, passport photos, embassy letter.',
      fr: 'Le FRRO gère les prolongations de visa. Demandez en ligne sur indianfrro.gov.in.',
      de: 'Das FRRO bearbeitet Visaverlängerungen. Online-Antrag auf indianfrro.gov.in.',
      es: 'El FRRO gestiona extensiones de visa. Solicite en línea en indianfrro.gov.in.',
      hi: 'FRRO वीज़ा विस्तार और आपातकालीन दस्तावेज़ीकरण संभालता है। indianfrro.gov.in पर ऑनलाइन आवेदन करें।',
    },
    speak_hi: 'मुझे FRRO से मिलना है। मेरा पासपोर्ट खो गया है और मैं एक विदेशी पर्यटक हूँ।',
    callNumber: 'https://indianfrro.gov.in',
    callLabel: { en: 'Open FRRO website', hi: 'FRRO वेबसाइट खोलें' },
  },
  {
    id: 'tourist_helpline',
    icon: 'headset-outline',
    title: { en: 'Tourist Helpline: 1800-111-363', fr: 'Ligne d\'assistance: 1800-111-363', de: 'Touristen-Hotline: 1800-111-363', es: 'Línea de ayuda: 1800-111-363', hi: 'पर्यटक हेल्पलाइन: 1800-111-363' },
    body: {
      en: 'India Tourism\'s 24/7 free helpline for foreign tourists. Staff speak multiple languages.',
      fr: 'Ligne d\'assistance touristique gratuite 24h/24. Disponible en plusieurs langues.',
      de: '24/7 kostenlose Touristen-Hotline. Mehrsprachig verfügbar.',
      es: 'Línea gratuita 24/7 para turistas extranjeros. Disponible en varios idiomas.',
      hi: 'विदेशी पर्यटकों के लिए 24/7 मुफ्त हेल्पलाइन।',
    },
    speak_hi: 'मैं एक विदेशी पर्यटक हूँ। मेरा पासपोर्ट खो गया है। कृपया पर्यटक हेल्पलाइन 1800-111-363 पर कॉल करें।',
    callNumber: '1800111363',
    callLabel: { en: 'Call Tourist Helpline', hi: 'हेल्पलाइन पर कॉल करें' },
  },
];

// ── Visa / FRRO Deep-Dive ─────────────────────────────────────────────────────
export const VISA_FRRO_STEPS: WorkflowStep[] = [
  {
    id: 'check_evisa',
    icon: 'globe-outline',
    title: { en: 'Check e-Visa Status', fr: 'Vérifier le statut e-Visa', de: 'e-Visa-Status prüfen', es: 'Verificar estado e-Visa', hi: 'e-Visa स्थिति जांचें' },
    body: {
      en: 'Check your e-Visa status at indianvisaonline.gov.in. e-Tourist Visas are typically 30/90/180 days. Overstaying is a criminal offence under the Foreigners Act 1946.',
      fr: 'Vérifiez votre statut e-Visa sur indianvisaonline.gov.in.',
      de: 'Überprüfen Sie Ihren e-Visa-Status auf indianvisaonline.gov.in.',
      es: 'Verifique su estado e-Visa en indianvisaonline.gov.in.',
      hi: 'indianvisaonline.gov.in पर अपनी e-Visa स्थिति जांचें।',
    },
    speak_hi: 'मुझे मेरे वीज़े की स्थिति जाँचनी है। मैं एक विदेशी पर्यटक हूँ। कृपया मेरी मदद करें।',
    callNumber: 'https://indianvisaonline.gov.in',
    callLabel: { en: 'Open Visa portal', hi: 'वीज़ा पोर्टल खोलें' },
  },
  {
    id: 'visa_extension',
    icon: 'calendar-outline',
    title: { en: 'Visa Extension via FRRO', fr: 'Extension de visa via FRRO', de: 'Visaverlängerung über FRRO', es: 'Extensión de visa por FRRO', hi: 'FRRO के माध्यम से वीज़ा विस्तार' },
    body: {
      en: 'e-Tourist Visas are generally NOT extendable. For medical emergencies or natural calamities, FRRO may grant a short extension. Apply at your nearest FRRO/FRO office with: passport, visa copy, medical certificate (if applicable), proof of funds.',
      fr: 'Les e-Visas touristes ne sont généralement pas prolongeables. Les urgences médicales peuvent être une exception.',
      de: 'e-Tourist-Visa sind i.d.R. nicht verlängerbar. Medizinische Notfälle können eine Ausnahme sein.',
      es: 'Los e-Visas turísticos generalmente no son extensibles. Las emergencias médicas pueden ser una excepción.',
      hi: 'e-Tourist Visa आमतौर पर विस्तारयोग्य नहीं होते। चिकित्सा आपात स्थिति में FRRO से संपर्क करें।',
    },
    speak_hi: 'मुझे मेरे वीज़े का विस्तार करना है। मैं एक विदेशी पर्यटक हूँ। कृपया मुझे FRRO के बारे में बताएं।',
  },
  {
    id: 'frro_appointment',
    icon: 'calendar-number-outline',
    title: { en: 'Book FRRO Appointment', fr: 'Prendre rendez-vous FRRO', de: 'FRRO-Termin buchen', es: 'Reservar cita FRRO', hi: 'FRRO अपॉइंटमेंट बुक करें' },
    body: {
      en: 'Book an appointment at indianfrro.gov.in. Required documents: passport (original + copy), visa copy, completed Form C, address proof (hotel booking), 2 passport photos, and supporting docs for your request.',
      fr: 'Réservez un rendez-vous sur indianfrro.gov.in.',
      de: 'Buchen Sie einen Termin auf indianfrro.gov.in.',
      es: 'Reserve una cita en indianfrro.gov.in.',
      hi: 'indianfrro.gov.in पर अपॉइंटमेंट बुक करें।',
    },
    speak_hi: 'मुझे FRRO में अपॉइंटमेंट बुक करनी है। कृपया मेरी मदद करें।',
    callNumber: 'https://indianfrro.gov.in',
    callLabel: { en: 'Book FRRO appointment', hi: 'FRRO अपॉइंटमेंट' },
  },
  {
    id: 'overstay',
    icon: 'warning-outline',
    title: { en: 'Overstay Recovery', fr: 'Récupération après dépassement', de: 'Überziehung beheben', es: 'Recuperación por exceso de estadía', hi: 'ओवरस्टे रिकवरी' },
    body: {
      en: 'If you have overstayed: go to FRRO immediately, do not wait. Bring all documents. You may face a penalty (₹500–₹5000/day) and a possible blacklist. Voluntary reporting reduces penalties. Do NOT try to leave without regularising — immigration at airports will detain you.',
      fr: 'Si vous avez dépassé votre visa, allez immédiatement au FRRO.',
      de: 'Bei Visumsüberschreitung sofort zum FRRO gehen.',
      es: 'Si ha excedido su visa, vaya inmediatamente al FRRO.',
      hi: 'यदि आप ओवरस्टे कर चुके हैं: तुरंत FRRO जाएं। ₹500-₹5000/दिन का जुर्माना हो सकता है।',
    },
    speak_hi: 'मेरा वीज़ा समाप्त हो गया है। मुझे ओवरस्टे की समस्या है। कृपया मुझे FRRO के बारे में बताएं।',
  },
];

// ── Cyber Fraud ───────────────────────────────────────────────────────────────
export const CYBER_FRAUD_STEPS: WorkflowStep[] = [
  {
    id: 'preserve_evidence',
    icon: 'camera-outline',
    title: { en: 'Preserve Evidence Immediately', fr: 'Conserver les preuves immédiatement', de: 'Beweise sofort sichern', es: 'Preservar evidencia inmediatamente', hi: 'तुरंत साक्ष्य संरक्षित करें' },
    body: {
      en: 'Before anything else: screenshot all messages, transaction IDs, phone numbers, emails, and URLs involved. Note the exact date/time. Do NOT delete any communication — these are your legal evidence.',
      fr: 'Capturez d\'écran tous les messages, IDs de transaction et numéros de téléphone.',
      de: 'Screenshots aller Nachrichten, Transaktions-IDs und Telefonnummern machen.',
      es: 'Capture pantalla de todos los mensajes, IDs de transacción y números de teléfono.',
      hi: 'सभी संदेशों, लेनदेन आईडी और फोन नंबरों का स्क्रीनशॉट लें। कुछ भी डिलीट न करें।',
    },
    speak_hi: 'मेरे साथ साइबर धोखाधड़ी हुई है। मैं एक विदेशी पर्यटक हूँ। कृपया मेरी मदद करें।',
  },
  {
    id: 'call_1930',
    icon: 'call',
    title: { en: 'Call Cyber Helpline: 1930', fr: 'Appeler la hotline cybercriminalité: 1930', de: 'Cyber-Hotline anrufen: 1930', es: 'Llamar a la línea cyber: 1930', hi: 'साइबर हेल्पलाइन: 1930' },
    body: {
      en: 'India\'s National Cyber Crime helpline. Available 24/7. For financial fraud, call immediately — banks can freeze transactions within hours if reported fast. Staff will guide you through the complaint process.',
      fr: 'Hotline nationale contre la cybercriminalité. Disponible 24h/24.',
      de: 'Nationale Cyber-Hotline. 24/7 verfügbar.',
      es: 'Línea nacional de delitos cibernéticos. Disponible 24/7.',
      hi: 'राष्ट्रीय साइबर अपराध हेल्पलाइन। 24/7 उपलब्ध।',
    },
    speak_hi: 'मेरे साथ साइबर धोखाधड़ी हुई है। मुझे साइबर हेल्पलाइन 1930 पर कॉल करने में मदद चाहिए।',
    callNumber: '1930',
    callLabel: { en: 'Call 1930 now', hi: '1930 पर कॉल करें' },
  },
  {
    id: 'report_portal',
    icon: 'globe-outline',
    title: { en: 'File Report at Cyber Crime Portal', fr: 'Déposer une plainte sur le portail cybercriminalité', de: 'Anzeige im Cyber-Crime-Portal erstatten', es: 'Presentar denuncia en el portal de cibercriminalidad', hi: 'साइबर क्राइम पोर्टल पर रिपोर्ट करें' },
    body: {
      en: 'File online at cybercrime.gov.in. For financial fraud: choose "Report Financial Fraud" — select your bank, enter transaction details. You will get a complaint reference number. Keep it safe.',
      fr: 'Déposez en ligne sur cybercrime.gov.in.',
      de: 'Online-Anzeige auf cybercrime.gov.in erstatten.',
      es: 'Presente denuncia en línea en cybercrime.gov.in.',
      hi: 'cybercrime.gov.in पर ऑनलाइन रिपोर्ट करें।',
    },
    speak_hi: 'मुझे साइबर अपराध पोर्टल पर शिकायत दर्ज करनी है। कृपया मेरी मदद करें।',
    callNumber: 'https://cybercrime.gov.in',
    callLabel: { en: 'Open Cyber Crime portal', hi: 'साइबर क्राइम पोर्टल' },
  },
  {
    id: 'file_fir_cyber',
    icon: 'document-text-outline',
    title: { en: 'File FIR at Police Station', fr: 'Déposer un FIR au commissariat', de: 'FIR auf der Polizeiwache erstatten', es: 'Presentar FIR en la comisaría', hi: 'पुलिस थाने में FIR दर्ज करें' },
    body: {
      en: 'For larger fraud amounts or if the online portal is insufficient, file an FIR at the nearest police station under Section 66C / 66D IT Act (identity theft / cheating by impersonation). Bring all evidence printouts.',
      fr: 'Pour des montants importants, déposez un FIR au commissariat.',
      de: 'Bei größeren Betrugssummen FIR auf der Polizeiwache erstatten.',
      es: 'Para montos mayores, presente un FIR en la comisaría.',
      hi: 'बड़े धोखाधड़ी के मामलों में पुलिस थाने में FIR दर्ज करें।',
    },
    speak_hi: 'मेरे साथ साइबर धोखाधड़ी हुई है। मुझे FIR दर्ज करनी है। मैं एक विदेशी पर्यटक हूँ।',
  },
];

// ── Embassy contacts keyed by tourist language code ───────────────────────────
// B-86: `countryAdjective` was added because `name` is an INSTITUTION name
// ("British High Commission", "Embassy of Japan"), not a nationality -- the
// "Yes, I'm a citizen of ..." sentence used to regex-strip prefixes/suffixes
// off `name` to try to recover a nationality, which only works for names
// that happen to start with "Embassy of"/"Embassy"/"The"/"High Commission".
// "British High Commission" starts with "British", so nothing was stripped
// and the sentence read "Yes, I'm a citizen of British High Commission".
// countryAdjective is the one place that sentence should ever read from.
export const EMBASSY_CONTACTS: Record<string, { name: string; countryAdjective: string; phone: string; city: string }> = {
  en:  { name: 'British High Commission',  countryAdjective: 'the United Kingdom', phone: '+91-11-24192100', city: 'New Delhi' },
  fr:  { name: 'French Embassy',            countryAdjective: 'France',             phone: '+91-11-24196100', city: 'New Delhi' },
  de:  { name: 'German Embassy',            countryAdjective: 'Germany',            phone: '+91-11-44199199', city: 'New Delhi' },
  es:  { name: 'Spanish Embassy',           countryAdjective: 'Spain',              phone: '+91-11-46004071', city: 'New Delhi' },
  pt:  { name: 'Portuguese Embassy',        countryAdjective: 'Portugal',           phone: '+91-11-26115539', city: 'New Delhi' },
  it:  { name: 'Italian Embassy',           countryAdjective: 'Italy',              phone: '+91-11-26114355', city: 'New Delhi' },
  ja:  { name: 'Embassy of Japan',          countryAdjective: 'Japan',              phone: '+91-11-26876564', city: 'New Delhi' },
  ko:  { name: 'Embassy of Korea',          countryAdjective: 'South Korea',        phone: '+91-11-26884793', city: 'New Delhi' },
  zh:  { name: 'Embassy of China',          countryAdjective: 'China',              phone: '+91-11-26112345', city: 'New Delhi' },
  ar:  { name: 'Saudi Embassy (regional)',   countryAdjective: 'Saudi Arabia',       phone: '+91-11-26112447', city: 'New Delhi' },
  ru:  { name: 'Embassy of Russia',         countryAdjective: 'Russia',             phone: '+91-11-26873799', city: 'New Delhi' },
  hi:  { name: 'India (Domestic)',           countryAdjective: 'India',              phone: '112',            city: 'Any city'  },
};
