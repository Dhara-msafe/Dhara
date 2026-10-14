/**
 * Minimal static-UI i18n layer for DHARA.
 *
 * All AI-generated content is already language-aware via the backend.
 * This file covers STATIC chrome: tab labels, Settings headings, disclaimer,
 * home-screen text, FIR wizard chrome, and suggestion chips.
 *
 * Pattern: t('tab.ask', language.code)  →  'पूछें'  (falls back to English)
 */

export type I18nKey =
  | 'tab.ask'
  | 'tab.vote'
  | 'tab.rights'
  | 'tab.saved'
  | 'tab.lookup'
  | 'tab.advocate'
  | 'tab.settings'
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.section.preferences'
  | 'settings.language'
  | 'settings.state'
  | 'settings.autoSpeak'
  | 'settings.autoSpeak.desc'
  | 'settings.signout'
  | 'settings.account'
  | 'home.headline'
  | 'home.sub'
  | 'home.newChat'
  | 'home.fileComplaint'
  | 'home.fileComplaintSub'
  | 'home.basicMode'
  | 'home.proMode'
  | 'home.suggestion1'
  | 'home.suggestion2'
  | 'home.suggestion3'
  | 'home.suggestion4'
  | 'home.proSuggestion1'
  | 'home.proSuggestion2'
  | 'home.proSuggestion3'
  | 'home.proSuggestion4'
  | 'fir.title'
  | 'fir.subtitle'
  | 'fir.startBtn'
  | 'fir.selectLang'
  | 'fir.nextBtn'
  | 'fir.generateBtn'
  | 'fir.tapMic'
  | 'fir.typeInstead'
  | 'fir.useMic'
  | 'fir.weHeard'
  | 'fir.reRecord'
  | 'fir.editText'
  | 'disclaimer';

type LangMap = Partial<Record<string, string>>;

const TR: Record<I18nKey, LangMap> = {
  'tab.ask':       { en:'Ask',       hi:'पूछें',      mr:'विचारा',    ta:'கேள்',       bn:'জিজ্ঞেস',  te:'అడగండి',   gu:'પૂછો',   kn:'ಕೇಳಿ',   pa:'ਪੁੱਛੋ',   ml:'ചോദിക്കൂ' },
  'tab.vote':      { en:'Vote',      hi:'मत',         mr:'मत',        ta:'வாக்கு',     bn:'ভোট',      te:'ఓటు',      gu:'મત',     kn:'ಮತ',     pa:'ਵੋਟ',     ml:'വോട്ട്' },
  'tab.rights':    { en:'Rights',    hi:'अधिकार',     mr:'हक्क',      ta:'உரிமை',      bn:'অধিকার',  te:'హక్కులు',  gu:'અધિકાર', kn:'ಹಕ್ಕು',  pa:'ਅਧਿਕਾਰ',  ml:'അവകാശം' },
  'tab.saved':     { en:'Saved',     hi:'सहेजे',      mr:'जतन',       ta:'சேமித்த',    bn:'সংরক্ষিত', te:'సేవ్',     gu:'સાચવ્યા', kn:'ಉಳಿಸಿದ', pa:'ਸੁਰੱਖਿਅਤ', ml:'സേവ്' },
  'tab.lookup':    { en:'Lookup',    hi:'खोज',        mr:'शोध',       ta:'தேடல்',      bn:'খোঁজ',    te:'వెతుకు',   gu:'શોધ',    kn:'ಹುಡುಕು', pa:'ਖੋਜ',     ml:'തിരയൂ' },
  'tab.advocate':  { en:'Advocate',  hi:'अधिवक्ता',   mr:'वकील',      ta:'வழக்கறிஞர்', bn:'উকিল',    te:'న్యాయవాది', gu:'વકીલ',  kn:'ವಕೀಲ',   pa:'ਵਕੀਲ',    ml:'അഭിഭാഷകൻ' },
  'tab.settings':  { en:'Settings',  hi:'सेटिंग',     mr:'सेटिंग',    ta:'அமைப்புகள்', bn:'সেটিং',   te:'సెట్టింగులు', gu:'સેટિંગ', kn:'ಸೆಟ್ಟಿಂಗ್', pa:'ਸੈਟਿੰਗ', ml:'ക്രമീകരണം' },

  'settings.title':    { en:'Settings',             hi:'सेटिंग्स',                 mr:'सेटिंग्स',              ta:'அமைப்புகள்',          bn:'সেটিংস',             te:'సెట్టింగులు',          gu:'સેટિંગ્સ',            kn:'ಸೆಟ್ಟಿಂಗ್ಗಳು',       pa:'ਸੈਟਿੰਗਾਂ',          ml:'ക്രമീകരണങ്ങൾ' },
  'settings.subtitle': { en:'Personalize your Dhara', hi:'अपना धारा अनुकूलित करें', mr:'तुमचा धारा सानुकूल करा', ta:'உங்கள் தாரா தனிப்பயன்', bn:'আপনার ধারা ব্যক্তিগতকরণ', te:'మీ ధారాని వ్యక్తిగతీకరించండి', gu:'તમારા ધારાને વ્યક્તિગત', kn:'ನಿಮ್ಮ ಧಾರಾ ವ್ಯಕ್ತಿಗತ', pa:'ਆਪਣਾ ਧਾਰਾ ਵਿਅਕਤੀਗਤ', ml:'നിങ്ങളുടെ ധാരാ' },
  'settings.section.preferences': { en:'Preferences', hi:'प्राथमिकताएं', mr:'प्राधान्ये', ta:'விருப்பங்கள்', bn:'পছন্দ', te:'ప్రాధాన్యతలు', gu:'પ્રાધાન્યતા', kn:'ಆದ್ಯತೆಗಳು', pa:'ਤਰਜੀਹਾਂ', ml:'മുൻഗണനകൾ' },
  'settings.language': { en:'Language',              hi:'भाषा',                     mr:'भाषा',                  ta:'மொழி',                bn:'ভাষা',               te:'భాష',                  gu:'ભાષા',                kn:'ಭಾಷೆ',               pa:'ਭਾਸ਼ਾ',              ml:'ഭാഷ' },
  'settings.state':    { en:'State / Union Territory', hi:'राज्य / केंद्र शासित प्रदेश', mr:'राज्य / केंद्रशासित प्रदेश', ta:'மாநிலம் / யூனியன் பிரதேசம்', bn:'রাজ্য / কেন্দ্রশাসিত অঞ্চল', te:'రాష్ట్రం / కేంద్ర పాలిత', gu:'રાજ્ય / કેન્દ્ર શાસિત', kn:'ರಾಜ್ಯ / ಕೇಂದ್ರ ಆಡಳಿತ', pa:'ਸੂਬਾ / ਕੇਂਦਰ ਸ਼ਾਸਿਤ', ml:'സംസ്ഥാനം / ഭരണ. ' },
  'settings.autoSpeak':      { en:'Auto-speak answers', hi:'उत्तर स्वतः बोलें', mr:'उत्तरे आपोआप बोला', ta:'விடைகளை தானாக பேசு', bn:'স্বয়ংক্রিয় বক্তব্য', te:'స్వయంచాలకంగా చెప్పు', gu:'સ્વયં-ઉત્તર', kn:'ಸ್ವಯಂ ಮಾತನಾಡು', pa:'ਆਪਣੇ ਆਪ ਬੋਲੋ', ml:'സ്വതഃ ഉത്തരം' },
  'settings.autoSpeak.desc': { en:'Reads each answer aloud after it arrives', hi:'प्रत्येक उत्तर आते ही पढ़ता है', mr:'प्रत्येक उत्तर आल्यावर वाचते', ta:'ஒவ்வொரு பதிலும் வந்தவுடன் படிக்கும்', bn:'প্রতিটি উত্তর পড়ে', te:'సమాధానం వచ్చిన వెంటనే చదువుతుంది', gu:'દરેક ઉત્તર આવ્યા પછી વાંચે', kn:'ಪ್ರತಿ ಉತ್ತರ ಬಂದ ತಕ್ಷಣ ಓದುತ್ತದೆ', pa:'ਹਰ ਜਵਾਬ ਆਉਣ ਤੋਂ ਬਾਅਦ ਪੜ੍ਹਦਾ ਹੈ', ml:'ഉത്തരം വന്നാൽ ഉടൻ വായിക്കും' },
  'settings.signout': { en:'Sign Out', hi:'साइन आउट', mr:'साइन आउट', ta:'வெளியேறு', bn:'সাইন আউট', te:'సైన్ అవుట్', gu:'સાઇન આઉટ', kn:'ಸೈನ್ ಔಟ್', pa:'ਸਾਈਨ ਆਉਟ', ml:'സൈൻ ഔട്ട്' },
  'settings.account': { en:'Account', hi:'खाता', mr:'खाते', ta:'கணக்கு', bn:'অ্যাকাউন্ট', te:'ఖాతా', gu:'એકાઉન્ટ', kn:'ಖಾತೆ', pa:'ਖਾਤਾ', ml:'അക്കൗണ്ട്' },

  // ── Home screen chrome ──────────────────────────────────────────────────
  'home.headline': {
    en: 'Ask any question about your rights',
    hi: 'अपने अधिकारों के बारे में कोई भी प्रश्न पूछें',
    mr: 'तुमच्या हक्कांबद्दल कोणताही प्रश्न विचारा',
    ta: 'உங்கள் உரிமைகள் பற்றி எந்த கேள்வியும் கேளுங்கள்',
    bn: 'আপনার অধিকার সম্পর্কে যেকোনো প্রশ্ন করুন',
    te: 'మీ హక్కుల గురించి ఏ ప్రశ్నైనా అడగండి',
    kn: 'ನಿಮ್ಮ ಹಕ್ಕುಗಳ ಬಗ್ಗೆ ಯಾವುದೇ ಪ್ರಶ್ನೆ ಕೇಳಿ',
    pa: 'ਆਪਣੇ ਅਧਿਕਾਰਾਂ ਬਾਰੇ ਕੋਈ ਵੀ ਸਵਾਲ ਪੁੱਛੋ',
    ml: 'നിങ്ങളുടെ അവകാശങ്ങളെ കുറിച്ച് ഏത് ചോദ്യവും ചോദിക്കൂ',
  },
  'home.sub': {
    en: 'Bharatiya Nyaya Sanhita · Constitution · Supreme Court — official sources',
    hi: 'भारतीय न्याय संहिता · संविधान · सर्वोच्च न्यायालय — सरकारी स्रोत',
    mr: 'भारतीय न्याय संहिता · संविधान · सर्वोच्च न्यायालय — अधिकृत स्रोत',
    ta: 'பாரதீய நியாய சம்ஹிதா · அரசியலமைப்பு · உச்ச நீதிமன்றம்',
    bn: 'ভারতীয় ন্যায় সংহিতা · সংবিধান · সুপ্রিম কোর্ট',
    te: 'భారతీయ న్యాయ సంహిత · రాజ్యాంగం · సర్వోన్నత న్యాయస్థానం',
    kn: 'ಭಾರತೀಯ ನ್ಯಾಯ ಸಂಹಿತೆ · ಸಂವಿಧಾನ · ಸರ್ವೋಚ್ಚ ನ್ಯಾಯಾಲಯ',
    pa: 'ਭਾਰਤੀ ਨਿਆਂ ਸੰਹਿਤਾ · ਸੰਵਿਧਾਨ · ਸੁਪਰੀਮ ਕੋਰਟ',
    ml: 'ഭാരതീയ ന്യായ സംഹിത · ഭരണഘടന · സുപ്രീം കോടതി',
  },
  'home.newChat': { en: 'New Chat', hi: 'नया चैट', mr: 'नवीन चॅट', ta: 'புதிய அரட்டை', bn: 'নতুন চ্যাট', te: 'కొత్త చాట్', kn: 'ಹೊಸ ಚಾಟ್', pa: 'ਨਵੀਂ ਚੈਟ', ml: 'പുതിയ ചാറ്റ്' },
  'home.fileComplaint': { en: 'File a Police Complaint', hi: 'पुलिस शिकायत दर्ज करें', mr: 'पोलिस तक्रार नोंदवा', ta: 'காவல் புகார் செய்யுங்கள்', bn: 'পুলিশ অভিযোগ দাখিল করুন', te: 'పోలీసు ఫిర్యాదు దాఖలు', kn: 'ಪೊಲೀಸ್ ದೂರು ನೀಡಿ', pa: 'ਪੁਲਿਸ ਸ਼ਿਕਾਇਤ ਦਾਇਰ ਕਰੋ', ml: 'പൊലീസ് പരാതി' },
  'home.fileComplaintSub': { en: 'Get a ready FIR draft in your language', hi: 'अपनी भाषा में FIR ड्राफ्ट', mr: 'भाषेत FIR मसुदा', ta: 'FIR வரைவு பெறுங்கள்', bn: 'ভাষায় FIR খসড়া', te: 'భాషలో FIR ముసాయిదా', kn: 'ಭಾಷೆಯಲ್ಲಿ FIR ಕರಡು', pa: 'ਭਾਸ਼ਾ ਵਿੱਚ FIR ਡਰਾਫਟ', ml: 'ഭാഷയിൽ FIR ​​ഡ്രാഫ്റ്റ്' },
  'home.basicMode': { en: 'Basic mode', hi: 'बेसिक मोड', mr: 'बेसिक मोड', ta: 'அடிப்படை', bn: 'বেসিক মোড', te: 'బేసిక్ మోడ్', kn: 'ಬೇಸಿಕ್ ಮೋಡ್', pa: 'ਬੇਸਿਕ ਮੋਡ', ml: 'ബേസിക് മോഡ്' },
  'home.proMode': { en: 'Pro mode', hi: 'प्रो मोड', mr: 'प्रो मोड', ta: 'புரோ', bn: 'প্রো মোড', te: 'ప్రో మోడ్', kn: 'ಪ್ರೋ ಮೋಡ್', pa: 'ਪ੍ਰੋ ਮੋਡ', ml: 'പ്രോ മോഡ്' },
  'home.suggestion1': { en: 'My cheque bounced — what is the notice deadline?', hi: 'मेरा चेक बाउंस हुआ — नोटिस की अंतिम तारीख?', mr: 'माझा चेक बाउंस — नोटिसची तारीख?', ta: 'காசோலை திரும்பியது — நோட்டீஸ் காலக்கெடு?', bn: 'চেক বাউন্স — নোটিশের তারিখ?', te: 'చెక్ బౌన్స్ — నోటీస్ గడువు?', kn: 'ಚೆಕ್ ಬೌನ್ಸ್ — ನೋಟೀಸ್ ಗಡುವು?', pa: 'ਚੈੱਕ ਬਾਊਂਸ — ਨੋਟਿਸ ਡੈੱਡਲਾਈਨ?', ml: 'ചെക്ക് ബൗൺസ് — ഡെഡ്ലൈൻ?' },
  'home.suggestion2': { en: 'Money gone in a UPI fraud — what do I do first?', hi: 'UPI फ्रॉड में पैसा गया — पहले क्या करूं?', mr: 'UPI फसवणुकीत पैसे — आधी काय?', ta: 'UPI மோசடி — முதலில் என்ன?', bn: 'UPI জালিয়াতি — প্রথমে কী?', te: 'UPI మోసం — ముందు ఏమి?', kn: 'UPI ಮೋಸ — ಮೊದಲು?', pa: 'UPI ਧੋਖਾ — ਪਹਿਲਾਂ ਕੀ?', ml: 'UPI തട്ടിപ്പ് — ആദ്യം?' },
  'home.suggestion3': { en: 'What is the fine for riding without a helmet?', hi: 'बिना हेलमेट के जुर्माना कितना?', mr: 'हेल्मेटशिवाय दंड किती?', ta: 'தலைக்கவசமில்லாமல் அபராதம்?', bn: 'হেলমেট ছাড়া জরিমানা?', te: 'హెల్మెట్ లేకుండా జరిమానా?', kn: 'ಹೆಲ್ಮೆಟ್ ಇಲ್ಲದೆ ದಂಡ?', pa: 'ਹੈਲਮੇਟ ਤੋਂ ਬਿਨਾਂ ਜੁਰਮਾਨਾ?', ml: 'ഹെൽമെറ്റ് ഇല്ലാതെ പിഴ?' },
  'home.suggestion4': { en: 'What is the helmet law for a child riding pillion?', hi: 'पीछे बच्चे के लिए हेलमेट नियम?', mr: 'पिलियनवर मुलासाठी हेलमेट?', ta: 'பின்னால் குழந்தைக்கு தலைக்கவச சட்டம்?', bn: 'পিলিয়নে শিশুর হেলমেট?', te: 'పిల్లల హెల్మెట్ నియమం?', kn: 'ಮಗುವಿಗೆ ಹೆಲ್ಮೆಟ್ ನಿಯಮ?', pa: 'ਬੱਚੇ ਲਈ ਹੈਲਮੇਟ ਨਿਯਮ?', ml: 'ഹെൽമെറ്റ് ശിശു നിയമം?' },
  'home.proSuggestion1': { en: 'Draft a first appeal for an unanswered RTI', hi: 'अनुत्तरित RTI के लिए पहली अपील', mr: 'अनुत्तरित RTI पहिले अपील', ta: 'RTI மேல்முறையீடு', bn: 'RTI আপিল', te: 'RTI అప్పీల్', kn: 'RTI ಮೇಲ್ಮನವಿ', pa: 'RTI ਅਪੀਲ', ml: 'RTI അപ്പീൽ' },
  'home.proSuggestion2': { en: 'Complain about a defective online product — full steps', hi: 'ऑनलाइन खराब उत्पाद — शिकायत', mr: 'दोषपूर्ण उत्पाद तक्रार', ta: 'குறைபாடுள்ள தயாரிப்பு புகார்', bn: 'ত্রুটিপূর্ণ পণ্য অভিযোগ', te: 'లోపభూయిష్ట ఉత్పత్తి', kn: 'ದೋಷಪೂರಿತ ಉತ್ಪನ್ನ', pa: 'ਨੁਕਸਦਾਰ ਉਤਪਾਦ', ml: 'ഉൽപ്പന്ന പരാതി' },
  'home.proSuggestion3': { en: 'Draft an RTI asking for a certified FIR copy', hi: 'प्रमाणित FIR के लिए RTI', mr: 'FIR प्रतीसाठी RTI', ta: 'FIR நகலுக்கான RTI', bn: 'FIR কপির RTI', te: 'FIR కాపీ RTI', kn: 'FIR ಪ್ರತಿ RTI', pa: 'FIR ਕਾਪੀ RTI', ml: 'FIR RTI' },
  'home.proSuggestion4': { en: 'Escalation path for a domestic violence case', hi: 'घरेलू हिंसा — कार्रवाई', mr: 'घरगुती हिंसाचार मार्ग', ta: 'குடும்ப வன்முறை', bn: 'গার্হস্থ্য হিংসা', te: 'గృహ హింస కేసు', kn: 'ಗೃಹ ಹಿಂಸೆ', pa: 'ਘਰੇਲੂ ਹਿੰਸਾ', ml: 'ഗൃഹ പീഡനം' },
  // ── FIR wizard chrome ──────────────────────────────────────────────────
  'fir.title': { en: 'Voice FIR Draft Assistant', hi: 'आवाज़ FIR ड्राफ्ट सहायक', mr: 'व्हॉइस FIR मसुदा', ta: 'குரல் FIR வரைவு', bn: 'ভয়েস FIR সহকারী', te: 'వాయిస్ FIR', kn: 'ಧ್ವನಿ FIR ಸಹಾಯಕ', pa: 'ਵੌਇਸ FIR ਸਹਾਇਕ', ml: 'വോയ്‌സ് FIR' },
  'fir.subtitle': { en: 'Powered by DHARA AI', hi: 'DHARA AI द्वारा', mr: 'DHARA AI द्वारे', ta: 'DHARA AI ஆல்', bn: 'DHARA AI দ্বারা', te: 'DHARA AI ద్వారా', kn: 'DHARA AI ​​ಮೂಲಕ', pa: 'DHARA AI ਦੁਆਰਾ', ml: 'DHARA AI ​​ഉപയോഗിച്ച്' },
  'fir.startBtn': { en: 'Start — Describe Incident', hi: 'शुरू करें — घटना बताएं', mr: 'सुरू करा — घटना सांगा', ta: 'தொடங்கு — சம்பவம்', bn: 'শুরু করুন — ঘটনা', te: 'ప్రారంభించు — సంఘటన', kn: 'ಪ್ರಾರಂಭಿಸಿ — ಘಟನೆ', pa: 'ਸ਼ੁਰੂ ਕਰੋ — ਘਟਨਾ', ml: 'ആരംഭിക്കൂ — സംഭവം' },
  'fir.selectLang': { en: 'Select your language', hi: 'अपनी भाषा चुनें', mr: 'तुमची भाषा निवडा', ta: 'மொழி தேர்ந்தெடுங்கள்', bn: 'ভাষা নির্বাচন করুন', te: 'భాషను ఎంచుకోండి', kn: 'ಭಾಷೆ ಆರಿಸಿ', pa: 'ਭਾਸ਼ਾ ਚੁਣੋ', ml: 'ഭാഷ തിരഞ്ഞെടുക്കൂ' },
  'fir.nextBtn': { en: 'Next', hi: 'आगे', mr: 'पुढे', ta: 'அடுத்து', bn: 'পরবর্তী', te: 'తదుపరి', kn: 'ಮುಂದೆ', pa: 'ਅੱਗੇ', ml: 'അടുത്ത്' },
  'fir.generateBtn': { en: 'Generate FIR Draft', hi: 'FIR ड्राफ्ट बनाएं', mr: 'FIR मसुदा तयार करा', ta: 'FIR வரைவு', bn: 'FIR খসড়া', te: 'FIR ముసాయిదా', kn: 'FIR ಕರಡು', pa: 'FIR ਡ੍ਰਾਫਟ', ml: 'FIR ഡ്രാഫ്റ്റ്' },
  'fir.tapMic': { en: 'Tap mic to speak', hi: 'बोलने के लिए माइक दबाएं', mr: 'बोलण्यासाठी माइक दाबा', ta: 'பேச மைக்கை தொடு', bn: 'মাইক চাপুন', te: 'మైక్ నొక్కండి', kn: 'ಮಾತನಾಡಲು ಮೈಕ್ ಟ್ಯಾಪ್', pa: 'ਮਾਈਕ ਦਬਾਓ', ml: 'മൈക്ക് ടാപ്പ്' },
  'fir.typeInstead': { en: 'Type instead', hi: 'टाइप करें', mr: 'टाइप करा', ta: 'தட்டச்சு செய்', bn: 'টাইপ করুন', te: 'టైప్ చేయండి', kn: 'ಟೈಪ್ ಮಾಡಿ', pa: 'ਟਾਈਪ ਕਰੋ', ml: 'ടൈപ്പ് ചെയ്യൂ' },
  'fir.useMic': { en: 'Use voice instead', hi: 'आवाज़ से बोलें', mr: 'आवाज़ वापरा', ta: 'குரல் பயன்படுத்து', bn: 'ভয়েস ব্যবহার', te: 'వాయిస్ వాడండి', kn: 'ಧ್ವನಿ ಬಳಸಿ', pa: 'ਆਵਾਜ਼ ਵਰਤੋ', ml: 'ശബ്ദം ഉപയോഗിക്കൂ' },
  'fir.weHeard': { en: 'We heard:', hi: 'हमने सुना:', mr: 'आम्ही ऐकले:', ta: 'கேட்டோம்:', bn: 'শুনলাম:', te: 'విన్నాం:', kn: 'ಕೇಳಿದ್ದು:', pa: 'ਸੁਣਿਆ:', ml: 'കേട്ടത്:' },
  'fir.reRecord': { en: 'Re-record', hi: 'फिर से रिकॉर्ड करें', mr: 'पुन्हा रेकॉर्ड करा', ta: 'மீண்டும் பதிவு', bn: 'পুনরায় রেকর্ড', te: 'మళ్ళీ రికార్డ్', kn: 'ಮತ್ತೆ ರೆಕಾರ್ಡ್', pa: 'ਦੁਬਾਰਾ ਰਿਕਾਰਡ', ml: 'വീണ്ടും റെക്കോർഡ്' },
  'fir.editText': { en: 'Edit text', hi: 'टेक्स्ट संपादित करें', mr: 'मजकूर संपादित करा', ta: 'உரையை திருத்து', bn: 'টেক্সট সম্পাদনা', te: 'వచనం సవరించు', kn: 'ಪಠ್ಯ ಸಂಪಾದಿಸಿ', pa: 'ਟੈਕਸਟ ਸੰਪਾਦਿਤ', ml: 'ടെക്സ്റ്റ് എഡിറ്റ്' },


  'disclaimer': {
    en: 'DHARA provides legal information, not legal advice. This does not create an advocate-client relationship. Confirm with a qualified advocate before acting.',
    hi: 'DHARA कानूनी जानकारी देता है, कानूनी सलाह नहीं। यह अधिवक्ता-मुवक्किल संबंध नहीं बनाता। कार्रवाई से पहले किसी अर्हता प्राप्त अधिवक्ता से पुष्टि करें।',
    mr: 'DHARA कायदेशीर माहिती देते, कायदेशीर सल्ला नाही। हे वकील-अशील संबंध निर्माण करत नाही। कार्यवाही करण्यापूर्वी पात्र वकिलाकडून खात्री करा.',
    ta: 'DHARA சட்ட தகவல் வழங்குகிறது, சட்ட ஆலோசனை அல்ல. வழக்கறிஞர்-வாடிக்கையாளர் உறவு அல்ல. நடவடிக்கை எடுப்பதற்கு முன் தகுதிவாய்ந்த வழக்கறிஞரிடம் சரிபார்க்கவும்.',
    bn: 'DHARA আইনি তথ্য দেয়, আইনি পরামর্শ নয়। আইনজীবী-মক্কেল সম্পর্ক নয়। পদক্ষেপ নেওয়ার আগে যোগ্য আইনজীবীর সাথে যাচাই করুন।',
    te: 'DHARA చట్టపరమైన సమాచారం అందిస్తుంది, సలహా కాదు. న్యాయవాది-క్లయింట్ సంబంధం కాదు. చర్య తీసుకునే ముందు అర్హత గల న్యాయవాదితో నిర్ధారించండి.',
    gu: 'DHARA કાનૂની માહિતી આપે છે, સલાહ નહીં. વકીલ-ગ્રાહક સંબંધ નથી. પગલાં ભરતા પહેલાં અર્હ વકીલ સાથે ચકાસો.',
    kn: 'DHARA ಕಾನೂನು ಮಾಹಿತಿ ನೀಡುತ್ತದೆ, ಸಲಹೆಯಲ್ಲ. ವಕೀಲ-ಕಕ್ಷಿ ಸಂಬಂಧ ಅಲ್ಲ. ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳುವ ಮೊದಲು ಅರ್ಹ ವಕೀಲರಿಂದ ಪರಿಶೀಲಿಸಿ.',
    pa: 'DHARA ਕਾਨੂੰਨੀ ਜਾਣਕਾਰੀ ਦਿੰਦਾ ਹੈ, ਸਲਾਹ ਨਹੀਂ। ਵਕੀਲ-ਮੁਵੱਕਿਲ ਸੰਬੰਧ ਨਹੀਂ। ਕਦਮ ਚੁੱਕਣ ਤੋਂ ਪਹਿਲਾਂ ਯੋਗ ਵਕੀਲ ਨਾਲ ਜਾਂਚ ਕਰੋ।',
    ml: 'DHARA നിയമ വിവരങ്ങൾ നൽകുന്നു, ഉപദേശമല്ല. അഭിഭാഷക-കക്ഷി ബന്ധമല്ല. നടപടി എടുക്കുന്നതിന് മുമ്പ് അഭിഭാഷകനുമായി സ്ഥിരീകരിക്കുക.',
  },
};

/**
 * Translate a static UI key to the given language code.
 * Falls back to English, then to the key itself.
 */
export function t(key: I18nKey, langCode: string): string {
  const map = TR[key];
  if (!map) return key;
  return map[langCode] ?? map['en'] ?? key;
}
