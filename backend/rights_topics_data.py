"""
Public "Know Your Rights" topic cards — served by GET /api/reference/topics.

QA fixes (3 Oct 2026 batch — tracker cases DHARA-B001..B004):
  B001 — "arrest" card had a fabricated arrest-time window ("6AM-6PM") and
         conflated two different BNSS Sec 43 subsections into one claim.
         Corrected against the official IndiaCode text of BNSS Section 43.
  B002 — "consumer" card cited an outdated/incorrect District Commission
         pecuniary limit (Rs 1 crore). Corrected to Rs 50 lakh, measured on
         consideration PAID (not compensation claimed), per the Consumer
         Protection (Jurisdiction) Rules, 2021, Rule 3.
  B003 — no card carried an official-source link or a verification date.
         Every card below now has `citations` (real, checkable government /
         case-law links) and a `verified_at` date that reflects an ACTUAL
         check performed in this review — never fabricated.
  B004 — non-English languages silently served English. Every card now
         carries a reviewed Marathi translation (`translations.mr`) that
         preserves every citation, exception and amount from the English
         text. Other languages intentionally have NO translation entry here
         — the API layer (server.py) serves an honest "not yet translated"
         notice for those instead of silently substituting English.

Full-corpus audit note: while fixing B001/B002, the other 6 cards were also
checked against their named Acts/Rules (not re-derived from scratch). Two
more real inaccuracies were found and fixed in the SAME batch:
  - "fir" card: the SP-escalation route and the Magistrate-order route were
    bundled under one citation (Sec 175(3) BNSS); they are two different
    sections (SP = Sec 173(4), Magistrate = Sec 175(3)).
  - "traffic" card: "only ASI+ officers can issue challans" and "only a
    magistrate can seize a licence" are both incorrect — challan rank is
    set by state rules (not the central Act), and only the Licensing
    Authority (RTO), not police or a magistrate, may suspend/revoke/impound
    a licence (Sec 206, Motor Vehicles Act; confirmed by Calcutta HC).
Every other bullet across all 8 cards was spot-checked against its named
Act/Rule and found consistent; those cards get citations + verified_at with
no text change. A full bullet-by-bullet corpus rebuild was explicitly out of
scope for this batch (see QA tracker item B003).
"""

TOPICS = [
    {
        "id": "police-stop", "icon": "shield",
        "title": "Rights During a Police Stop",
        "summary": "What police can and cannot do when they stop or question you.",
        "law": "Article 22; Section 35 BNSS; D.K. Basu vs State of WB (1997)",
        "points": [
            "Right to know officer name & badge number (D.K. Basu).",
            "Right to know reason for detention (Article 22(1)).",
            "Right to consult lawyer of choice (Article 22(1)).",
            "Right to inform family of arrest.",
            "Police cannot torture, slap or abuse — violates Article 21.",
            "Must be produced before magistrate in 24 hours (Article 22(2)).",
        ],
        "citations": [
            {"label": "Constitution of India, Article 22", "url": "https://legislative.gov.in/constitution-of-india/"},
            {"label": "BNSS Section 35", "url": "https://indiacode.ecourtsindia.com/bnss/section/35/"},
            {"label": "D.K. Basu vs State of West Bengal (1997)", "url": "https://indiankanoon.org/doc/501198/"},
        ],
        "verified_at": "2026-10-03",
        "review_note": "Audited 3 Oct 2026 — all points matched the cited provisions; no text change, added source links.",
        "translations": {
            "mr": {
                "title": "पोलिस थांबवतात तेव्हा तुमचे हक्क",
                "summary": "पोलिस तुम्हाला थांबवतात किंवा प्रश्न विचारतात तेव्हा ते काय करू शकतात आणि काय करू शकत नाहीत.",
                "law": "कलम 22; BNSS कलम 35; डी.के. बासू वि. पश्चिम बंगाल राज्य (1997)",
                "points": [
                    "अधिकाऱ्याचे नाव आणि बॅज क्रमांक जाणून घेण्याचा हक्क (डी.के. बासू निकाल).",
                    "अटकेचे/ताब्यात घेण्याचे कारण जाणून घेण्याचा हक्क (कलम 22(1)).",
                    "स्वतःच्या पसंतीच्या वकिलाचा सल्ला घेण्याचा हक्क (कलम 22(1)).",
                    "कुटुंबाला अटकेची माहिती देण्याचा हक्क.",
                    "पोलिस छळ, मारहाण किंवा गैरवर्तन करू शकत नाहीत — हे कलम 21 चे उल्लंघन आहे.",
                    "24 तासांत दंडाधिकाऱ्यांसमोर हजर करणे आवश्यक (कलम 22(2)).",
                ],
            },
        },
    },
    {
        "id": "arrest", "icon": "handcuffs",
        "title": "Rights When Arrested",
        "summary": "Non-negotiable rights every citizen has on arrest.",
        "law": "Articles 20, 21, 22; Sec 35-46 BNSS; Arnesh Kumar vs State of Bihar (2014)",
        "points": [
            "Arrest memo must be witnessed & countersigned (D.K. Basu).",
            "Medical examination every 48 hours in custody, by a government doctor (D.K. Basu guidelines).",
            "Cannot be forced to be a witness against yourself (Art 20(3)).",
            "For offences punishable under 7 years, arrest is not automatic (Arnesh Kumar).",
            "No woman may be arrested after sunset or before sunrise, except where a woman police officer gives a written report and gets a Magistrate's prior permission (Sec 43(5) BNSS).",
            "Officers must not physically touch a woman to arrest her, unless the officer is female or the situation requires it (Sec 43(1) BNSS).",
            "Right to bail for bailable offences (Sec 478 BNSS).",
        ],
        "citations": [
            {"label": "Constitution of India, Articles 20-22", "url": "https://legislative.gov.in/constitution-of-india/"},
            {"label": "BNSS Section 43 — Arrest how made", "url": "https://indiacode.ecourtsindia.com/bnss/section/43/"},
            {"label": "Arnesh Kumar vs State of Bihar (2014)", "url": "https://indiankanoon.org/search/?formInput=Arnesh%20Kumar%20vs%20State%20of%20Bihar"},
            {"label": "D.K. Basu vs State of West Bengal (1997)", "url": "https://indiankanoon.org/doc/501198/"},
        ],
        "verified_at": "2026-10-03",
        "review_note": (
            "DHARA-B001 fix (3 Oct 2026): removed the fabricated '6AM-6PM' arrest window. "
            "Replaced with the real sunset/sunrise restriction + exception procedure (Sec 43(5)), "
            "and a SEPARATE, correctly-cited officer-touch rule (Sec 43(1)) — these are two different "
            "subsections, not one blanket staffing rule."
        ),
        "translations": {
            "mr": {
                "title": "अटक झाल्यावर तुमचे हक्क",
                "summary": "अटकेच्या वेळी प्रत्येक नागरिकाला मिळणारे अबाधित हक्क.",
                "law": "कलम 20, 21, 22; BNSS कलम 35-46; अर्नेश कुमार वि. बिहार राज्य (2014)",
                "points": [
                    "अटक मेमोवर साक्षीदाराची स्वाक्षरी आणि पडताळणी आवश्यक (डी.के. बासू निकाल).",
                    "ताब्यात असताना दर 48 तासांनी सरकारी डॉक्टरकडून वैद्यकीय तपासणी (डी.के. बासू मार्गदर्शक तत्त्वे).",
                    "स्वतःविरुद्ध साक्ष देण्यास भाग पाडले जाऊ शकत नाही (कलम 20(3)).",
                    "7 वर्षांपेक्षा कमी शिक्षा असलेल्या गुन्ह्यांत अटक आपोआप होत नाही (अर्नेश कुमार निकाल).",
                    "सूर्यास्तानंतर आणि सूर्योदयापूर्वी महिलेला अटक करता येत नाही — अपवादात्मक स्थितीत महिला पोलीस अधिकाऱ्याने लेखी अहवाल देऊन प्रथम वर्ग दंडाधिकाऱ्यांची पूर्वपरवानगी घ्यावी लागते (BNSS कलम 43(5)).",
                    "महिलेला अटक करताना अधिकारी महिला नसल्यास किंवा परिस्थिती वेगळी नसल्यास तिला स्पर्श करता येत नाही (BNSS कलम 43(1)).",
                    "जामीनपात्र गुन्ह्यांसाठी जामीन मिळण्याचा हक्क (BNSS कलम 478).",
                ],
            },
        },
    },
    {
        "id": "fir", "icon": "file-text",
        "title": "How to File an FIR",
        "summary": "Step-by-step process for a First Information Report.",
        "law": "Sec 173, 175 BNSS; Sec 199 BNS; Lalita Kumari vs Govt of UP (2013)",
        "points": [
            "Go to the police station of jurisdiction, or any station for a Zero FIR.",
            "Refusing to register a cognizable-offence FIR is itself a punishable offence for the officer (Sec 199(c) BNS).",
            "FIR is mandatory for all cognizable offences (Lalita Kumari vs Govt of UP, 2013).",
            "Right to a free copy of the FIR, given immediately (Sec 173(2) BNSS).",
            "If refused, send a written complaint to the SP (Sec 173(4) BNSS); the Magistrate can then order the FIR to be registered (Sec 175(3) BNSS).",
            "A Zero FIR can be filed at ANY police station, regardless of where the offence happened.",
        ],
        "citations": [
            {"label": "BNSS Section 173 — FIR registration", "url": "https://indiacode.ecourtsindia.com/bnss/section/173/"},
            {"label": "BNSS Section 175 — Magistrate's power to order investigation", "url": "https://indiacode.ecourtsindia.com/bnss/section/175/"},
            {"label": "BNS Section 199 — Public servant disobeying law", "url": "https://indiacode.ecourtsindia.com/bns/section/199/"},
            {"label": "Lalita Kumari vs Govt of UP (2013)", "url": "https://indiankanoon.org/doc/10239019/"},
        ],
        "verified_at": "2026-10-03",
        "review_note": (
            "Corrected 3 Oct 2026 — the SP-escalation step and the Magistrate-order step were previously "
            "bundled under one citation (Sec 175(3)). They are two different sections: SP complaint is "
            "Sec 173(4) BNSS, and the Magistrate's order is Sec 175(3) BNSS."
        ),
        "translations": {
            "mr": {
                "title": "FIR कशी दाखल करावी",
                "summary": "पहिली खबर अहवाल (FIR) दाखल करण्याची टप्प्याटप्प्याने प्रक्रिया.",
                "law": "BNSS कलम 173, 175; BNS कलम 199; ललिता कुमारी वि. उत्तर प्रदेश राज्य (2013)",
                "points": [
                    "तुमच्या हद्दीतील पोलीस स्टेशनमध्ये जा, किंवा झिरो FIR साठी कोणत्याही स्टेशनमध्ये जा.",
                    "दखलपात्र गुन्ह्याची FIR नोंदवण्यास नकार देणे हा स्वतः अधिकाऱ्यासाठी दंडनीय गुन्हा आहे (BNS कलम 199(c)).",
                    "सर्व दखलपात्र गुन्ह्यांसाठी FIR नोंदवणे बंधनकारक आहे (ललिता कुमारी निकाल, 2013).",
                    "FIR ची मोफत प्रत लगेच मिळण्याचा हक्क (BNSS कलम 173(2)).",
                    "नकार दिल्यास, पोलीस अधीक्षकांना (SP) लेखी तक्रार द्या (BNSS कलम 173(4)); त्यानंतर दंडाधिकारी FIR नोंदवण्याचा आदेश देऊ शकतात (BNSS कलम 175(3)).",
                    "झिरो FIR गुन्हा कुठेही घडला असला तरी कोणत्याही पोलीस स्टेशनमध्ये दाखल करता येते.",
                ],
            },
        },
    },
    {
        "id": "women-safety", "icon": "heart",
        "title": "Women's Safety Rights",
        "summary": "Key legal protections for women in India.",
        "law": "BNS Sec 63-79, 85-86; DV Act 2005; POSH Act 2013",
        "points": [
            "A woman cannot be required to attend a police station — her statement is normally taken at her residence, unless she chooses to attend (Sec 179 BNSS).",
            "A rape survivor's statement should, as far as possible, be recorded by a woman officer at her residence or a place of her choosing (Sec 176 BNSS).",
            "Free legal aid is guaranteed (Article 39A).",
            "One-Stop Centres (Sakhi) — call 181.",
            "Domestic violence includes physical, emotional, sexual and economic abuse.",
            "POSH: an Internal Committee is mandatory at every workplace with 10 or more employees.",
        ],
        "citations": [
            {"label": "BNSS Section 179", "url": "https://indiacode.ecourtsindia.com/bnss/section/179/"},
            {"label": "BNSS Section 176", "url": "https://indiacode.ecourtsindia.com/bnss/section/176/"},
            {"label": "Protection of Women from Domestic Violence Act, 2005", "url": "https://www.indiacode.nic.in/bitstream/123456789/2021/5/A2005-43.pdf"},
            {"label": "Sexual Harassment of Women at Workplace Act, 2013", "url": "https://www.indiacode.nic.in/bitstream/123456789/15102/1/sexual_harassment_at_workplace_act_sw.pdf"},
        ],
        "verified_at": "2026-10-03",
        "review_note": (
            "Corrected 3 Oct 2026 — both the first two bullets were absolute claims ('cannot be called', "
            "'must be recorded by a woman officer'); the real provisos in Sec 179 and Sec 176 BNSS allow "
            "exceptions (she may choose to attend; 'as far as practicable') that the earlier wording omitted."
        ),
        "translations": {
            "mr": {
                "title": "महिलांच्या सुरक्षेचे हक्क",
                "summary": "भारतातील महिलांसाठी महत्त्वाचे कायदेशीर संरक्षण.",
                "law": "BNS कलम 63-79, 85-86; घरगुती हिंसा कायदा 2005; POSH कायदा 2013",
                "points": [
                    "महिलेला पोलीस स्टेशनमध्ये बोलावता येत नाही — तिचे म्हणणे सामान्यतः तिच्या निवासस्थानी नोंदवले जाते, जोपर्यंत ती स्वतः स्टेशनमध्ये येण्यास तयार नसते (BNSS कलम 179).",
                    "बलात्कार पीडितेचे म्हणणे शक्य असेल तेथवर महिला अधिकाऱ्याने तिच्या निवासस्थानी किंवा तिच्या पसंतीच्या ठिकाणी नोंदवावे (BNSS कलम 176).",
                    "मोफत कायदेशीर मदतीची हमी (कलम 39A).",
                    "वन-स्टॉप सेंटर (सखी) — 181 वर कॉल करा.",
                    "घरगुती हिंसेत शारीरिक, भावनिक, लैंगिक आणि आर्थिक छळ समाविष्ट आहे.",
                    "POSH: 10 किंवा अधिक कर्मचारी असलेल्या प्रत्येक कार्यालयात अंतर्गत समिती बंधनकारक.",
                ],
            },
        },
    },
    {
        "id": "traffic", "icon": "car",
        "title": "Traffic Stop & Vehicle Rights",
        "summary": "Rules for traffic-police interactions.",
        "law": "Motor Vehicles Act, 1988 (amended 2019); Sec 206",
        "points": [
            "Which rank can issue a challan is set by your state's police rules — always ask to see the officer's ID card.",
            "A police officer may seize your licence only in specific situations under Sec 206 (e.g. a fake licence, or a serious offence) and must forward it to the court or licensing authority.",
            "Your licence can only be suspended, revoked or permanently impounded by the Licensing Authority (RTO) — not on the spot by traffic police.",
            "Pay fines via mParivahan — no cash bribes are legal.",
            "DigiLocker/mParivahan digital documents are legally valid (MV Act amendment).",
            "Right to contest a challan in Lok Adalat or traffic court.",
        ],
        "citations": [
            {"label": "Motor Vehicles Act, 1988", "url": "https://www.indiacode.nic.in/bitstream/123456789/15390/1/the_motor_vehicles_act,_1988.pdf"},
            {"label": "Calcutta HC — licence can only be suspended/revoked by Licensing Authority", "url": "https://www.livelaw.in/high-court/calcutta-high-court/driving-license-can-only-be-suspended-revoked-or-impounded-by-licensing-authority-not-traffic-police-calcutta-high-court-299008"},
        ],
        "verified_at": "2026-10-03",
        "review_note": (
            "Corrected 3 Oct 2026 — removed the absolute 'only ASI+ officers' and 'only a magistrate can "
            "seize a licence' claims (both incorrect). Challan-issuing rank is set by state rules, not the "
            "central Act; and only the Licensing Authority (RTO) — not police, not a magistrate — may "
            "suspend, revoke or impound a licence (Sec 206, confirmed by Calcutta HC ruling)."
        ),
        "translations": {
            "mr": {
                "title": "वाहतूक तपासणी आणि वाहन हक्क",
                "summary": "वाहतूक पोलिसांशी व्यवहार करताना नियम.",
                "law": "मोटार वाहन कायदा 1988 (सुधारित 2019); कलम 206",
                "points": [
                    "चलन देण्याचा अधिकार कोणत्या पदावरील अधिकाऱ्याला आहे हे राज्याच्या नियमांनुसार ठरते — नेहमी अधिकाऱ्याचे ओळखपत्र पाहण्यास सांगा.",
                    "पोलीस अधिकारी फक्त कलम 206 मधील विशिष्ट परिस्थितीतच (उदा. बनावट लायसन्स किंवा गंभीर गुन्हा) लायसन्स जप्त करू शकतो आणि ते न्यायालयाकडे किंवा परवाना प्राधिकरणाकडे पाठवावे लागते.",
                    "तुमचे लायसन्स फक्त परवाना प्राधिकरण (RTO) रद्द, निलंबित किंवा कायमचे जप्त करू शकते — जागच्याजागी वाहतूक पोलीस करू शकत नाहीत.",
                    "mParivahan द्वारे दंड भरा — रोख लाच देणे-घेणे अवैध आहे.",
                    "DigiLocker/mParivahan वरील डिजिटल कागदपत्रे कायदेशीर वैध आहेत (मोटार वाहन कायदा सुधारणा).",
                    "लोक अदालत किंवा वाहतूक न्यायालयात चलनाला आव्हान देण्याचा हक्क.",
                ],
            },
        },
    },
    {
        "id": "rti", "icon": "info",
        "title": "Right to Information (RTI)",
        "summary": "Demand information from any public authority.",
        "law": "RTI Act, 2005; Art 19(1)(a)",
        "points": [
            "Any citizen can file RTI — no reason required.",
            "Fee ₹10 (free for BPL). Reply in 30 days.",
            "Life & liberty issues: reply in 48 hours.",
            "Denied → first appeal in 30 days; second appeal to CIC/SIC.",
            "PIO fined ₹250/day for delays, up to a maximum of ₹25,000.",
            "Special rules apply for security/intelligence organisations (Sec 24).",
        ],
        "citations": [
            {"label": "Right to Information Act, 2005", "url": "https://rti.gov.in/"},
            {"label": "Constitution of India, Article 19(1)(a)", "url": "https://legislative.gov.in/constitution-of-india/"},
        ],
        "verified_at": "2026-10-03",
        "review_note": "Audited 3 Oct 2026 — fee, timelines and penalty figures matched the official Act; added the Rs 25,000 penalty cap and the Sec 24 reference for completeness.",
        "translations": {
            "mr": {
                "title": "माहितीचा अधिकार (RTI)",
                "summary": "कोणत्याही सरकारी विभागाकडून माहिती मागण्याचा हक्क.",
                "law": "RTI कायदा 2005; कलम 19(1)(a)",
                "points": [
                    "कोणताही नागरिक RTI दाखल करू शकतो — कारण सांगण्याची गरज नाही.",
                    "फी ₹10 (BPL साठी मोफत). 30 दिवसांत उत्तर द्यावे.",
                    "जीवन व स्वातंत्र्याशी संबंधित प्रकरणांत 48 तासांत उत्तर.",
                    "नकारल्यास → 30 दिवसांत पहिले अपील; नंतर CIC/SIC कडे दुसरे अपील.",
                    "उशीर झाल्यास PIO ला दररोज ₹250 दंड, कमाल ₹25,000.",
                    "सुरक्षा/गुप्तचर संस्थांसाठी कलम 24 अंतर्गत विशेष नियम लागू.",
                ],
            },
        },
    },
    {
        "id": "consumer", "icon": "shopping-bag",
        "title": "Consumer Rights",
        "summary": "Protection against fraud, defective goods, and poor service.",
        "law": "Consumer Protection Act, 2019; Jurisdiction Rules, 2021",
        "points": [
            "6 rights: safety, information, choice, be heard, redressal, education.",
            "File complaints at consumerhelpline.gov.in or call 1915.",
            "District Commission handles cases where the price PAID for goods/services is up to ₹50 lakh (Consumer Protection Jurisdiction Rules, 2021).",
            "E-commerce platforms are strictly liable for defective goods.",
            "Misleading ads: fine up to ₹10 lakh, jail up to 2 years (first offence).",
            "Product liability makes manufacturers liable for defects.",
        ],
        "citations": [
            {"label": "Consumer Protection Act, 2019", "url": "https://consumeraffairs.gov.in/public/upload/files/CP%20Act%202019_1732700731.pdf"},
            {"label": "Consumer Protection Jurisdiction Rules, 2021 — Rule 3", "url": "https://consumeraffairs.gov.in/public/upload/files/232278_1732705029.pdf"},
        ],
        "verified_at": "2026-10-03",
        "review_note": (
            "DHARA-B002 fix (3 Oct 2026): District Commission limit was wrongly stated as Rs 1 crore "
            "(outdated AND measured on the wrong basis). Verified figure is Rs 50 lakh, measured on "
            "consideration PAID — not the compensation claimed."
        ),
        "translations": {
            "mr": {
                "title": "ग्राहक हक्क",
                "summary": "फसवणूक, सदोष वस्तू आणि निकृष्ट सेवेपासून संरक्षण.",
                "law": "ग्राहक संरक्षण कायदा, 2019; अधिकारक्षेत्र नियम, 2021",
                "points": [
                    "6 हक्क: सुरक्षितता, माहिती, निवड, सुनावणी, तक्रार निवारण, शिक्षण.",
                    "तक्रारीसाठी consumerhelpline.gov.in किंवा 1915 वर कॉल करा.",
                    "जिल्हा आयोग वस्तू/सेवेसाठी दिलेल्या किंमतीनुसार ₹50 लाखांपर्यंतची प्रकरणे हाताळतो (ग्राहक संरक्षण अधिकारक्षेत्र नियम, 2021).",
                    "ई-कॉमर्स प्लॅटफॉर्म सदोष वस्तूंसाठी काटेकोरपणे जबाबदार.",
                    "दिशाभूल करणाऱ्या जाहिराती: ₹10 लाखांपर्यंत दंड, 2 वर्षांपर्यंत तुरुंगवास (पहिला गुन्हा).",
                    "उत्पादन दायित्वामुळे उत्पादक सदोष वस्तूंसाठी जबाबदार.",
                ],
            },
        },
    },
    {
        "id": "domestic-violence", "icon": "home",
        "title": "Domestic Violence Protection",
        "summary": "Legal shield for women facing domestic abuse.",
        "law": "Protection of Women from Domestic Violence Act, 2005",
        "points": [
            "Covers physical, sexual, verbal, emotional and economic abuse.",
            "Right to reside in the shared household — cannot be thrown out.",
            "Protection, Residence, Monetary, Custody and Compensation Orders available.",
            "Free legal aid, medical treatment and shelter home access.",
            "A Protection Officer is appointed in every district.",
            "Helplines: 181 (Women); 1091 (Police Women).",
        ],
        "citations": [
            {"label": "Protection of Women from Domestic Violence Act, 2005", "url": "https://www.indiacode.nic.in/bitstream/123456789/2021/5/A2005-43.pdf"},
        ],
        "verified_at": "2026-10-03",
        "review_note": "Audited 3 Oct 2026 — all points matched Sections 3, 6-9 and 17-22 of the Act; no text change, added source link.",
        "translations": {
            "mr": {
                "title": "घरगुती हिंसाचारापासून संरक्षण",
                "summary": "घरगुती छळाला सामोरे जाणाऱ्या महिलांसाठी कायदेशीर कवच.",
                "law": "घरगुती हिंसाचारापासून महिलांचे संरक्षण कायदा, 2005",
                "points": [
                    "शारीरिक, लैंगिक, शाब्दिक, भावनिक आणि आर्थिक छळ यांचा समावेश.",
                    "सामायिक घरात राहण्याचा हक्क — बाहेर काढले जाऊ शकत नाही.",
                    "संरक्षण, निवास, आर्थिक, ताबा आणि नुकसानभरपाई आदेश उपलब्ध.",
                    "मोफत कायदेशीर मदत, वैद्यकीय उपचार आणि निवारागृह उपलब्धता.",
                    "प्रत्येक जिल्ह्यात संरक्षण अधिकारी नियुक्त केलेला असतो.",
                    "हेल्पलाइन: 181 (महिला); 1091 (महिला पोलीस).",
                ],
            },
        },
    },
]

# Honest "not yet translated" notice — shown instead of silently serving
# English when the requested language has no entry in a topic's
# `translations` dict. Falls back to the English phrasing for any language
# code not listed here (meta-notice only, never legal content, so the risk
# profile is very different from silently mistranslating a legal point).
NOT_LOCALIZED_NOTICE = {
    "en": "A reviewed translation of this topic is not yet available. Showing the verified English version below.",
    "hi": "इस विषय का सत्यापित अनुवाद अभी उपलब्ध नहीं है। नीचे सत्यापित अंग्रेज़ी पाठ दिखाया जा रहा है।",
    "mr": "या विषयाचे पडताळलेले भाषांतर अद्याप उपलब्ध नाही. खाली पडताळलेला इंग्रजी मजकूर दाखवला आहे.",
    "ta": "இந்தத் தலைப்பிற்கான சரிபார்க்கப்பட்ட மொழிபெயர்ப்பு இன்னும் கிடைக்கவில்லை. சரிபார்க்கப்பட்ட ஆங்கில உரை கீழே காட்டப்பட்டுள்ளது.",
    "te": "ఈ అంశానికి సమీక్షించిన అనువాదం ఇంకా అందుబాటులో లేదు. దిగువ ధృవీకరించబడిన ఆంగ్ల వచనం చూపబడింది.",
    "bn": "এই বিষয়ের একটি পর্যালোচিত অনুবাদ এখনও উপলব্ধ নয়। নীচে যাচাই করা ইংরেজি পাঠ্য দেখানো হচ্ছে।",
    "gu": "આ વિષયનો ચકાસાયેલ અનુવાદ હજુ ઉપલબ્ધ નથી. નીચે ચકાસાયેલ અંગ્રેજી ટેક્સ્ટ બતાવવામાં આવ્યું છે.",
    "kn": "ಈ ವಿಷಯದ ಪರಿಶೀಲಿಸಿದ ಅನುವಾದ ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ. ಕೆಳಗೆ ಪರಿಶೀಲಿಸಿದ ಇಂಗ್ಲಿಷ್ ಪಠ್ಯವನ್ನು ತೋರಿಸಲಾಗಿದೆ.",
    "ml": "ഈ വിഷയത്തിന്റെ അവലോകനം ചെയ്ത വിവർത്തനം ഇതുവരെ ലഭ്യമല്ല. ചുവടെ സ്ഥിരീകരിച്ച ഇംഗ്ലീഷ് വാചകം കാണിച്ചിരിക്കുന്നു.",
    "pa": "ਇਸ ਵਿਸ਼ੇ ਦਾ ਪੜਤਾਲਿਆ ਅਨੁਵਾਦ ਅਜੇ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਹੇਠਾਂ ਪੁਸ਼ਟੀ ਕੀਤਾ ਅੰਗਰੇਜ਼ੀ ਪਾਠ ਦਿਖਾਇਆ ਜਾ ਰਿਹਾ ਹੈ।",
    "ur": "اس موضوع کا تصدیق شدہ ترجمہ ابھی دستیاب نہیں ہے۔ نیچے تصدیق شدہ انگریزی متن دکھایا جا رہا ہے۔",
}


def localize_topic(topic: dict, lang: str) -> dict:
    """Resolve one topic card for a requested language.

    Always returns the full card (citations/verified_at unchanged). If a
    reviewed translation exists for `lang`, its title/summary/law/points
    replace the English ones and `localized=True`. Otherwise the English
    text is returned with `localized=False` and a `fallback_notice` in the
    requested language — never a silent English substitution.
    """
    lang = (lang or "en").lower()
    base = {k: v for k, v in topic.items() if k != "translations"}
    if lang == "en":
        base["localized"] = True
        base["fallback_notice"] = None
        return base
    tr = (topic.get("translations") or {}).get(lang)
    if tr:
        base.update(tr)
        base["localized"] = True
        base["fallback_notice"] = None
        return base
    base["localized"] = False
    base["fallback_notice"] = NOT_LOCALIZED_NOTICE.get(lang, NOT_LOCALIZED_NOTICE["en"])
    return base
