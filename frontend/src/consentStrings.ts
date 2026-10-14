// Privacy notice content imported from dhara_consent_strings.json.
// Keep the type aligned with the content keys: undefined labels block onboarding.
import { indiaEntity } from './operatorIdentity';

export const CONSENT_NOTICE_VERSION = "2026-10-01";

export type ConsentLang = {
  lang_code?: string;
  title: string; intro: string; collect_heading: string;
  collect_items: string[]; not_do_heading: string; not_do_items: string[];
  storage: string; rights_heading: string; rights_body: string;
  grievance: string; age_label: string;
  age_under_label: string; age_under_message: string;
  terms_checkbox: string; data_checkbox: string;
  optional_heading: string; optional_analytics: string; optional_updates: string;
  continue_button: string; read_full: string; disclaimer: string;
};

export const CONSENT_META = {"notice_version": "2026-10-01", "owner_india": indiaEntity, "status": "DRAFT - English reviewed for content; Hindi and Marathi need native-speaker check; all versions need privacy counsel review before launch", "placeholders": ["{{GRIEVANCE_OFFICER_NAME}}", "{{GRIEVANCE_EMAIL}}", "{{DATA_LOCATION}}"]} as const;

export const consentStrings: Record<string, ConsentLang> = {
  "en": {
    "title": "Your privacy",
    "intro": "Dhara helps you understand your legal rights and prepare a police complaint draft. To do this, we need some information from you. Here is what we collect and why.",
    "collect_heading": "What we collect and why",
    "collect_items": [
      "Your phone number and name - to log you in and keep your account safe.",
      "Your questions and voice recordings - to understand and answer your legal questions. Voice is turned into text and the recording is not kept.",
      "Complaint details you give us - names, dates, places and what happened - only to prepare your FIR draft.",
      "Payment details - handled by our payment partner. We do not store your card or UPI details."
    ],
    "not_do_heading": "What we never do",
    "not_do_items": [
      "We never sell your information.",
      "We never share your complaint with the police or anyone else. Only you decide whether to file it.",
      "We never use your complaint details to train AI models."
    ],
    "storage": "Your information is stored securely in {{DATA_LOCATION}} and kept only as long as needed. You can delete it at any time.",
    "rights_heading": "Your rights",
    "rights_body": "You can see, download, correct or delete your information, and withdraw your consent, from Profile > My Data. Withdrawing consent is as easy as giving it.",
    "grievance": "Questions or complaints: {{GRIEVANCE_OFFICER_NAME}}, Grievance Officer, {{GRIEVANCE_EMAIL}}. If you are not satisfied, you can complain to the Data Protection Board of India.",
    "age_label": "I am 18 years or older",
    "age_under_label": "I am under 18",
    "age_under_message": "Please ask a parent or guardian to help you set up Dhara. You can still use Emergency Helplines and Know Your Rights without an account.",
    "terms_checkbox": "I agree to the Terms of Use",
    "data_checkbox": "I agree to Dhara using my information as described above to answer my questions and prepare my complaint draft",
    "optional_heading": "Optional - you can say no",
    "optional_analytics": "Help improve Dhara by sharing anonymous usage information",
    "optional_updates": "Send me legal awareness tips and updates by SMS or WhatsApp",
    "continue_button": "Continue",
    "read_full": "Read full privacy policy",
    "disclaimer": "Dhara gives legal information, not legal advice."
  },
  "hi": {
    "title": "आपकी निजता",
    "intro": "धारा आपको अपने कानूनी अधिकार समझने और पुलिस शिकायत का मसौदा तैयार करने में मदद करता है। इसके लिए हमें आपसे कुछ जानकारी चाहिए। हम क्या लेते हैं और क्यों, यह नीचे बताया गया है।",
    "collect_heading": "हम क्या जानकारी लेते हैं और क्यों",
    "collect_items": [
      "आपका फ़ोन नंबर और नाम - आपको लॉग इन कराने और आपका खाता सुरक्षित रखने के लिए।",
      "आपके सवाल और आवाज़ - आपके कानूनी सवाल समझने और उनका जवाब देने के लिए। आवाज़ को लिखित शब्दों में बदला जाता है और रिकॉर्डिंग रखी नहीं जाती।",
      "शिकायत की जानकारी - नाम, तारीख, जगह और घटना - सिर्फ़ आपकी FIR का मसौदा बनाने के लिए।",
      "भुगतान की जानकारी - हमारा भुगतान साझेदार संभालता है। हम आपके कार्ड या UPI की जानकारी नहीं रखते।"
    ],
    "not_do_heading": "हम यह कभी नहीं करते",
    "not_do_items": [
      "हम आपकी जानकारी कभी नहीं बेचते।",
      "हम आपकी शिकायत पुलिस या किसी और को नहीं भेजते। उसे दर्ज करना है या नहीं, यह सिर्फ़ आप तय करते हैं।",
      "हम आपकी शिकायत की जानकारी से AI मॉडल को प्रशिक्षित नहीं करते।"
    ],
    "storage": "आपकी जानकारी {{DATA_LOCATION}} में सुरक्षित रखी जाती है और सिर्फ़ ज़रूरत तक रखी जाती है। आप इसे कभी भी मिटा सकते हैं।",
    "rights_heading": "आपके अधिकार",
    "rights_body": "प्रोफ़ाइल > मेरा डेटा में जाकर आप अपनी जानकारी देख, डाउनलोड, सुधार या मिटा सकते हैं, और अपनी सहमति वापस ले सकते हैं। सहमति वापस लेना उतना ही आसान है जितना देना।",
    "grievance": "सवाल या शिकायत: {{GRIEVANCE_OFFICER_NAME}}, शिकायत अधिकारी, {{GRIEVANCE_EMAIL}}। अगर आप संतुष्ट नहीं हैं, तो आप भारतीय डेटा संरक्षण बोर्ड से शिकायत कर सकते हैं।",
    "age_label": "मेरी उम्र 18 साल या उससे ज़्यादा है",
    "age_under_label": "मेरी उम्र 18 साल से कम है",
    "age_under_message": "कृपया धारा शुरू करने के लिए माता-पिता या अभिभावक की मदद लें। आपातकालीन हेल्पलाइन और अपने अधिकार जानें, बिना खाते के भी उपलब्ध हैं।",
    "terms_checkbox": "मैं उपयोग की शर्तों से सहमत हूँ",
    "data_checkbox": "मैं सहमत हूँ कि धारा ऊपर बताए अनुसार मेरी जानकारी का उपयोग मेरे सवालों के जवाब देने और शिकायत का मसौदा बनाने के लिए करे",
    "optional_heading": "वैकल्पिक - आप मना कर सकते हैं",
    "optional_analytics": "बिना पहचान वाली उपयोग जानकारी देकर धारा को बेहतर बनाने में मदद करें",
    "optional_updates": "मुझे SMS या WhatsApp पर कानूनी जागरूकता की जानकारी भेजें",
    "continue_button": "आगे बढ़ें",
    "read_full": "पूरी निजता नीति पढ़ें",
    "disclaimer": "धारा कानूनी जानकारी देता है, कानूनी सलाह नहीं।"
  },
  "mr": {
    "title": "तुमची गोपनीयता",
    "intro": "धारा तुम्हाला तुमचे कायदेशीर हक्क समजून घेण्यास आणि पोलीस तक्रारीचा मसुदा तयार करण्यास मदत करते. त्यासाठी आम्हाला तुमच्याकडून काही माहिती लागते. आम्ही काय घेतो आणि का, ते खाली दिले आहे.",
    "collect_heading": "आम्ही कोणती माहिती घेतो आणि का",
    "collect_items": [
      "तुमचा फोन नंबर आणि नाव - तुम्हाला लॉग इन करण्यासाठी आणि तुमचे खाते सुरक्षित ठेवण्यासाठी.",
      "तुमचे प्रश्न आणि आवाज - तुमचे कायदेशीर प्रश्न समजून उत्तर देण्यासाठी. आवाजाचे लिखित मजकुरात रूपांतर केले जाते आणि रेकॉर्डिंग ठेवले जात नाही.",
      "तक्रारीची माहिती - नावे, तारखा, ठिकाणे आणि घटना - फक्त तुमच्या FIR चा मसुदा तयार करण्यासाठी.",
      "पेमेंटची माहिती - आमचा पेमेंट भागीदार हाताळतो. आम्ही तुमच्या कार्ड किंवा UPI ची माहिती ठेवत नाही."
    ],
    "not_do_heading": "आम्ही हे कधीही करत नाही",
    "not_do_items": [
      "आम्ही तुमची माहिती कधीही विकत नाही.",
      "आम्ही तुमची तक्रार पोलिसांना किंवा इतर कोणालाही पाठवत नाही. ती दाखल करायची की नाही, हे फक्त तुम्ही ठरवता.",
      "आम्ही तुमच्या तक्रारीच्या माहितीने AI मॉडेलला प्रशिक्षण देत नाही."
    ],
    "storage": "तुमची माहिती {{DATA_LOCATION}} येथे सुरक्षितपणे ठेवली जाते आणि फक्त गरज असेपर्यंत ठेवली जाते. तुम्ही ती कधीही हटवू शकता.",
    "rights_heading": "तुमचे हक्क",
    "rights_body": "प्रोफाइल > माझा डेटा येथे जाऊन तुम्ही तुमची माहिती पाहू, डाउनलोड करू, दुरुस्त करू किंवा हटवू शकता, आणि तुमची संमती मागे घेऊ शकता. संमती मागे घेणे ती देण्याइतकेच सोपे आहे.",
    "grievance": "प्रश्न किंवा तक्रार: {{GRIEVANCE_OFFICER_NAME}}, तक्रार निवारण अधिकारी, {{GRIEVANCE_EMAIL}}. तुमचे समाधान न झाल्यास तुम्ही भारतीय डेटा संरक्षण मंडळाकडे तक्रार करू शकता.",
    "age_label": "माझे वय 18 वर्षे किंवा त्याहून अधिक आहे",
    "age_under_label": "माझे वय 18 वर्षांपेक्षा कमी आहे",
    "age_under_message": "धारा सुरू करण्यासाठी कृपया आई-वडील किंवा पालकांची मदत घ्या. आपत्कालीन हेल्पलाइन आणि तुमचे हक्क जाणा, खात्याशिवायही उपलब्ध आहेत.",
    "terms_checkbox": "मी वापराच्या अटींशी सहमत आहे",
    "data_checkbox": "वर सांगितल्याप्रमाणे माझ्या प्रश्नांची उत्तरे देण्यासाठी आणि तक्रारीचा मसुदा तयार करण्यासाठी धाराने माझी माहिती वापरण्यास मी सहमत आहे",
    "optional_heading": "ऐच्छिक - तुम्ही नकार देऊ शकता",
    "optional_analytics": "ओळख न पटणारी वापर माहिती देऊन धारा सुधारण्यास मदत करा",
    "optional_updates": "मला SMS किंवा WhatsApp वर कायदेशीर जागरूकतेची माहिती पाठवा",
    "continue_button": "पुढे चला",
    "read_full": "संपूर्ण गोपनीयता धोरण वाचा",
    "disclaimer": "धारा कायदेशीर माहिती देते, कायदेशीर सल्ला नाही."
  }
};
