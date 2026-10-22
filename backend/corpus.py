"""
DHARA CORPUS — verified statutory text.

Hand-curated, verbatim excerpts from official sources on indiacode.nic.in
(India Code portal, Ministry of Law and Justice, Government of India).

CITATION INTEGRITY RULE (see server.py):
- The LLM must NEVER emit section numbers or statutory text.
- Section numbers, official text, and source URLs are ONLY served from THIS file.
- The UI renders these fields from the retrieval result, never from model output.
- If a question does not match any entry, the LLM is instructed to REFUSE with
  "I cannot confirm this from the official text. Please consult an advocate."

Every entry MUST have:
  key            — stable identifier
  citation       — human-friendly citation (e.g. "BNSS Section 43(5)")
  short_label    — short label for chip UI (e.g. "BNSS 43(5)")
  official_text  — VERBATIM statutory text from indiacode.nic.in
  source_url     — direct link to indiacode.nic.in bill text
  verified_at    — YYYY-MM-DD date this entry was hand-verified
  scope_note     — one-sentence plain-language scope (used to preface answer)
  keywords       — retrieval keywords (lower-cased, punctuation-stripped)

DO NOT let the model paraphrase, expand, or invent new entries at runtime.
Adding new entries requires editing THIS file and re-verifying against indiacode.nic.in.
"""

CORPUS = [
    # -------------------- CONSTITUTION --------------------
    {
        "key": "const_art_20",
        "citation": "Constitution of India, Article 20",
        "short_label": "Article 20",
        "act": "Constitution",
        "official_text": (
            "(1) No person shall be convicted of any offence except for violation of a law "
            "in force at the time of the commission of the act charged as an offence, nor be "
            "subjected to a penalty greater than that which might have been inflicted under "
            "the law in force at the time of the commission of the offence.\n"
            "(2) No person shall be prosecuted and punished for the same offence more than once.\n"
            "(3) No person accused of any offence shall be compelled to be a witness against himself."
        ),
        "source_url": "https://www.indiacode.nic.in/coi-web/coi/COI.pdf",
        "verified_at": "2026-01-15",
        "scope_note": (
            "Article 20 protects you against (a) being punished under a law that did not exist when "
            "you did the act, (b) being tried twice for the same crime, and (c) being forced to give "
            "evidence against yourself."
        ),
        "keywords": [
            "article 20", "art 20", "ex post facto", "self incrimination", "double jeopardy",
            "same offence twice", "forced confession", "witness against himself", "protection conviction",
        ],
    },
    {
        "key": "const_art_21",
        "citation": "Constitution of India, Article 21",
        "short_label": "Article 21",
        "act": "Constitution",
        "official_text": (
            "No person shall be deprived of his life or personal liberty except according to "
            "procedure established by law."
        ),
        "source_url": "https://www.indiacode.nic.in/coi-web/coi/COI.pdf",
        "verified_at": "2026-01-15",
        "scope_note": (
            "Article 21 protects your life and personal liberty. Nobody — including the State — "
            "can take these away unless a proper law and a fair procedure allow it."
        ),
        "keywords": [
            "article 21", "art 21", "right to life", "personal liberty", "life and liberty",
            "procedure established by law", "dignity", "privacy", "puttaswamy",
        ],
    },
    {
        "key": "const_art_22",
        "citation": "Constitution of India, Article 22",
        "short_label": "Article 22",
        "act": "Constitution",
        "official_text": (
            "(1) No person who is arrested shall be detained in custody without being informed, "
            "as soon as may be, of the grounds for such arrest nor shall he be denied the right to "
            "consult, and to be defended by, a legal practitioner of his choice.\n"
            "(2) Every person who is arrested and detained in custody shall be produced before the "
            "nearest magistrate within a period of twenty-four hours of such arrest excluding the "
            "time necessary for the journey from the place of arrest to the court of the magistrate "
            "and no such person shall be detained in custody beyond the said period without the "
            "authority of a magistrate."
        ),
        "source_url": "https://www.indiacode.nic.in/coi-web/coi/COI.pdf",
        "verified_at": "2026-01-15",
        "scope_note": (
            "If you are arrested, Article 22(1) says you must be TOLD the reason and allowed to "
            "meet a lawyer, and 22(2) says you must be produced before a magistrate within 24 hours."
        ),
        "keywords": [
            "article 22", "art 22", "arrest rights", "grounds of arrest", "24 hours magistrate",
            "twenty-four hours", "right to lawyer on arrest", "produced before magistrate",
            "informed of arrest", "consult legal practitioner",
            # Conversational phrasings used by real users
            "my rights arrest", "rights when arrested", "rights during arrest",
            "rights if arrested", "police rights", "rights police",
            "right to remain silent", "remain silent police", "silent police",
            "lawyer during arrest", "lawyer after arrest", "call lawyer arrest",
            "detained police", "custody rights", "held by police",
        ],
    },
    # -------------------- BNSS 2023 (procedure) --------------------
    {
        "key": "bnss_35",
        "citation": "Bharatiya Nagarik Suraksha Sanhita 2023, Section 35 — When police may arrest without warrant",
        "short_label": "BNSS 35",
        "act": "BNSS",
        "official_text": (
            "(1) Any police officer may without an order from a Magistrate and without a warrant, arrest any person—\n"
            "(a) who commits, in the presence of a police officer, a cognizable offence;\n"
            "(b) against whom a reasonable complaint has been made, or credible information has "
            "been received, or a reasonable suspicion exists that he has committed a cognizable "
            "offence punishable with imprisonment for a term which may be less than seven years "
            "or which may extend to seven years whether with or without fine, if the following "
            "conditions are satisfied, namely:—\n"
            "  (i) the police officer has reason to believe on the basis of such complaint, "
            "information, or suspicion that such person has committed the said offence;\n"
            "  (ii) the police officer is satisfied that such arrest is necessary — [purposes "
            "including preventing further offence, proper investigation, preventing evidence "
            "tampering, preventing inducement of witnesses, or ensuring presence in court];\n"
            "and the police officer shall, while making such arrest, record his reasons in writing.\n"
            "Provided that a police officer shall, in all cases where the arrest of a person is not "
            "required under the provisions of this sub-section, record the reasons in writing for "
            "not making the arrest."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20099",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNSS 35 lists exactly when police can arrest you without a warrant. Even for a "
            "cognizable offence punishable up to 7 years, the police officer must have specific "
            "reasons AND must record those reasons in writing."
        ),
        "keywords": [
            "bnss 35", "section 35 bnss", "arrest without warrant", "warrantless arrest",
            "cognizable offence", "police arrest me", "arrested by police", "arrest procedure",
            "reasons in writing", "arnesh kumar",
            # Conversational phrasings — critical for real user queries
            "police stop", "police stopped me", "stopped by police", "police stop me",
            "police check", "police checkpoint", "police detained me", "police detain",
            "warrant needed", "need warrant", "arrest me warrant", "without warrant",
            "police powers arrest", "rights during police stop", "rights police stop",
        ],
    },
    {
        "key": "bnss_173",
        "citation": "Bharatiya Nagarik Suraksha Sanhita 2023, Section 173 — Information as to cognizable cases (FIR)",
        "short_label": "BNSS 173",
        "act": "BNSS",
        "official_text": (
            "(1) Every information relating to the commission of a cognizable offence, "
            "irrespective of the area where the offence is committed, may be given orally or "
            "by electronic communication to an officer in charge of a police station, and if "
            "given—\n"
            "(i) orally, it shall be reduced to writing by him or under his direction, and be "
            "read over to the informant; and every such information, whether given in writing "
            "or reduced to writing as aforesaid, shall be signed by the person giving it, and "
            "the substance thereof shall be entered in a book to be kept by such officer in "
            "such form as the State Government may by rules prescribe;\n"
            "(ii) by electronic communication, it shall be taken on record by him on being "
            "signed within three days by the person giving it.\n"
            "(2) A copy of the information as recorded under sub-section (1) shall be given "
            "forthwith, free of cost, to the informant."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20099",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNSS 173 governs the FIR (First Information Report). For any cognizable offence, "
            "the police station MUST record your complaint — orally or electronically — and "
            "give you a free copy immediately. Refusal to register an FIR is itself illegal."
        ),
        "keywords": [
            "bnss 173", "section 173 bnss", "fir", "file fir", "filing fir", "how to file fir",
            "how file fir", "lodge fir", "register fir", "first information report",
            "police complaint", "police station complaint", "report crime", "report to police",
            "refuse fir", "fir refused", "police refused fir", "zero fir", "online fir",
            "copy of fir", "free copy fir", "fir procedure", "fir cognizable",
        ],
    },
    {
        "key": "bnss_43_5",
        "citation": "Bharatiya Nagarik Suraksha Sanhita 2023, Section 43(5) — Arrest of a woman after sunset",
        "short_label": "BNSS 43(5)",
        "act": "BNSS",
        "official_text": (
            "Save in exceptional circumstances, no woman shall be arrested after sunset and "
            "before sunrise, and where such exceptional circumstances exist, the woman police "
            "officer shall, by making a written report, obtain the prior permission of the "
            "Judicial Magistrate of the first class within whose local jurisdiction the offence "
            "is committed or the arrest is to be made."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20099",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNSS 43(5) applies ONLY TO WOMEN. A woman generally cannot be arrested between "
            "sunset and sunrise. In exceptional cases, a woman police officer must first get "
            "written permission from a Judicial Magistrate. This is NOT a universal rule for all "
            "arrests — it protects women only."
        ),
        "keywords": [
            "bnss 43", "bnss 43(5)", "section 43 bnss", "arrest at night", "arrest after sunset",
            "no arrest at night", "woman arrest", "female arrest", "night arrest woman",
            "arrest sunset sunrise", "woman police officer arrest", "arrest at night woman",
            "daughter", "wife", "sister", "mother", "girlfriend", "girl", "lady", "ladies",
        ],
        # Gate: this section is ONLY about the TIMING of a woman's arrest. Without
        # either a direct label mention OR a real night-time signal, "arrest" +
        # "police" alone would also match a completely unrelated daytime arrest
        # question (e.g. "my daughter was arrested for shoplifting") — the
        # require_any pattern (already used for the RTI/helmet entries above)
        # stops that: no night-time evidence at all means this entry is skipped
        # entirely, not just scored low.
        "require_any": [
            "bnss 43", "43(5)", "section 43",
            "night", "sunset", "sunrise", "midnight",
            "6pm", "7pm", "8pm", "9pm", "10pm", "11pm", "12pm",
            "1am", "2am", "3am", "4am", "5am", "6am", "12am",
        ],
    },
    {
        "key": "bnss_47",
        "citation": "Bharatiya Nagarik Suraksha Sanhita 2023, Section 47 — Person arrested to be informed of grounds of arrest and of right to bail",
        "short_label": "BNSS 47",
        "act": "BNSS",
        "official_text": (
            "(1) Every police officer or other person arresting any person without warrant shall "
            "forthwith communicate to him full particulars of the offence for which he is arrested "
            "or other grounds for such arrest.\n"
            "(2) Where a police officer arrests without warrant any person other than a person accused "
            "of a non-bailable offence, he shall inform the person arrested that he is entitled to "
            "be released on bail and that he may arrange for sureties on his behalf."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20099",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNSS 47 says the arresting officer MUST immediately tell you (a) the full particulars "
            "of the offence and grounds, and (b) if it is a bailable offence, that you are entitled "
            "to bail and can arrange sureties."
        ),
        "keywords": [
            "bnss 47", "section 47 bnss", "grounds of arrest", "informed of arrest",
            "right to bail on arrest", "bailable offence", "sureties", "particulars of offence",
        ],
    },
    {
        "key": "bnss_48",
        "citation": "Bharatiya Nagarik Suraksha Sanhita 2023, Section 48 — Obligation of person making arrest to inform about the arrest to nominated person",
        "short_label": "BNSS 48",
        "act": "BNSS",
        "official_text": (
            "Every police officer or other person making any arrest under this Sanhita shall "
            "forthwith give the information regarding such arrest and place where the arrested "
            "person is being held to any of his relatives, friends or such other persons as may "
            "be disclosed or nominated by the arrested person for the purpose of giving such "
            "information."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20099",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNSS 48 gives you the right to have a relative, friend, or any person of your choice "
            "informed that you have been arrested and told where you are being held."
        ),
        "keywords": [
            "bnss 48", "section 48 bnss", "inform family arrest", "nominated person",
            "relative informed", "friend informed arrest", "where arrested held", "D.K. Basu",
        ],
    },
    # -------------------- BNS 2023 (offences) --------------------
    {
        "key": "bns_101",
        "citation": "Bharatiya Nyaya Sanhita 2023, Section 101 — Culpable homicide",
        "short_label": "BNS 101",
        "act": "BNS",
        "official_text": (
            "Whoever causes death by doing an act with the intention of causing death, or with the "
            "intention of causing such bodily injury as is likely to cause death, or with the "
            "knowledge that he is likely by such act to cause death, commits the offence of "
            "culpable homicide."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20063",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNS 101 defines culpable homicide — causing death with intention or with knowledge "
            "that the act is likely to cause death."
        ),
        "keywords": [
            "bns 101", "section 101 bns", "culpable homicide", "cause death", "intention to kill",
        ],
    },
    {
        "key": "bns_102",
        "citation": "Bharatiya Nyaya Sanhita 2023, Section 102 — Murder",
        "short_label": "BNS 102",
        "act": "BNS",
        "official_text": (
            "Except in the cases hereinafter excepted, culpable homicide is murder — if the act "
            "by which the death is caused is done with the intention of causing death; or if it "
            "is done with the intention of causing such bodily injury as the offender knows to be "
            "likely to cause the death of the person to whom the harm is caused; or if it is done "
            "with the intention of causing bodily injury to any person, and the bodily injury "
            "intended to be inflicted is sufficient in the ordinary course of nature to cause "
            "death; or if the person committing the act knows that it is so imminently dangerous "
            "that it must, in all probability, cause death, or such bodily injury as is likely to "
            "cause death, and commits such act without any excuse for incurring the risk."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20063",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNS 102 defines when culpable homicide becomes MURDER — broadly, when there is "
            "clear intention to cause death or a fatal injury, subject to specific exceptions."
        ),
        "keywords": ["bns 102", "section 102 bns", "murder", "culpable homicide murder"],
    },
    {
        "key": "bns_103",
        "citation": "Bharatiya Nyaya Sanhita 2023, Section 103 — Punishment for murder",
        "short_label": "BNS 103",
        "act": "BNS",
        "official_text": (
            "(1) Whoever commits murder shall be punished with death or imprisonment for life, "
            "and shall also be liable to fine.\n"
            "(2) When a group of five or more persons acting in concert commits murder on the "
            "ground of race, caste or community, sex, place of birth, language, personal belief "
            "or any other similar ground, each member of such group shall be punished with death "
            "or with imprisonment for life, and shall also be liable to fine."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/20063",
        "verified_at": "2026-01-15",
        "scope_note": (
            "BNS 103 sets the punishment for murder: death or life imprisonment plus fine. "
            "Sub-section (2) covers mob-lynching on discriminatory grounds with the same maximum."
        ),
        "keywords": [
            "bns 103", "section 103 bns", "punishment for murder", "murder punishment",
            "death penalty murder", "life imprisonment murder", "mob lynching",
        ],
    },
    # -------------------- Protection of Women from Domestic Violence Act 2005 --------------------
    {
        "key": "pwdva_3",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 3 — Definition of domestic violence",
        "short_label": "PWDVA 3",
        "act": "PWDVA",
        "official_text": (
            "For the purposes of this Act, any act, omission or commission or conduct of the "
            "respondent shall constitute domestic violence in case it— (a) harms or injures or "
            "endangers the health, safety, life, limb or well-being, whether mental or physical, "
            "of the aggrieved person or tends to do so and includes causing physical abuse, "
            "sexual abuse, verbal and emotional abuse and economic abuse; or (b) harasses, harms, "
            "injures or endangers the aggrieved person with a view to coerce her or any other "
            "person related to her to meet any unlawful demand for any dowry or other property or "
            "valuable security; or (c) has the effect of threatening the aggrieved person or any "
            "person related to her by any conduct mentioned in clause (a) or clause (b); or "
            "(d) otherwise injures or causes harm, whether physical or mental, to the aggrieved person."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "This law defines domestic violence broadly — it covers physical, sexual, verbal, "
            "emotional AND economic abuse, plus dowry-related harassment. Only women can file "
            "under this Act; the respondent is usually the husband or a male relative."
        ),
        "keywords": [
            "pwdva 3", "domestic violence", "wife beating", "husband abuse", "dowry harassment",
            "emotional abuse", "economic abuse", "verbal abuse", "physical abuse home",
            "in-laws harassment", "marital abuse", "domestic abuse",
            "husband beats", "husband hits", "husband harass", "husband abusive",
            "beats me", "hits me", "abusive husband", "abuse from husband",
        ],
    },
    {
        "key": "pwdva_12",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 12 — Application to Magistrate",
        "short_label": "PWDVA 12",
        "act": "PWDVA",
        "official_text": (
            "(1) An aggrieved person or a Protection Officer or any other person on behalf of the "
            "aggrieved person may present an application to the Magistrate seeking one or more "
            "reliefs under this Act: Provided that before passing any order on such application, "
            "the Magistrate shall take into consideration any domestic incident report received by "
            "him from the Protection Officer or the service provider.\n"
            "(4) The Magistrate shall fix the first date of hearing, which shall not ordinarily be "
            "beyond three days from the date of receipt of the application by the court.\n"
            "(5) The Magistrate shall endeavour to dispose of every application made under sub-section "
            "(1) within a period of sixty days from the date of its first hearing."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "You (or a Protection Officer, or anyone acting for you) can apply to the Magistrate "
            "for protection. First hearing is usually within 3 days, and the case should ideally be "
            "decided within 60 days."
        ),
        "keywords": [
            "pwdva 12", "domestic violence complaint", "how to file domestic violence",
            "protection officer", "domestic incident report", "magistrate application dv",
            "file complaint against husband",
        ],
    },
    {
        "key": "pwdva_17",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 17 — Right to reside in a shared household",
        "short_label": "PWDVA 17",
        "act": "PWDVA",
        "official_text": (
            "(1) Notwithstanding anything contained in any other law for the time being in force, "
            "every woman in a domestic relationship shall have the right to reside in the shared "
            "household, whether or not she has any right, title or beneficial interest in the same.\n"
            "(2) The aggrieved person shall not be evicted or excluded from the shared household or "
            "any part of it by the respondent save in accordance with the procedure established by law."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "A woman in a domestic relationship CANNOT be thrown out of the shared home, even if "
            "the home is not in her name. She can only be removed by a proper court order."
        ),
        "keywords": [
            "pwdva 17", "shared household", "right to reside", "thrown out of house",
            "husband threw me out", "in-laws evicted me", "residence right woman",
            "right to matrimonial home",
        ],
    },
    {
        "key": "pwdva_18",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 18 — Protection orders",
        "short_label": "PWDVA 18",
        "act": "PWDVA",
        "official_text": (
            "The Magistrate may, after giving the aggrieved person and the respondent an "
            "opportunity of being heard and on being prima facie satisfied that domestic violence "
            "has taken place or is likely to take place, pass a protection order in favour of the "
            "aggrieved person and prohibit the respondent from— (a) committing any act of domestic "
            "violence; (b) aiding or abetting in the commission of acts of domestic violence; "
            "(c) entering the place of employment of the aggrieved person or, if the person "
            "aggrieved is a child, its school or any other place frequented by the aggrieved person; "
            "(d) attempting to communicate in any form, whatsoever, with the aggrieved person, "
            "including personal, oral or written or electronic or telephonic contact; (e) alienating "
            "any assets, operating bank lockers or bank accounts used or held or enjoyed by both "
            "the parties, jointly by the aggrieved person and the respondent or singly by the "
            "respondent, including her stridhan or any other property held either jointly by the "
            "parties or separately by them without the leave of the Magistrate; (f) causing violence "
            "to the dependants, other relatives or any person who give the aggrieved person "
            "assistance from domestic violence; (g) committing any other act as specified in the "
            "protection order."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "The Magistrate can order the respondent to stop all violence, stop contacting you, "
            "stay away from your workplace or child's school, and stop selling shared assets or "
            "operating your accounts. This is called a Protection Order."
        ),
        "keywords": [
            "pwdva 18", "protection order", "restraining order", "stop contacting me",
            "protection from husband", "no contact order", "keep away husband",
        ],
    },
    {
        "key": "pwdva_20",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 20 — Monetary reliefs",
        "short_label": "PWDVA 20",
        "act": "PWDVA",
        "official_text": (
            "(1) While disposing of an application under sub-section (1) of section 12, the "
            "Magistrate may direct the respondent to pay monetary relief to meet the expenses "
            "incurred and losses suffered by the aggrieved person and any child of the aggrieved "
            "person as a result of the domestic violence and such relief may include, but is not "
            "limited to— (a) the loss of earnings; (b) the medical expenses; (c) the loss caused "
            "due to the destruction, damage or removal of any property from the control of the "
            "aggrieved person; and (d) the maintenance for the aggrieved person as well as her "
            "children, if any, including an order under or in addition to an order of maintenance "
            "under section 125 of the Code of Criminal Procedure, 1973 (2 of 1974) or any other "
            "law for the time being in force.\n"
            "(2) The monetary relief granted under this section shall be adequate, fair and "
            "reasonable and consistent with the standard of living to which the aggrieved person "
            "is accustomed."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "The court can order the respondent to pay you money for lost earnings, medical bills, "
            "damaged property, and maintenance for you and your children. The amount must match "
            "the standard of living you were used to."
        ),
        "keywords": [
            "pwdva 20", "monetary relief domestic violence", "maintenance domestic violence",
            "compensation abuse", "medical expenses husband", "child maintenance dv",
        ],
    },
    {
        "key": "pwdva_23",
        "citation": "Protection of Women from Domestic Violence Act 2005, Section 23 — Power to grant interim and ex parte orders",
        "short_label": "PWDVA 23",
        "act": "PWDVA",
        "official_text": (
            "(1) In any proceeding before him under this Act, the Magistrate may pass such interim "
            "order as he deems just and proper.\n"
            "(2) If the Magistrate is satisfied that an application prima facie discloses that the "
            "respondent is committing, or has committed an act of domestic violence or that there "
            "is a likelihood that the respondent may commit an act of domestic violence, he may "
            "grant an ex parte order on the basis of the affidavit in such form, as may be "
            "prescribed, of the aggrieved person under section 18, section 19, section 20, section "
            "21 or, as the case may be, section 22 against the respondent."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/2031",
        "verified_at": "2026-01-15",
        "scope_note": (
            "The Magistrate can pass an EMERGENCY order — even without hearing the respondent — "
            "if your affidavit shows abuse is happening or likely to happen. This is called an "
            "ex parte order and is used when you need urgent protection."
        ),
        "keywords": [
            "pwdva 23", "emergency protection order", "ex parte order",
            "urgent protection domestic violence", "immediate order husband",
            "emergency abuse", "urgent protection abuse", "protection from abuse",
            "emergency safety", "help urgent abuse",
        ],
    },
    # -------------------- Right to Information Act 2005 --------------------
    {
        "key": "rti_6",
        "citation": "Right to Information Act 2005, Section 6 — Request for obtaining information",
        "short_label": "RTI 6",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) A person, who desires to obtain any information under this Act, shall make a "
            "request in writing or through electronic means in English or Hindi or in the official "
            "language of the area in which the application is being made, accompanying such fee "
            "as may be prescribed, to—\n"
            "(a) the Central Public Information Officer or State Public Information Officer, as "
            "the case may be, of the concerned public authority;\n"
            "(b) the Central Assistant Public Information Officer or State Assistant Public "
            "Information Officer, as the case may be, specifying the particulars of the information "
            "sought by him or her:\n"
            "Provided that where such request cannot be made in writing, the Central Public "
            "Information Officer or State Public Information Officer, as the case may be, shall "
            "render all reasonable assistance to the person making the request orally to reduce the "
            "same in writing.\n"
            "(2) An applicant making request for information shall not be required to give any "
            "reason for requesting the information or any other personal details except those that "
            "may be necessary for contacting him."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-02-01",
        "scope_note": (
            "RTI Section 6 lets you ask any public authority for information in writing (or "
            "electronically) in English, Hindi, or the local language. You DO NOT need to give a "
            "reason. If you cannot write, the PIO must help you put your request in writing."
        ),
        "keywords": [
            "rti 6", "section 6 rti", "file rti", "filing rti", "how to file rti",
            "rti application", "rti request", "apply rti", "rti procedure",
            "public information officer", "pio", "spio", "cpio",
            "rti online", "rti fee", "rti in hindi", "rti local language",
            "right to information", "government information",
        ],
    },
    {
        "key": "rti_7",
        "citation": "Right to Information Act 2005, Section 7 — Disposal of request",
        "short_label": "RTI 7",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Subject to the proviso to sub-section (2) of section 5 or the proviso to "
            "sub-section (3) of section 6, the Central Public Information Officer or State Public "
            "Information Officer, as the case may be, on receipt of a request under section 6 "
            "shall, as expeditiously as possible, and in any case within thirty days of the "
            "receipt of the request, either provide the information on payment of such fee as may "
            "be prescribed or reject the request for any of the reasons specified in sections 8 and 9:\n"
            "Provided that where the information sought for concerns the life or liberty of a "
            "person, the same shall be provided within forty-eight hours of the receipt of the "
            "request.\n"
            "(2) If the Central Public Information Officer or State Public Information Officer, "
            "as the case may be, fails to give decision on the request for information within the "
            "period specified under sub-section (1), the Central Public Information Officer or "
            "State Public Information Officer, as the case may be, shall be deemed to have refused "
            "the request.\n"
            "(6) Notwithstanding anything contained in sub-section (5), the person making request "
            "for the information shall be provided the information free of charge where a public "
            "authority fails to comply with the time limits specified in sub-section (1)."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-02-01",
        "scope_note": (
            "RTI Section 7 gives the government 30 days to reply to your RTI (48 hours if it "
            "concerns life or liberty). If they miss the deadline, you get the information FREE "
            "and it counts as a deemed refusal you can appeal."
        ),
        "keywords": [
            "rti 7", "section 7 rti", "rti 30 days", "rti timeline", "rti deadline",
            "rti reply time", "rti response time", "deemed refusal", "rti free",
            "rti not answered", "rti no reply", "rti delay", "48 hours rti",
            "life and liberty rti", "rti time limit",
        ],
    },
    {
        "key": "rti_19",
        "citation": "Right to Information Act 2005, Section 19 — Appeal",
        "short_label": "RTI 19",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Any person who does not receive a decision within the time specified in "
            "sub-section (1) or clause (a) of sub-section (3) of section 7, or is aggrieved by a "
            "decision of the Central Public Information Officer or State Public Information "
            "Officer, as the case may be, may within thirty days from the expiry of such period or "
            "from the receipt of such a decision prefer an appeal to such officer who is senior in "
            "rank to the Central Public Information Officer or State Public Information Officer, "
            "as the case may be, in each public authority.\n"
            "(3) A second appeal against the decision under sub-section (1) shall lie within "
            "ninety days from the date on which the decision should have been made or was actually "
            "received, with the Central Information Commission or the State Information Commission."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-02-01",
        "scope_note": (
            "If your RTI is refused or ignored, you can file a FIRST APPEAL within 30 days to a "
            "senior officer in the same department. If still not satisfied, a SECOND APPEAL goes "
            "to the Central or State Information Commission within 90 days."
        ),
        "keywords": [
            "rti 19", "section 19 rti", "rti appeal", "rti first appeal", "rti second appeal",
            "first appellate authority", "information commission", "central information commission",
            "state information commission", "cic", "sic", "rti refused appeal",
            "how to appeal rti", "rti complaint",
        ],
    },
    {
        "key": "rti_20",
        "citation": "Right to Information Act 2005, Section 20 — Penalties",
        "short_label": "RTI 20",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Where the Central Information Commission or the State Information Commission, "
            "as the case may be, at the time of deciding any complaint or appeal is of the opinion "
            "that the Central Public Information Officer or the State Public Information Officer, "
            "as the case may be, has, without any reasonable cause, refused to receive an "
            "application for information or has not furnished information within the time "
            "specified under sub-section (1) of section 7 or malafidely denied the request for "
            "information or knowingly given incorrect, incomplete or misleading information or "
            "destroyed information which was the subject of the request or obstructed in any "
            "manner in furnishing the information, it shall impose a penalty of two hundred and "
            "fifty rupees each day till application is received or information is furnished, so "
            "however, the total amount of such penalty shall not exceed twenty-five thousand rupees:\n"
            "Provided that the Central Public Information Officer or the State Public Information "
            "Officer, as the case may be, shall be given a reasonable opportunity of being heard "
            "before any penalty is imposed on him."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-02-01",
        "scope_note": (
            "RTI Section 20 lets the Information Commission fine the PIO ₹250 per day (up to "
            "₹25,000) if they wrongly refuse your RTI, delay it, or give false / incomplete "
            "information. This penalty comes out of the officer's salary."
        ),
        "keywords": [
            "rti 20", "section 20 rti", "rti penalty", "penalty pio", "pio fine",
            "rti punishment", "action against pio", "fine information officer",
            "wrong rti reply", "false rti reply", "misleading rti",
        ],
    },
    {
        "key": "rti_2",
        "citation": "Right to Information Act 2005, Section 2 — Definitions",
        "short_label": "RTI 2",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "In this Act, unless the context otherwise requires,—\n"
            "(f) 'information' means any material in any form, including records, documents, "
            "memos, e-mails, opinions, advices, press releases, circulars, orders, logbooks, "
            "contracts, reports, papers, samples, models, data material held in any electronic "
            "form and information relating to any private body which can be accessed by a public "
            "authority under any other law for the time being in force;\n"
            "(h) 'public authority' means any authority or body or institution of self-government "
            "established or constituted—(a) by or under the Constitution; (b) by any other law "
            "made by Parliament; (c) by any other law made by State Legislature; (d) by "
            "notification issued or order made by the appropriate Government, and includes any—"
            "(i) body owned, controlled or substantially financed; (ii) non-Government "
            "organisation substantially financed, directly or indirectly by funds provided by the "
            "appropriate Government;\n"
            "(j) 'right to information' means the right to information accessible under this Act "
            "which is held by or under the control of any public authority and includes the right "
            "to—(i) inspection of work, documents, records; (ii) taking notes, extracts or "
            "certified copies of documents or records; (iii) taking certified samples of "
            "material; (iv) obtaining information in the form of diskettes, floppies, tapes, "
            "video cassettes or in any other electronic mode or through printouts where such "
            "information is stored in a computer or in any other device."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-06-01",
        "scope_note": (
            "You can ask for almost any record a government office holds — files, emails, "
            "contracts, reports, registers, samples, even computer data. You can also inspect "
            "records or take certified copies. Private bodies are covered when a public "
            "authority can already access their information."
        ),
        "keywords": [
            "rti 2", "section 2 rti", "what is information rti", "rti definition",
            "what can i ask rti", "which documents rti", "rti inspection of records",
            "certified copies rti", "public authority meaning", "is private company rti",
            "ngo rti", "rti scope", "right to information meaning",
        ],
    },
    {
        "key": "rti_4",
        "citation": "Right to Information Act 2005, Section 4 — Obligations of public authorities",
        "short_label": "RTI 4",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Every public authority shall—\n"
            "(a) maintain all its records duly catalogued and indexed in a manner and the form "
            "which facilitates the right to information under this Act;\n"
            "(b) publish within one hundred and twenty days from the enactment of this Act,—"
            "(i) the particulars of its organisation, functions and duties; (ii) the powers and "
            "duties of its officers and employees; (iii) the procedure followed in the "
            "decision-making process, including channels of supervision and accountability; "
            "(iv) the norms set by it for the discharge of its functions; (v) the rules, "
            "regulations, instructions, manuals and records held by it or under its control; "
            "(vi) a statement of the categories of documents that are held by it; (xi) the budget "
            "allocated to each of its agency; (xii) the manner of execution of subsidy "
            "programmes, including the amounts allocated and the details of beneficiaries; "
            "(xiii) particulars of recipients of concessions, permits or authorisations granted "
            "by it; (xvi) the names, designations and other particulars of the Public Information "
            "Officers;\n"
            "(c) publish all relevant facts while formulating important policies or announcing "
            "the decisions which affect public;\n"
            "(d) provide reasons for its administrative or quasi-judicial decisions to affected "
            "persons.\n"
            "(2) It shall be a constant endeavour of every public authority to take steps to "
            "provide as much information suo motu to the public at regular intervals through "
            "various means of communications, including internet, so that the public have minimum "
            "resort to the use of this Act to obtain information."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Every government office must publish key information on its own — its structure, "
            "rules, budget, subsidy beneficiaries, and the name of its Public Information "
            "Officer. It must also give you REASONS for any decision that affects you. If this "
            "is missing, you can demand it."
        ),
        "keywords": [
            "rti 4", "section 4 rti", "suo motu disclosure", "proactive disclosure",
            "government must publish", "who is pio", "find pio name", "pio details",
            "budget information government", "subsidy beneficiary list",
            "reasons for decision government", "no reason given order",
        ],
    },
    {
        "key": "rti_5",
        "citation": "Right to Information Act 2005, Section 5 — Designation of Public Information Officers",
        "short_label": "RTI 5",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Every public authority shall, within one hundred days of the enactment of this "
            "Act, designate as many officers as the Central Public Information Officers or State "
            "Public Information Officers, as the case may be, in all administrative units or "
            "offices under it as may be necessary to provide information to persons requesting "
            "for the information under this Act.\n"
            "(2) Without prejudice to the provisions of sub-section (1), every public authority "
            "shall designate an officer, within one hundred days of the enactment of this Act, at "
            "each sub-divisional level or other sub-district level as a Central Assistant Public "
            "Information Officer or a State Assistant Public Information Officer, as the case may "
            "be, to receive the applications for information or appeals under this Act for "
            "forwarding the same forthwith to the Central Public Information Officer or the State "
            "Public Information Officer.\n"
            "(3) Every Central Public Information Officer or State Public Information Officer "
            "shall deal with requests from persons seeking information and render reasonable "
            "assistance to the persons seeking such information.\n"
            "(4) The Central Public Information Officer or State Public Information Officer, as "
            "the case may be, may seek the assistance of any other officer as he or she considers "
            "it necessary for the proper discharge of his or her duties."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Every office must have a Public Information Officer (PIO), and every sub-division "
            "must have an Assistant PIO who is bound to accept your RTI and forward it. The PIO "
            "must also HELP you frame your request — including helping people who cannot write."
        ),
        "keywords": [
            "rti 5", "section 5 rti", "assistant public information officer", "apio",
            "where to submit rti", "who accepts rti", "rti help writing", "pio duty assist",
            "office refused to accept rti", "rti not accepted counter",
        ],
    },
    {
        "key": "rti_8",
        "citation": "Right to Information Act 2005, Section 8 — Exemption from disclosure of information",
        "short_label": "RTI 8",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Notwithstanding anything contained in this Act, there shall be no obligation to "
            "give any citizen,—\n"
            "(a) information, disclosure of which would prejudicially affect the sovereignty and "
            "integrity of India, the security, strategic, scientific or economic interests of the "
            "State, relation with foreign State or lead to incitement of an offence;\n"
            "(b) information which has been expressly forbidden to be published by any court of "
            "law or tribunal or the disclosure of which may constitute contempt of court;\n"
            "(c) information, the disclosure of which would cause a breach of privilege of "
            "Parliament or the State Legislature;\n"
            "(d) information including commercial confidence, trade secrets or intellectual "
            "property, the disclosure of which would harm the competitive position of a third "
            "party, unless the competent authority is satisfied that larger public interest "
            "warrants the disclosure of such information;\n"
            "(e) information available to a person in his fiduciary relationship, unless the "
            "competent authority is satisfied that the larger public interest warrants the "
            "disclosure of such information;\n"
            "(f) information received in confidence from foreign Government;\n"
            "(g) information, the disclosure of which would endanger the life or physical safety "
            "of any person or identify the source of information or assistance given in "
            "confidence for law enforcement or security purposes;\n"
            "(h) information which would impede the process of investigation or apprehension or "
            "prosecution of offenders;\n"
            "(i) cabinet papers including records of deliberations of the Council of Ministers, "
            "Secretaries and other officers:\n"
            "Provided that the decisions of Council of Ministers, the reasons thereof, and the "
            "material on the basis of which the decisions were taken shall be made public after "
            "the decision has been taken, and the matter is complete, or over;\n"
            "(j) information which relates to personal information the disclosure of which has no "
            "relationship to any public activity or interest, or which would cause unwarranted "
            "invasion of the privacy of the individual unless the Central Public Information "
            "Officer or the State Public Information Officer or the appellate authority, as the "
            "case may be, is satisfied that the larger public interest justifies the disclosure "
            "of such information.\n"
            "(2) Notwithstanding anything in the Official Secrets Act, 1923 nor any of the "
            "exemptions permissible in accordance with sub-section (1), a public authority may "
            "allow access to information, if public interest in disclosure outweighs the harm to "
            "the protected interests.\n"
            "(3) Subject to the provisions of clauses (a), (c) and (i) of sub-section (1), any "
            "information relating to any occurrence, event or matter which has taken place, "
            "occurred or happened twenty years before the date on which any request is made under "
            "section 6 shall be provided to any person making a request under that section."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Only a short list of information can be refused — national security, court-barred "
            "matter, trade secrets, ongoing investigation, cabinet papers before a decision, or "
            "purely personal details. Even then, the office CAN disclose if public interest is "
            "bigger. Records older than 20 years must normally be given."
        ),
        "keywords": [
            "rti 8", "section 8 rti", "rti rejected", "rti refused reason",
            "rti exemption", "exempt information rti", "third party information rti",
            "personal information rti", "privacy rti refusal", "investigation rti refusal",
            "cabinet papers rti", "20 years old records rti", "public interest override rti",
            "my rti was denied", "pio said exempt",
        ],
    },
    {
        "key": "rti_18",
        "citation": "Right to Information Act 2005, Section 18 — Powers and functions of Information Commissions",
        "short_label": "RTI 18",
        "act": "RTI",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "(1) Subject to the provisions of this Act, it shall be the duty of the Central "
            "Information Commission or State Information Commission, as the case may be, to "
            "receive and inquire into a complaint from any person,—\n"
            "(a) who has been unable to submit a request to a Central Public Information Officer "
            "or State Public Information Officer, as the case may be, either by reason that no "
            "such officer has been appointed under this Act, or because the Central Assistant "
            "Public Information Officer or the State Assistant Public Information Officer, as the "
            "case may be, has refused to accept his or her application for information or appeal "
            "under this Act for forwarding the same to the Central Public Information Officer or "
            "State Public Information Officer;\n"
            "(b) who has been refused access to any information requested under this Act;\n"
            "(c) who has not been given a response to a request for information or access to "
            "information within the time limit specified under this Act;\n"
            "(d) who has been required to pay an amount of fee which he or she considers "
            "unreasonable;\n"
            "(e) who believes that he or she has been given incomplete, misleading or false "
            "information under this Act; and\n"
            "(f) in respect of any other matter relating to requesting or obtaining access to "
            "records under this Act.\n"
            "(2) Where the Central Information Commission or State Information Commission, as the "
            "case may be, is satisfied that there are reasonable grounds to inquire into the "
            "matter, it may initiate an inquiry in respect thereof.\n"
            "(3) The Central Information Commission or State Information Commission, as the case "
            "may be, shall, while inquiring into any matter under this section, have the same "
            "powers as are vested in a civil court while trying a suit under the Code of Civil "
            "Procedure, 1908, in respect of the following matters, namely:—(a) summoning and "
            "enforcing the attendance of persons and compelling them to give oral or written "
            "evidence on oath and to produce the documents or things; (b) requiring the discovery "
            "and inspection of documents; (c) receiving evidence on affidavit; (d) requisitioning "
            "any public record or copies thereof from any court or office; (e) issuing summons for "
            "examination of witnesses or documents."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1362",
        "verified_at": "2026-06-01",
        "scope_note": (
            "If the office refused to accept your RTI, ignored it, charged an unfair fee, or gave "
            "false / incomplete information, you can COMPLAIN directly to the Information "
            "Commission. The Commission has civil-court powers — it can summon the officer and "
            "demand the files."
        ),
        "keywords": [
            "rti 18", "section 18 rti", "rti complaint commission",
            "complaint information commission", "cic complaint", "sic complaint",
            "rti ignored no reply", "rti fee too high", "rti false information complaint",
            "no pio appointed", "rti application not accepted complaint",
        ],
    },
    # -------------------- Consumer Protection Act 2019 --------------------
    {
        "key": "cpa_2_7",
        "citation": "Consumer Protection Act 2019, Section 2(7) — Definition of consumer",
        "short_label": "CPA 2(7)",
        "act": "CPA",
        "official_text": (
            "'consumer' means any person who—\n"
            "(i) buys any goods for a consideration which has been paid or promised or partly "
            "paid and partly promised, or under any system of deferred payment and includes any "
            "user of such goods other than the person who buys such goods for consideration paid "
            "or promised or partly paid or partly promised, or under any system of deferred "
            "payment, when such use is made with the approval of such person, but does not include "
            "a person who obtains such goods for resale or for any commercial purpose; or\n"
            "(ii) hires or avails of any service for a consideration which has been paid or "
            "promised or partly paid and partly promised, or under any system of deferred payment "
            "and includes any beneficiary of such service other than the person who hires or "
            "avails of the services for consideration paid or promised, or partly paid and partly "
            "promised, or under any system of deferred payment, when such services are availed of "
            "with the approval of the first mentioned person, but does not include a person who "
            "avails of such service for any commercial purpose.\n"
            "Explanation.—For the purposes of this clause,—\n"
            "(a) the expression 'commercial purpose' does not include use by a person of goods "
            "bought and used by him exclusively for the purpose of earning his livelihood, by "
            "means of self-employment;\n"
            "(b) the expressions 'buys any goods' and 'hires or avails any services' includes "
            "offline or online transactions through electronic means or by teleshopping or direct "
            "selling or multi-level marketing."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/15256",
        "verified_at": "2026-02-01",
        "scope_note": (
            "You are a CONSUMER under this law if you paid for goods or services (offline OR "
            "online) for personal use — not for resale or business. Family members who use what "
            "you bought are also protected."
        ),
        "keywords": [
            "cpa 2", "cpa 2(7)", "section 2 consumer protection", "who is a consumer",
            "consumer definition", "am i a consumer", "online purchase consumer",
            "buyer rights", "customer rights", "e-commerce consumer",
        ],
    },
    {
        "key": "cpa_34",
        "citation": "Consumer Protection Act 2019, Section 34 — Jurisdiction of District Commission",
        "short_label": "CPA 34",
        "act": "CPA",
        "official_text": (
            "(1) Subject to the other provisions of this Act, the District Commission shall have "
            "jurisdiction to entertain complaints where the value of the goods or services paid as "
            "consideration does not exceed fifty lakh rupees.\n"
            "(2) A complaint shall be instituted in a District Commission within the local limits "
            "of whose jurisdiction,—\n"
            "(a) the opposite party or each of the opposite parties, where there are more than "
            "one, at the time of the institution of the complaint, ordinarily resides or carries "
            "on business or has a branch office or personally works for gain; or\n"
            "(b) any of the opposite parties, where there are more than one, at the time of the "
            "institution of the complaint, actually and voluntarily resides, or carries on "
            "business or has a branch office, or personally works for gain, provided that in such "
            "case the permission of the District Commission is given; or\n"
            "(c) the cause of action, wholly or in part, arises; or\n"
            "(d) the complainant resides or personally works for gain."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/15256",
        "verified_at": "2026-02-01",
        "scope_note": (
            "For consumer complaints up to ₹50 lakh, file at the DISTRICT Commission. You can "
            "file where the seller does business, where the transaction happened, OR where you "
            "yourself live — you no longer have to travel to the seller's city."
        ),
        "keywords": [
            "cpa 34", "section 34 consumer", "district commission", "district consumer forum",
            "where to file consumer complaint", "consumer complaint jurisdiction",
            "50 lakh consumer", "pecuniary jurisdiction consumer",
            "consumer court location", "consumer forum near me",
        ],
    },
    {
        "key": "cpa_35",
        "citation": "Consumer Protection Act 2019, Section 35 — Manner in which complaint shall be made",
        "short_label": "CPA 35",
        "act": "CPA",
        "official_text": (
            "(1) A complaint, in relation to any goods sold or delivered or agreed to be sold or "
            "delivered or any service provided or agreed to be provided, may be filed with a "
            "District Commission by—\n"
            "(a) the consumer,—\n"
            "  (i) to whom such goods are sold or delivered or agreed to be sold or delivered or "
            "such service is provided or agreed to be provided; or\n"
            "  (ii) who alleges unfair trade practice in respect of such goods or service;\n"
            "(b) any recognised consumer association, whether the consumer to whom such goods are "
            "sold or delivered or agreed to be sold or delivered or such service is provided or "
            "agreed to be provided, or who alleges unfair trade practice, is a member of such "
            "association or not;\n"
            "(c) one or more consumers, where there are numerous consumers having the same "
            "interest, with the permission of the District Commission, on behalf of, or for the "
            "benefit of, all consumers so interested;\n"
            "(d) the Central Government, the Central Authority or the State Government, as the "
            "case may be:\n"
            "Provided that the complaint under this sub-section may be filed electronically in "
            "such manner as may be prescribed."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/15256",
        "verified_at": "2026-02-01",
        "scope_note": (
            "You can file a consumer complaint yourself, or through a recognised consumer group. "
            "Complaints can now be filed ONLINE via the e-Daakhil portal (edaakhil.nic.in)."
        ),
        "keywords": [
            "cpa 35", "section 35 consumer", "how to file consumer complaint",
            "file consumer case", "consumer court complaint", "e-daakhil", "edaakhil",
            "online consumer complaint", "consumer helpline", "cheated by seller",
            "faulty product", "defective goods", "bad service complaint",
            "shopkeeper cheated", "online shopping fraud",
        ],
    },
    {
        "key": "cpa_69",
        "citation": "Consumer Protection Act 2019, Section 69 — Limitation period",
        "short_label": "CPA 69",
        "act": "CPA",
        "official_text": (
            "(1) The District Commission, the State Commission or the National Commission shall "
            "not admit a complaint unless it is filed within two years from the date on which the "
            "cause of action has arisen.\n"
            "(2) Notwithstanding anything contained in sub-section (1), a complaint may be "
            "entertained after the period specified in sub-section (1), if the complainant "
            "satisfies the District Commission, the State Commission or the National Commission, "
            "as the case may be, that he had sufficient cause for not filing the complaint within "
            "such period:\n"
            "Provided that no such complaint shall be entertained unless the District Commission "
            "or the State Commission or the National Commission, as the case may be, records its "
            "reasons for condoning such delay."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/15256",
        "verified_at": "2026-02-01",
        "scope_note": (
            "You must file your consumer complaint within TWO YEARS from the date the problem "
            "arose. Later than that, the court can still accept it only if you show a good reason "
            "for the delay."
        ),
        "keywords": [
            "cpa 69", "section 69 consumer", "consumer complaint time limit",
            "consumer limitation", "2 years consumer", "two years consumer complaint",
            "old consumer complaint", "delayed consumer complaint",
        ],
    },
    # -------------------- Motor Vehicles Act 1988 (as amended 2019) --------------------
    {
        "key": "mv_129",
        "citation": "Motor Vehicles Act 1988, Section 129 — Wearing of protective headgear",
        "short_label": "MV 129",
        "act": "MV",
        "official_text": (
            "Every person, above four years of age, driving or riding or being carried on a "
            "motor cycle of any class or description shall, while in a public place, wear "
            "protective headgear conforming to such standards as may be prescribed by the "
            "Central Government:\n"
            "Provided that the provisions of this section shall not apply to a person who is a "
            "Sikh, if he is, while driving or riding on the motor cycle, in a public place, "
            "wearing a turban:\n"
            "Provided further that the Central Government may by rules provide for measures for "
            "the safety of children below four years of age riding or being carried on a motor cycle.\n"
            "Explanation.—'Protective headgear' means a helmet which—\n"
            "(a) by virtue of its shape, material and construction, could reasonably be expected "
            "to afford to the person driving or riding on a motor cycle a degree of protection "
            "from injury in the event of an accident; and\n"
            "(b) is fastened to the head of the wearer by means of straps or other fastenings "
            "provided on the headgear."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-02-01",
        "scope_note": (
            "Everyone above 4 years — driver AND pillion — must wear a proper BIS-certified "
            "helmet on a two-wheeler in public. Sikhs wearing a turban are exempted."
        ),
        "keywords": [
            "mv 129", "section 129 motor vehicles", "helmet law", "helmet rule",
            "helmet mandatory", "helmet compulsory", "helmet required", "helmet fine", "two wheeler helmet", "pillion helmet",
            "bike helmet", "scooter helmet", "sikh helmet exemption",
        ],
    },
    {
        "key": "mv_132",
        "citation": "Motor Vehicles Act 1988, Section 132 — Duty of driver to stop in certain cases",
        "short_label": "MV 132",
        "act": "MV",
        "official_text": (
            "(1) The driver of a motor vehicle shall cause the vehicle to stop and cause it to "
            "remain stationary so long as may reasonably be necessary,—\n"
            "(a) when required to do so by any police officer in uniform, or by a person "
            "authorised to remove obstructions to traffic; or\n"
            "(b) when required to do so by any other person indicating that the vehicle is "
            "required to be stopped for the purpose of enabling any person to board or alight "
            "from another vehicle;\n"
            "(c) on the occurrence of an accident in which the vehicle is involved, in the manner "
            "prescribed in section 134.\n"
            "(2) The driver of a motor vehicle shall, on demand by a police officer in uniform, "
            "produce his driving licence for examination."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-02-01",
        "scope_note": (
            "You MUST stop when signalled by a UNIFORMED police officer, and you must show your "
            "driving licence on demand. Refusing to stop is itself an offence."
        ),
        "keywords": [
            "mv 132", "section 132 motor vehicles", "police stopped vehicle", "traffic stop",
            "traffic police stop", "duty to stop", "show license traffic",
            "produce driving licence", "traffic check", "traffic police powers",
            "vehicle check", "police checking vehicle",
        ],
    },
    {
        "key": "mv_134",
        "citation": "Motor Vehicles Act 1988, Section 134 — Duty of driver in case of accident and injury to a person",
        "short_label": "MV 134",
        "act": "MV",
        "official_text": (
            "When any person is injured or any property of a third party is damaged, as a result "
            "of an accident in which a motor vehicle is involved, the driver of the vehicle or "
            "other person in charge of the vehicle shall—\n"
            "(a) unless it is not practicable to do so on account of mob fury or any other "
            "reason beyond his control, take all reasonable steps to secure medical attention for "
            "the injured person, by conveying him to the nearest medical practitioner or hospital, "
            "and it shall be the duty of every registered medical practitioner or the doctor on "
            "duty in the hospital immediately to attend to the injured person and render medical "
            "aid or treatment without waiting for any procedural formalities, unless the injured "
            "person or his guardian, in case he is a minor, desires otherwise;\n"
            "(b) give on demand by a police officer any information required by him, or, if no "
            "police officer is present, report the circumstances of the occurrence, including the "
            "circumstances, if any, for not taking reasonable steps to secure medical attention "
            "as required under clause (a), at the nearest police station as soon as possible, and "
            "in any case within twenty-four hours of the occurrence."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-02-01",
        "scope_note": (
            "If you are in a road accident, the law REQUIRES you to help the injured person to a "
            "hospital and report the accident to police within 24 hours. Hospitals must treat the "
            "injured immediately — no paperwork first. Good Samaritans are protected from "
            "harassment."
        ),
        "keywords": [
            "mv 134", "section 134 motor vehicles", "road accident", "accident duty",
            "hit and run", "duty after accident", "accident report police", "accident 24 hours",
            "good samaritan", "help injured accident", "hospital accident treatment",
            "car accident what to do", "bike accident what to do", "accident procedure",
        ],
    },
    {
        "key": "mv_185",
        "citation": "Motor Vehicles Act 1988, Section 185 — Driving by a drunken person or by a person under the influence of drugs",
        "short_label": "MV 185",
        "act": "MV",
        "official_text": (
            "Whoever, while driving, or attempting to drive, a motor vehicle,—\n"
            "(a) has, in his blood, alcohol exceeding 30 mg. per 100 ml. of blood detected in a "
            "test by a breath analyser, or in any another test including a laboratory test, or\n"
            "(b) is under the influence of a drug to such an extent as to be incapable of "
            "exercising proper control over the vehicle,\n"
            "shall be punishable for the first offence with imprisonment for a term which may "
            "extend to six months, or with fine which may extend to ten thousand rupees, or with "
            "both; and for a second or subsequent offence, if committed within three years of the "
            "commission of the previous similar offence, with imprisonment for a term which may "
            "extend to two years, or with fine which may extend to fifteen thousand rupees, or "
            "with both."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-02-01",
        "scope_note": (
            "Legal blood-alcohol limit is 30 mg per 100 ml. Cross that OR drive under the "
            "influence of drugs, and the first offence is up to 6 months jail or ₹10,000 fine (or "
            "both). A repeat within 3 years can lead to 2 years jail or ₹15,000."
        ),
        "keywords": [
            "mv 185", "section 185 motor vehicles", "drunk driving", "drink and drive",
            "dui india", "alcohol driving", "breath analyser", "breathalyzer",
            "blood alcohol limit", "drugs driving", "drunk driving fine",
            "drunk driving punishment", "drunk driving jail",
        ],
    },
    {
        "key": "mv_194b",
        "citation": "Motor Vehicles Act 1988, Section 194B — Use of safety belts and the safety measures for children below fourteen years of age",
        "short_label": "MV 194B",
        "act": "MV",
        "official_text": (
            "(1) Whoever drives a motor vehicle without wearing a safety belt or carries "
            "passengers not wearing seat belts shall be punishable with a fine of one thousand "
            "rupees.\n"
            "(2) Whoever drives a motor vehicle without securing a child, who has not attained "
            "the age of fourteen years, either by a safety belt or a child restraint system, in "
            "accordance with such standards as may be prescribed, shall be punishable with a fine "
            "of one thousand rupees."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-02-01",
        "scope_note": (
            "Everyone in a car — driver AND passengers — must wear a seat belt. Children under "
            "14 must be secured with a seat belt or a proper child restraint. Fine is ₹1,000 per "
            "offence."
        ),
        "keywords": [
            "mv 194b", "section 194b motor vehicles", "seat belt", "seatbelt",
            "seat belt fine", "seat belt law", "child seat", "child restraint",
            "back seat belt", "passenger seat belt", "seat belt mandatory",
        ],
    },
    {
        "key": "mv_194d",
        "require_any": ["helmet", "headgear", "two wheeler", "twowheeler", "bike", "scooter", "motor cycle", "motorcycle", "pillion", "194d"],
        "citation": "Motor Vehicles Act 1988, Section 194D — Penalty for not wearing protective headgear",
        "short_label": "MV 194D",
        "act": "MV",
        "official_text": (
            "Whoever drives a motor cycle without wearing a protective headgear in contravention "
            "of section 129 or the rules or regulations made thereunder shall be punishable with "
            "a fine of one thousand rupees and he shall be disqualified for holding licence for a "
            "period of three months."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Riding a two-wheeler without a helmet costs ₹1,000 AND your driving licence can be "
            "suspended for 3 months. This is the penalty section that goes with the helmet rule."
        ),
        "keywords": [
            "mv 194d", "section 194d motor vehicles", "helmet fine", "helmet penalty",
            "helmet challan", "no helmet fine", "helmet fine amount", "fine for not wearing helmet",
            "helmet 1000 rupees", "licence suspended helmet", "helmet dl suspension",
            "without helmet punishment", "helmet violation penalty", "riding without helmet",
        ],
    },
    {
        "key": "mv_194c",
        "require_any": ["triple", "three", "pillion", "two wheeler", "bike", "scooter", "motor cycle", "motorcycle", "overload", "194c"],
        "citation": "Motor Vehicles Act 1988, Section 194C — Penalty for violation of safety measures for motor cycle drivers and pillion riders",
        "short_label": "MV 194C",
        "act": "MV",
        "official_text": (
            "Whoever drives a motor cycle or causes or allows a motor cycle to be driven in "
            "contravention of the provisions of section 128 or the rules or regulations made "
            "thereunder shall be punishable with a fine of one thousand rupees and he shall be "
            "disqualified for holding licence for a period of three months."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "A two-wheeler may carry only ONE pillion rider. Triple riding is a ₹1,000 fine plus "
            "3-month suspension of the driving licence."
        ),
        "keywords": [
            "mv 194c", "section 194c motor vehicles", "triple riding", "triple seat",
            "three on bike", "three people bike fine", "pillion rider rule",
            "two wheeler overloading", "more than two on scooter",
        ],
    },
    {
        "key": "mv_177",
        "citation": "Motor Vehicles Act 1988, Section 177 — General provision for punishment of offences",
        "short_label": "MV 177",
        "act": "MV",
        "official_text": (
            "Whoever contravenes any provision of this Act or of any rule, regulation or "
            "notification made thereunder shall, if no penalty is provided for the offence, be "
            "punishable for the first offence with fine of five hundred rupees, and for any "
            "second or subsequent offence with fine of one thousand five hundred rupees."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "For any traffic rule breach that has no specific fine written for it, the general "
            "fine is ₹500 the first time and ₹1,500 for repeat offences."
        ),
        "keywords": [
            "mv 177", "section 177 motor vehicles", "general traffic fine",
            "minor traffic violation fine", "500 rupees challan", "traffic rule fine general",
            "no specific penalty traffic",
        ],
    },
    {
        "key": "mv_181",
        "citation": "Motor Vehicles Act 1988, Section 181 — Driving vehicles in contravention of section 3 or section 4",
        "short_label": "MV 181",
        "act": "MV",
        "official_text": (
            "Whoever drives a motor vehicle in contravention of section 3 or section 4 shall be "
            "punishable with imprisonment for a term which may extend to three months, or with "
            "fine of five thousand rupees, or with both."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Driving without a valid driving licence, or while under the legal age, can mean up "
            "to 3 months in jail or a ₹5,000 fine, or both."
        ),
        "keywords": [
            "mv 181", "section 181 motor vehicles", "driving without licence",
            "no driving licence fine", "driving without dl", "underage driving",
            "minor driving fine", "learner licence violation", "expired licence driving",
            "caught without licence",
        ],
    },
    {
        "key": "mv_180",
        "citation": "Motor Vehicles Act 1988, Section 180 — Allowing unauthorised person to drive vehicle",
        "short_label": "MV 180",
        "act": "MV",
        "official_text": (
            "Whoever, being the owner or person in charge of a motor vehicle, causes or permits "
            "any other person who does not satisfy the provisions of section 3 or section 4 to "
            "drive the vehicle shall be punishable with imprisonment for a term which may extend "
            "to three months, or with fine of five thousand rupees, or with both."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "If you hand your vehicle to someone without a valid licence — including your child — "
            "YOU as the owner can face up to 3 months jail or a ₹5,000 fine, or both."
        ),
        "keywords": [
            "mv 180", "section 180 motor vehicles", "gave bike to friend without licence",
            "owner liability driving", "allowing unlicensed driver", "lending vehicle fine",
            "son driving my car", "vehicle owner punishment",
        ],
    },
    {
        "key": "mv_183",
        "citation": "Motor Vehicles Act 1988, Section 183 — Driving at excessive speed",
        "short_label": "MV 183",
        "act": "MV",
        "official_text": (
            "(1) Whoever drives a motor vehicle in contravention of the speed limits referred to "
            "in section 112 shall be punishable with a fine of one thousand rupees for light "
            "motor vehicle, two thousand rupees for medium passenger vehicle or medium goods "
            "vehicle or heavy passenger vehicle or heavy goods vehicle and for the second or any "
            "subsequent offence under this sub-section, the driving licence shall be impounded as "
            "per the provisions of sub-section (4) of section 206.\n"
            "(2) Whoever, being the employer or person in charge of a motor vehicle, causes or "
            "permits the driver of such motor vehicle to drive at a speed exceeding the speed "
            "limits referred to in section 112 shall be punishable with a fine of one thousand "
            "rupees for light motor vehicle, two thousand rupees for medium passenger vehicle or "
            "medium goods vehicle or heavy passenger vehicle or heavy goods vehicle."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Over-speeding costs ₹1,000 for a car or two-wheeler and ₹2,000 for bigger vehicles. "
            "A second over-speeding offence lets police impound your driving licence."
        ),
        "keywords": [
            "mv 183", "section 183 motor vehicles", "over speeding", "overspeeding fine",
            "speed limit fine", "speeding challan", "speed camera fine", "speeding penalty",
        ],
    },
    {
        "key": "mv_184",
        "citation": "Motor Vehicles Act 1988, Section 184 — Driving dangerously",
        "short_label": "MV 184",
        "act": "MV",
        "official_text": (
            "Whoever drives a motor vehicle at a speed or in a manner which is dangerous to the "
            "public, or which causes a sense of alarm or distress to the occupants of the "
            "vehicle, other road users, and persons near roads, having regard to all the "
            "circumstances of the case including the nature, condition and use of the place where "
            "the vehicle is driven and the amount of traffic which actually is at the time or "
            "which might reasonably be expected to be in the place, shall be punishable for the "
            "first offence with imprisonment for a term which may extend to one year but shall "
            "not be less than six months or with a fine which shall not be less than one thousand "
            "rupees but may extend to five thousand rupees, or with both, and for any second or "
            "subsequent offence, if committed within three years of the commission of the previous "
            "similar offence, with imprisonment for a term which may extend to two years, or with "
            "a fine of ten thousand rupees, or with both.\n"
            "Explanation.—For the purpose of this section,—\n"
            "(a) jumping a red light;\n"
            "(b) violating a stop sign;\n"
            "(c) use of handheld communications devices while driving;\n"
            "(d) passing or overtaking other vehicles in a manner contrary to law;\n"
            "(e) driving against the authorised flow of traffic;\n"
            "(f) driving in any manner that falls far below what would be expected of a competent "
            "and careful driver and where it would be obvious to a competent and careful driver "
            "that driving in that manner would be dangerous,\n"
            "shall amount to driving in such manner which is dangerous to the public."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Jumping a red light, using a phone while driving, wrong-side driving or rash "
            "overtaking counts as DANGEROUS driving — 6 months to 1 year jail and ₹1,000–₹5,000 "
            "fine for a first offence, and up to 2 years jail or ₹10,000 for a repeat within 3 "
            "years."
        ),
        "keywords": [
            "mv 184", "section 184 motor vehicles", "dangerous driving", "rash driving",
            "red light jump", "signal jump fine", "mobile phone while driving",
            "phone driving fine", "wrong side driving", "wrong side fine",
            "reckless driving", "overtaking fine", "stop sign violation",
        ],
    },
    {
        "key": "mv_196",
        "citation": "Motor Vehicles Act 1988, Section 196 — Driving uninsured vehicle",
        "short_label": "MV 196",
        "act": "MV",
        "official_text": (
            "Whoever drives a motor vehicle or causes or allows a motor vehicle to be driven in "
            "contravention of the provisions of section 146 shall be punishable with imprisonment "
            "for a term which may extend to three months, or with fine of two thousand rupees, or "
            "with both; and for a subsequent offence, with imprisonment for a term which may "
            "extend to three months, or with fine of four thousand rupees, or with both."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Third-party insurance is compulsory. Driving without valid insurance is a ₹2,000 "
            "fine (₹4,000 for a repeat) and can also mean up to 3 months jail."
        ),
        "keywords": [
            "mv 196", "section 196 motor vehicles", "no insurance fine",
            "driving without insurance", "insurance expired vehicle", "third party insurance",
            "uninsured vehicle penalty", "insurance challan",
        ],
    },
    {
        "key": "mv_199a",
        "citation": "Motor Vehicles Act 1988, Section 199A — Offences by juveniles",
        "short_label": "MV 199A",
        "act": "MV",
        "official_text": (
            "(1) Where an offence under this Act has been committed by a juvenile, the guardian "
            "of such juvenile or the owner of the motor vehicle shall be deemed to be guilty of "
            "the contravention and shall be liable to be proceeded against and punished "
            "accordingly:\n"
            "Provided that nothing in this sub-section shall render such guardian or owner liable "
            "to any punishment provided in this Act, if he proves that—(a) he had exercised all "
            "due and reasonable diligence to prevent the commission of such offence; or (b) the "
            "offence was committed without his knowledge or that the juvenile had committed the "
            "offence by taking the motor vehicle without his consent.\n"
            "(2) The guardian or the owner referred to in sub-section (1) shall be punishable with "
            "imprisonment for a term which may extend to three years and with a fine of "
            "twenty-five thousand rupees.\n"
            "(3) The registration of the motor vehicle used in the commission of the offence by "
            "the juvenile shall be cancelled for a period of twelve months.\n"
            "(4) The juvenile who has committed the offence shall not be eligible to be granted a "
            "driving licence under section 9 or a learner's licence under section 8 until he has "
            "attained the age of twenty-five years."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "If a minor is caught driving, the PARENT or vehicle owner is punished — up to 3 "
            "years jail and ₹25,000 fine, the vehicle's registration is cancelled for 12 months, "
            "and the minor cannot get a licence until age 25."
        ),
        "keywords": [
            "mv 199a", "section 199a motor vehicles", "minor driving", "juvenile driving",
            "underage driving punishment", "child driving car", "parent liable minor driving",
            "school student driving bike", "minor caught driving fine",
        ],
    },
    {
        "key": "mv_130",
        "citation": "Motor Vehicles Act 1988, Section 130 — Duty to produce licence and certificate of registration",
        "short_label": "MV 130",
        "act": "MV",
        "official_text": (
            "(1) The driver of a motor vehicle in any public place shall, on demand by any police "
            "officer in uniform, produce his licence for examination:\n"
            "Provided that the driver may, if his licence has been submitted to, or has been "
            "seized by, any officer or authority under this or any other Act, produce in lieu of "
            "the licence a receipt or other acknowledgement issued by such officer or authority "
            "in respect thereof and thereafter produce the licence within such period, in such "
            "manner as the Central Government may prescribe to the police officer making the "
            "demand.\n"
            "(2) The conductor, if any, of a stage carriage shall, on demand by any police officer "
            "in uniform, produce for examination his licence.\n"
            "(3) The driver of a motor vehicle in any public place shall, on demand by any police "
            "officer in uniform, produce the certificate of insurance of the vehicle, and if "
            "the vehicle is a transport vehicle, the certificate of fitness, the certificate of "
            "registration and the permit, or such other documents as may be prescribed."
        ),
        "source_url": "https://www.indiacode.nic.in/handle/123456789/1798",
        "verified_at": "2026-06-01",
        "scope_note": (
            "Only a police officer IN UNIFORM can demand your licence, insurance and "
            "registration. If your licence was already seized, the receipt is enough. Digital "
            "documents on DigiLocker or mParivahan are legally valid."
        ),
        "keywords": [
            "mv 130", "section 130 motor vehicles", "produce documents traffic police",
            "police asked licence", "show rc insurance", "digilocker documents valid",
            "mparivahan documents", "which documents to carry driving",
            "traffic police document check",
        ],
    },
    # -------------------- RTI Rules 2012 (Central) --------------------
    {
        "key": "rti_rule_3",
        "citation": "Right to Information Rules 2012, Rule 3 — Application fee",
        "short_label": "RTI Rule 3",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "An application under sub-section (1) of section 6 of the Act shall be accompanied "
            "by a fee of rupees ten and shall ordinarily not contain more than five hundred words, "
            "excluding annexures, containing address of the Central Public Information Officer and "
            "of the applicant:\n"
            "Provided that no application shall be rejected on the ground that it contains more than "
            "five hundred words."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "To file an RTI with a Central government body, you pay only ₹10. Your application "
            "should ideally be under 500 words, but it CANNOT be rejected just for being longer."
        ),
        "keywords": [
            "rti rule 3", "rti fee", "rti application fee", "rti 10 rupees", "rti ten rupees",
            "rti cost", "how much rti fee", "rti word limit", "rti 500 words",
            "central rti rules", "rti 2012 rules",
        ],
    },
    {
        "key": "rti_rule_4",
        "citation": "Right to Information Rules 2012, Rule 4 — Fees for providing information",
        "short_label": "RTI Rule 4",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "Fee for providing information under sub-section (4) of section 4 and sub-sections (1) "
            "and (5) of section 7 of the Act shall be charged at the following rates, namely:—\n"
            "(a) rupees two for each page in A-4 or A-3 size paper created or copied;\n"
            "(b) actual cost or price of a copy in larger size paper;\n"
            "(c) actual cost or price for samples or models;\n"
            "(d) rupees fifty per diskette; and\n"
            "(e) price fixed for a publication or rupees two per page of photocopy for extracts from "
            "the publication.\n"
            "For inspection of records, no fee for the first hour; and a fee of rupees five for each "
            "fifteen minutes (or fraction thereof) thereafter."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "After filing an RTI, you pay ₹2 per A4/A3 page of the information. Samples/models are "
            "at cost, a CD is ₹50. Inspection of records is FREE for the first hour and ₹5 per 15 "
            "minutes after that."
        ),
        "keywords": [
            "rti rule 4", "rti photocopy fee", "rti page fee", "rti 2 rupees per page",
            "rti additional fee", "rti inspection fee", "rti cd fee", "rti sample fee",
            "cost of rti reply", "rti copying charges",
        ],
    },
    {
        "key": "rti_rule_5",
        "citation": "Right to Information Rules 2012, Rule 5 — Exemption from payment of fee",
        "short_label": "RTI Rule 5",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "No fee under rule 3 and rule 4 shall be charged from any person who is below poverty "
            "line provided a copy of the certificate issued by the appropriate Government in this "
            "regard is submitted along with the application."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "If you hold a Below Poverty Line (BPL) card, you pay NO RTI fee — neither the ₹10 "
            "application fee nor the per-page copy fee. Just attach a copy of your BPL certificate "
            "with the application."
        ),
        "keywords": [
            "rti rule 5", "rti bpl", "rti free bpl", "rti poverty line", "rti fee exemption",
            "rti no fee", "bpl certificate rti", "rti below poverty",
        ],
    },
    {
        "key": "rti_rule_6",
        "citation": "Right to Information Rules 2012, Rule 6 — Appeal to the First Appellate Authority",
        "short_label": "RTI Rule 6",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "A person aggrieved by the decision of the Central Public Information Officer, or "
            "otherwise for not receiving the information within the time specified in the Act, may "
            "file an appeal to the First Appellate Authority. The appeal shall be accompanied by "
            "self-attested copies of the documents pertaining to the appellant. The First Appellate "
            "Authority shall dispose of the appeal in accordance with the provisions of the Act."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "If your RTI is refused or you get no reply within 30 days, file a FIRST APPEAL to the "
            "First Appellate Authority (a senior officer of the same department) within 30 days. "
            "Attach self-attested copies of your RTI and the reply/refusal."
        ),
        "keywords": [
            "rti rule 6", "first appellate authority", "faa rti", "how to file rti appeal",
            "rti appeal procedure", "rti appeal form", "rti no reply appeal",
            "appeal against pio", "first appeal rti",
        ],
    },
    {
        "key": "rti_rule_8",
        "citation": "Right to Information Rules 2012, Rule 8 — Disposal of appeal",
        "short_label": "RTI Rule 8",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "The First Appellate Authority shall dispose of the appeal within a period of thirty "
            "days from the date of its receipt, or within such extended period not exceeding a "
            "total of forty-five days from the date of filing thereof, after recording in writing "
            "the reasons for such extension. The order of the First Appellate Authority shall be "
            "communicated to the appellant in writing."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "The First Appellate Authority must decide your RTI appeal within 30 days. It can "
            "extend by up to 15 days more (total 45 days) but only with a written reason. You must "
            "get the order in writing."
        ),
        "keywords": [
            "rti rule 8", "rti appeal timeline", "rti first appeal 30 days", "rti appeal 45 days",
            "rti appeal disposal", "faa timeline", "when will first appeal be decided",
        ],
    },
    {
        "key": "rti_rule_9",
        "citation": "Right to Information Rules 2012, Rule 9 — Personal presence of the appellant before the First Appellate Authority",
        "short_label": "RTI Rule 9",
        "act": "RTIR",
        "require_any": ["rti", "information", "pio", "public authority"],
        "official_text": (
            "The appellant may at his discretion be present in person or through a duly authorized "
            "representative or through video conferencing, if the facility of video conferencing is "
            "available, at the time of hearing of the appeal by the First Appellate Authority. "
            "Where the appellant is unable to attend the hearing, the First Appellate Authority may, "
            "in its discretion, decide the appeal on the basis of records available with it."
        ),
        "source_url": "https://www.pmindia.gov.in/wp-content/uploads/2017/04/RTIRules_2012_English_0.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "You DO NOT have to attend the RTI appeal hearing in person. You can appear yourself, "
            "send an authorised representative, or join via video conference if available. If you "
            "cannot attend, the Appellate Authority can still decide based on records."
        ),
        "keywords": [
            "rti rule 9", "rti hearing", "rti appeal hearing", "attend rti appeal",
            "rti representative", "rti video conference", "rti appellant presence",
            "who can attend rti hearing",
        ],
    },
    # -------------------- Consumer Protection (E-Commerce) Rules 2020 --------------------
    {
        "key": "cprules_ecomm_4",
        "citation": "Consumer Protection (E-Commerce) Rules 2020, Rule 4 — Duties of e-commerce entities",
        "short_label": "E-Comm Rule 4",
        "act": "CPER",
        "official_text": (
            "(1) An e-commerce entity shall be a company incorporated under the Companies Act, or "
            "a foreign company covered under section 2(42) of that Act, or an office/branch/agency "
            "in India owned or controlled by a person resident outside India.\n"
            "(2) Every e-commerce entity shall provide the following information in a clear and "
            "accessible manner on its platform: legal name of the entity; principal geographic "
            "address of its headquarters and all branches; name and details of its website; and "
            "contact details including e-mail, fax, landline and mobile numbers of customer care "
            "and of the grievance officer.\n"
            "(3) No e-commerce entity shall adopt any unfair trade practice, whether in the course "
            "of business on its platform or otherwise.\n"
            "(4) Every e-commerce entity shall establish an adequate grievance redressal mechanism "
            "having regard to the number of consumers, and shall appoint a grievance officer for "
            "consumer grievance redressal, whose name, contact details and designation shall be "
            "displayed on the platform.\n"
            "(5) The grievance officer shall acknowledge receipt of any consumer complaint within "
            "forty-eight hours and redress the complaint within one month from the date of receipt."
        ),
        "source_url": "https://consumeraffairs.gov.in/sites/default/files/E-commerce%20rules.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "Every online shopping platform (Amazon, Flipkart, Meesho, etc.) MUST show its legal "
            "name, address and grievance officer contact clearly on the site. Your complaint must "
            "be acknowledged in 48 hours and resolved within one month. Unfair trade is banned."
        ),
        "keywords": [
            "e-commerce rules 4", "ecommerce rules 4", "online shopping rules", "grievance officer",
            "amazon complaint", "flipkart complaint", "meesho complaint", "48 hours acknowledgement",
            "one month redressal", "e-commerce grievance", "online seller details",
            "consumer protection e-commerce", "unfair trade e-commerce",
        ],
    },
    {
        "key": "cprules_ecomm_4b",
        "citation": "Consumer Protection (E-Commerce) Rules 2020, Rule 4(9)–(11) — Consumer consent and cancellation charges",
        "short_label": "E-Comm Rule 4(9)",
        "act": "CPER",
        "official_text": (
            "(9) No e-commerce entity shall impose cancellation charges on consumers cancelling "
            "after confirming purchase unless similar charges are also borne by the e-commerce "
            "entity, if such entity cancels the purchase order unilaterally for any reason.\n"
            "(10) Every e-commerce entity shall only record the consent of a consumer for the "
            "purchase of any good or service on its platform where such consent is expressed "
            "through an explicit and affirmative action, and no such entity shall record such "
            "consent automatically, including in the form of pre-ticked check-boxes.\n"
            "(11) Every e-commerce entity shall effect all payments towards accepted refund "
            "requests of the consumers as prescribed by the Reserve Bank of India or any other "
            "competent authority under any law for the time being in force, within a reasonable "
            "period of time, or as prescribed under applicable laws."
        ),
        "source_url": "https://consumeraffairs.gov.in/sites/default/files/E-commerce%20rules.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "Online sellers CANNOT charge you cancellation fees unless they also lose the same "
            "amount when they cancel. Consent for a purchase must be a clear tap — pre-ticked "
            "check-boxes are illegal. Refunds owed to you must be paid in a reasonable time."
        ),
        "keywords": [
            "e-commerce rule 4(9)", "cancellation charges online", "cancellation fee amazon",
            "pre ticked checkbox illegal", "auto consent illegal", "online refund delay",
            "refund not received", "e-commerce refund time", "flipkart cancellation fee",
            "online purchase consent",
        ],
    },
    {
        "key": "cprules_ecomm_5",
        "citation": "Consumer Protection (E-Commerce) Rules 2020, Rule 5 — Liabilities of marketplace e-commerce entities",
        "short_label": "E-Comm Rule 5",
        "act": "CPER",
        "official_text": (
            "(1) A marketplace e-commerce entity which seeks to avail the exemption from liability "
            "under sub-section (1) of section 79 of the Information Technology Act, 2000 shall "
            "comply with sub-sections (2) and (3) of that section, including the instructions of "
            "the intermediary guidelines.\n"
            "(2) Every marketplace e-commerce entity shall require sellers through an undertaking "
            "to ensure that descriptions, images, and other content pertaining to goods or services "
            "on their platform are accurate and correspond directly with the appearance, nature, "
            "quality, purpose and other general features of such good or service.\n"
            "(3) Every marketplace e-commerce entity shall provide the following information in a "
            "clear and accessible manner, displayed prominently to its users at the appropriate "
            "place on its platform: details about sellers offering goods and services, including "
            "the name of the business, principal geographic address, name of the website, contact "
            "details, and any rating or other aggregated feedback about such seller.\n"
            "(4) Any information provided to a user must enable the user to make an informed "
            "decision at the pre-purchase stage on its platform including guarantees, warranties, "
            "delivery, exchange, return, refund, modes of payment, grievance redressal mechanism, "
            "and any relevant details required to enable consumers to make informed choices."
        ),
        "source_url": "https://consumeraffairs.gov.in/sites/default/files/E-commerce%20rules.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "Marketplaces (Amazon, Flipkart) must show YOU the seller's name, address, rating and "
            "the full return/warranty/refund/payment details BEFORE you buy. They must also make "
            "sellers guarantee that images and descriptions match the actual product."
        ),
        "keywords": [
            "e-commerce rule 5", "marketplace liability", "amazon liability", "flipkart liability",
            "seller details marketplace", "wrong product delivered", "misleading listing",
            "return policy display", "warranty display online", "product description accurate",
            "marketplace responsibility",
        ],
    },
    {
        "key": "cprules_ecomm_6",
        "citation": "Consumer Protection (E-Commerce) Rules 2020, Rule 6 — Duties of sellers on marketplace",
        "short_label": "E-Comm Rule 6",
        "act": "CPER",
        "official_text": (
            "(1) No seller offering goods or services through a marketplace e-commerce entity "
            "shall adopt any unfair trade practice whether in the course of offer on the "
            "e-commerce entity's platform or otherwise.\n"
            "(2) No seller through a marketplace e-commerce entity shall falsely represent itself "
            "as a consumer and post reviews about goods and services or misrepresent the quality "
            "or the features of any goods and services.\n"
            "(3) No seller offering goods or services through a marketplace e-commerce entity "
            "shall refuse to take back goods, or withdraw or discontinue services purchased or "
            "agreed to be purchased, or refuse to refund consideration, if paid, if such goods or "
            "services are defective, deficient or spurious, or if the goods or services are not of "
            "the characteristics or features as advertised or as agreed to, or if they are "
            "delivered late from the stated delivery schedule.\n"
            "(5) Every seller through a marketplace e-commerce entity shall provide to the "
            "e-commerce entity the following information, which shall be displayed prominently to "
            "its users by the e-commerce entity: total price, breakup of the price showing all "
            "compulsory and voluntary charges such as delivery charges, postage and handling "
            "charges, conveyance charges and applicable tax, mandatory notices and information; "
            "expiry date; country of origin; name and details of importer where applicable; "
            "guarantees related to authenticity or genuineness; grievance officer details; "
            "and terms of exchange, returns and refund."
        ),
        "source_url": "https://consumeraffairs.gov.in/sites/default/files/E-commerce%20rules.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "A seller on Amazon/Flipkart CANNOT post fake reviews or refuse a refund/return if the "
            "product is defective, spurious, not as advertised, or delivered late. They must also "
            "display total price with all taxes/charges, expiry date, country of origin and "
            "grievance officer details up front."
        ),
        "keywords": [
            "e-commerce rule 6", "seller duties marketplace", "defective product return",
            "fake reviews", "spurious product refund", "late delivery refund", "country of origin",
            "hidden charges online", "seller refuses refund", "seller no return policy",
            "online shopping refund",
        ],
    },
    {
        "key": "cprules_ecomm_7",
        "citation": "Consumer Protection (E-Commerce) Rules 2020, Rule 7 — Duties and liabilities of inventory e-commerce entities",
        "short_label": "E-Comm Rule 7",
        "act": "CPER",
        "official_text": (
            "(1) Every inventory e-commerce entity shall provide the following information in a "
            "clear and accessible manner, displayed prominently to its users: accurate information "
            "related to return, refund, exchange, warranty and guarantee, delivery and shipment, "
            "modes of payment, and grievance redressal mechanism.\n"
            "(2) Every inventory e-commerce entity shall provide the following information: all "
            "mandatory notices and information provided by applicable laws; information relating "
            "to total price in single figure of any good or service, along with the breakup price "
            "for the good or service, showing all the compulsory and voluntary charges; expiry "
            "date of goods; country of origin.\n"
            "(3) No inventory e-commerce entity shall falsely represent itself as a consumer and "
            "post reviews about goods and services, or misrepresent the quality or features of any "
            "goods and services.\n"
            "(4) No inventory e-commerce entity shall refuse to take back goods, or refuse to "
            "refund consideration, if such goods or services are defective, deficient or spurious, "
            "or are not of the characteristics or features as advertised, or if the goods or "
            "services are delivered late from the stated delivery schedule."
        ),
        "source_url": "https://consumeraffairs.gov.in/sites/default/files/E-commerce%20rules.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "Direct online sellers (who own their stock — e.g. Myntra, Nykaa, brand websites) must "
            "show return, refund, warranty, delivery and payment details clearly. Fake reviews are "
            "banned. They must refund you for defective, spurious or wrongly-described goods, or "
            "for late delivery."
        ),
        "keywords": [
            "e-commerce rule 7", "inventory e-commerce", "direct seller website", "nykaa refund",
            "myntra refund", "brand website refund", "online defective product",
            "expiry date online", "fake reviews inventory", "single price online",
        ],
    },
    # -------------------- Central Motor Vehicles Rules 1989 --------------------
    {
        "key": "cmvr_138_3",
        "citation": "Central Motor Vehicles Rules 1989, Rule 138(3) — Wearing of seat belts",
        "short_label": "CMVR 138(3)",
        "act": "CMVR",
        "official_text": (
            "In a motor vehicle in which seat belts have been provided under the provisions of "
            "sub-rule (1) or sub-rule (1A) or sub-rule (1B), it shall be ensured by the driver "
            "that he and the person seated in the front seat or the persons occupying front facing "
            "rear seats, as the case may be, wear the seat belts while the vehicle is in motion."
        ),
        "source_url": "https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1084_00001_00001_1554966634246&type=rule&filename=the_central_motor_vehicles_rules,_1989.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "In any car with seat belts fitted, the driver AND front-seat passenger AND "
            "front-facing rear-seat passengers MUST wear seat belts while the vehicle is moving. "
            "The driver is responsible for making sure everyone belts up."
        ),
        "keywords": [
            "cmvr 138", "rule 138 seat belt", "car seat belt rule", "rear seat belt rule",
            "back seat seat belt", "seat belt front seat", "driver responsibility seat belt",
            "seat belt while moving", "central motor vehicles rules seat belt",
        ],
    },
    {
        "key": "cmvr_138_4f",
        "citation": "Central Motor Vehicles Rules 1989, Rule 138(4)(f) — Supply of protective headgear with two-wheeler",
        "short_label": "CMVR 138(4)(f)",
        "act": "CMVR",
        "official_text": (
            "In addition to the requirements specified in sub-rules (1), (2) and (3), the "
            "manufacturer of a two-wheeled motor vehicle shall, at the time of sale, supply a "
            "protective headgear (helmet) conforming to the specifications of the Bureau of "
            "Indian Standards, subject to the exemption specified in section 129 of the Act and "
            "the applicable rules made by the State Government."
        ),
        "source_url": "https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1084_00001_00001_1554966634246&type=rule&filename=the_central_motor_vehicles_rules,_1989.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "When you buy a new two-wheeler (bike/scooter), the manufacturer MUST supply a "
            "BIS-approved helmet along with it. Sikhs wearing turbans are exempt under Section 129 "
            "of the MV Act."
        ),
        "keywords": [
            "cmvr 138 4f", "helmet with bike purchase", "helmet with two wheeler",
            "manufacturer helmet mandatory", "bis helmet", "helmet standard",
            "new bike helmet", "helmet law india",
        ],
    },
    {
        "key": "cmvr_138_7",
        "citation": "Central Motor Vehicles Rules 1989, Rule 138(7) — Safety measures for children on motor cycles",
        "short_label": "CMVR 138(7)",
        "act": "CMVR",
        "official_text": (
            "In respect of a child of the age above nine months and below four years being carried "
            "on a motor cycle, the following provisions shall be complied with:—\n"
            "(a) the driver of the motor cycle shall ensure that the child is wearing a crash "
            "helmet meeting the specifications of the Bureau of Indian Standards or a bicycle "
            "helmet as prescribed by the Bureau of Indian Standards or a European Committee for "
            "Standardization, Snell Memorial Foundation, or an American National Standards "
            "Institute-approved bicycle helmet;\n"
            "(b) the driver of the motor cycle shall ensure that the child on the motor cycle is "
            "attached to the driver by using a safety harness;\n"
            "(c) the speed of the motor cycle carrying a child of the age above nine months and "
            "below four years shall not exceed forty kilometres per hour."
        ),
        "source_url": "https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1084_00001_00001_1554966634246&type=rule&filename=the_central_motor_vehicles_rules,_1989.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "If you carry a child aged 9 months to 4 years on a two-wheeler, the child must wear "
            "a BIS/international-standard helmet, be secured to you with a safety harness, and "
            "the bike speed must NOT exceed 40 km/h."
        ),
        "keywords": [
            "cmvr 138 7", "child on motorcycle", "child pillion rule", "toddler on bike",
            "child helmet law", "safety harness child bike", "40 kmph child bike",
            "9 months to 4 years bike", "kids on scooter rule",
        ],
    },
    {
        "key": "cmvr_118",
        "citation": "Central Motor Vehicles Rules 1989, Rule 118 — Speed governors",
        "short_label": "CMVR 118",
        "act": "CMVR",
        "official_text": (
            "On and from the date of commencement of the Central Motor Vehicles (Fourteenth "
            "Amendment) Rules, 2015, every transport vehicle shall be fitted with a speed "
            "limiting device or shall have inbuilt speed limiting function, which is sealed by "
            "the manufacturer or any testing agency specified by the Central Government, or a "
            "dealer or operator or the manufacturer of a speed limiting device, in such a manner "
            "that its maximum speed does not exceed 80 kmph or as notified by the Central "
            "Government from time to time.\n"
            "Provided that the following categories of transport vehicles shall be exempt from "
            "this rule: (a) vehicles used for police, fire fighting and ambulance purposes; "
            "(b) two and three wheeled transport vehicles; and (c) such vehicles as may be "
            "exempted by the Central Government by notification in the Official Gazette."
        ),
        "source_url": "https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1084_00001_00001_1554966634246&type=rule&filename=the_central_motor_vehicles_rules,_1989.pdf",
        "verified_at": "2026-02-14",
        "scope_note": (
            "Buses, trucks, taxis and other transport vehicles MUST have a sealed speed limiter "
            "capping speed at 80 km/h. Police, fire, ambulance, two-wheelers and three-wheelers "
            "are exempt."
        ),
        "keywords": [
            "cmvr 118", "speed governor rule", "speed limiter truck", "speed limiter bus",
            "80 kmph transport vehicle", "speed limiting device", "commercial vehicle speed",
            "taxi speed limit", "goods vehicle speed",
        ],
    },
]

# ---------------------------------------------------------------------------
# Legacy codes (IPC 1860 / CrPC 1973) live in their own module because they are
# large and are still needed for every matter arising before 1 July 2024.
# ---------------------------------------------------------------------------
from corpus_ipc import IPC_CRPC_CORPUS  # noqa: E402

CORPUS.extend(IPC_CRPC_CORPUS)

# Cheque bounce (Negotiable Instruments Act) and cyber fraud (IT Act + BNS
# cheating sections + the official reporting pathways) — the two biggest
# refusal buckets in the A4 analytics, so they live in their own modules.
from corpus_ni import NI_CORPUS  # noqa: E402
from corpus_cyber import CYBER_CORPUS  # noqa: E402

CORPUS.extend(NI_CORPUS)
CORPUS.extend(CYBER_CORPUS)

# Wages, termination and gratuity under the four Labour Codes (in force since
# 21 November 2025) — the `wage_labour` refusal bucket.
from corpus_labour import LABOUR_CORPUS  # noqa: E402

CORPUS.extend(LABOUR_CORPUS)

# Citizen-rights clusters (protest/assembly, FIR refusal, bail, under-trial
# detention, consumer protection, RTI, child labour/marriage, senior-citizen
# maintenance) — audited against the MongoDB corpus and added as their own
# module, same pattern as LABOUR_CORPUS above.
from corpus_rights import RIGHTS_CORPUS  # noqa: E402

CORPUS.extend(RIGHTS_CORPUS)

# Non-Indian jurisdictions — trap-question refusal helper
NON_INDIAN_JURISDICTION_KEYWORDS = [
    "texas", "california", "florida", "new york state", "uk law", "united kingdom law",
    "canadian law", "canada law", "australian law", "us law", "u.s. law", "american law",
    "pakistan law", "bangladesh law", "sri lanka law", "china law", "russia law",
    "singapore law", "usa law",
]

# Non-legal / advisory questions the tool should decline
NON_LEGAL_ADVICE_KEYWORDS = [
    "should i forgive", "should i marry", "should i divorce", "should i quit",
    "give me advice", "personal advice", "what should i do with my life",
    "moral advice", "religious advice",
]


# Retrieval scoring + the ≥2-word corroboration rule are defined once in
# retrieval_logic and shared with corpus_db.py — never duplicated here.
from retrieval_logic import (  # noqa: E402
    _norm,
    _tokens,
    BASE_STOPWORDS as _STOP,
    RETRIEVAL_MIN_SCORE,
    build_token_df,
    make_token_weight,
    score_items,
    corroborated,
    relative_top_cutoff,
)


# ---------------------------------------------------------------------------
# Token specificity table (poor-man's IDF), built ONCE from the fully
# assembled CORPUS. The scoring loop and token weighting live in
# retrieval_logic (shared with corpus_db.py); here we only bind them to
# this corpus's document frequencies.
# ---------------------------------------------------------------------------
_TOKEN_DF: dict = build_token_df(CORPUS)
_token_weight = make_token_weight(_TOKEN_DF)


def _score_all(question: str) -> list[tuple[int, dict]]:
    """Score every corpus entry against the question. Returns ALL entries that
    scored > 0, sorted descending — WITHOUT the RETRIEVAL_MIN_SCORE cutoff.
    Thin wrapper over the shared scorer in retrieval_logic; used by retrieve()
    (which applies the cutoff) and top_candidate_debug() (which needs to see
    sub-threshold candidates for refusal analytics)."""
    return score_items(question, CORPUS, _token_weight)


def retrieve(question: str, limit: int = 3) -> list[dict]:
    """
    Deterministic retrieval over the verified corpus.

    Score per corpus entry:
      +12 if the entry's short_label appears (e.g. "bnss 35", "ipc 498a", "article 21")
      +6  if a multi-word keyword appears as a contiguous substring
      +   weighted token overlap (rare tokens 4, common tokens 1)

    i.e. it needs either a label hit, a phrase hit, or at least one reasonably
    specific word in common — a single generic word like "police" is not
    enough on its own.

    Final slice uses the shared relative_top_cutoff (retrieval_logic.py) — a
    clear winner must not drag along entries scoring under half its score.
    """
    scored = [
        (s, it) for s, it in _score_all(question)
        if s >= RETRIEVAL_MIN_SCORE and corroborated(question, it)
    ]
    return relative_top_cutoff(scored, limit, RETRIEVAL_MIN_SCORE)


def top_candidate_debug(question: str) -> dict:
    """Refusal-analytics helper (NOT used for answers). Returns the single
    best-scoring candidate for a question EVEN IF it is below the confidence
    threshold or the corpus has nothing at all — so refusal events can record
    a score distribution and distinguish 'nothing came close' from 'something
    scored just under the bar'. Never exposed to the end user.
    Returns: {"top_score": int, "top_key": str|None, "content_tokens": int}
    """
    q_tokens = _tokens(question) - _STOP
    scored = _score_all(question)
    if not scored:
        return {"top_score": 0, "top_key": None, "content_tokens": len(q_tokens)}
    top_score, top_item = scored[0]
    return {
        "top_score": top_score,
        "top_key": top_item.get("short_label"),
        "content_tokens": len(q_tokens),
    }


# ---------------------------------------------------------------------------
# Topic classifier for refusal analytics ONLY (never shown to the user).
# Independent of what is actually IN the corpus today — the point is to see
# which real-world scenarios people ask about so we know what to build next,
# even for acts we do not cover yet (e.g. cheque bounce, cyber fraud).
# ---------------------------------------------------------------------------
TOPIC_KEYWORDS: dict = {
    "cheque_bounce_financial": [
        "cheque bounce", "check bounce", "cheque return", "chек", "cheque dishonour",
        "cheque dishonoured", "bounced cheque", "138", "post dated cheque", "emi default",
        "loan default", "insufficient funds cheque",
    ],
    "cyber_fraud": [
        "online fraud", "otp fraud", "upi fraud", "phishing", "hacked", "cyber crime",
        "cybercrime", "online scam", "fake website", "sim swap", "credit card fraud",
        "digital arrest", "investment scam", "trading app fraud", "whatsapp scam",
        "phone scam", "account hacked", "money debited fraud",
    ],
    "wage_labour": [
        "salary not paid", "wages not paid", "employer not paying", "termination job",
        "fired from job", "retrenchment", "notice period", "gratuity", "bonus not paid",
        "provident fund", "pf withdrawal", "esi", "contract labour", "minimum wage",
        "unpaid overtime", "wrongful termination", "labour commissioner",
    ],
    "tenancy_rent": [
        "landlord", "tenant", "rent agreement", "security deposit", "eviction",
        "rent control", "house owner", "vacate notice", "rental dispute",
    ],
    "marriage_divorce": [
        "divorce", "marriage", "alimony", "child custody", "maintenance wife",
        "mutual divorce", "judicial separation", "annulment", "nikah", "talaq",
        "remarriage", "second marriage",
    ],
    "inheritance_property": [
        "inheritance", "property dispute", "will", "succession", "ancestral property",
        "property partition", "land dispute", "property registration",
    ],
    "arrest_police": [
        "arrest", "police custody", "warrant", "detained", "police station rights",
    ],
    "fir_complaint": ["fir", "police complaint", "lodge complaint", "zero fir"],
    "bail": ["bail", "anticipatory bail", "surety", "custody release"],
    "domestic_violence": ["domestic violence", "husband beats", "dowry", "in-laws harassment"],
    "consumer": ["consumer complaint", "defective product", "faulty goods", "refund denied"],
    "motor_vehicle_traffic": ["helmet", "traffic fine", "challan", "driving licence", "seat belt", "drunk driving"],
    "rti": ["rti", "right to information", "public information officer"],
    "senior_citizens": ["senior citizen", "elderly parents", "old age maintenance"],
    "drugs_ndps": ["drugs case", "narcotics", "ganja", "possession of drugs"],
    "defamation_reputation": ["defamation", "false allegations", "reputation damage"],
    "business_contract": ["business partner", "breach of contract", "agreement violated", "partnership dispute"],
    "tax": ["income tax", "gst", "tax notice"],
}


def classify_topic(question: str) -> str:
    q_norm = _norm(question)
    for topic, phrases in TOPIC_KEYWORDS.items():
        for phrase in phrases:
            if _norm(phrase) and _norm(phrase) in q_norm:
                return topic
    return "other_uncategorized"


def is_non_indian_jurisdiction(question: str) -> bool:
    q = _norm(question)
    return any(_norm(k) in q for k in NON_INDIAN_JURISDICTION_KEYWORDS)


def is_non_legal_advice(question: str) -> bool:
    q = _norm(question)
    return any(_norm(k) in q for k in NON_LEGAL_ADVICE_KEYWORDS)


def public_citation(item: dict) -> dict:
    """Client-safe subset of a corpus entry."""
    return {
        "key": item["key"],
        "citation": item["citation"],
        "short_label": item["short_label"],
        "act": item["act"],
        "official_text": item["official_text"],
        "source_url": item["source_url"],
        "verified_at": item["verified_at"],
        # Present only on state entries and on entries whose official_text is a
        # faithful summary rather than a word-for-word quote. The UI labels these
        # honestly so a user is never told a summary is a verbatim quote.
        "text_kind": item.get("text_kind", "verbatim"),
        "state": item.get("state"),
    }


def with_historical_notice(citation: dict, item: dict) -> dict:
    """If `item` was annotated by law_status_guard.annotate_provisions() as
    INACTIVE-but-historical (historical_still_applicable=True — see that
    function for why it is deliberately NOT marked is_dead_law), prepend the
    historical framing to the citation's official_text so the user sees it
    without any frontend change (reuses the same "warning prefix on the
    text" pattern already used for DB-backed dead-law citations). Returns a
    NEW dict; `citation` and `item` are never mutated."""
    notice = item.get("historical_notice")
    if not notice:
        return citation
    out = dict(citation)
    out["official_text"] = f"{notice}\n\n{out.get('official_text', '')}"
    out["historical_notice"] = notice
    return out


# ---------------------------------------------------------------------------
# State / UT layer. Central law answers only half of a rent, liquor, traffic
# compounding or stamp duty question — the rest is state law. We score the
# state corpus with the SAME algorithm, but only against entries belonging to
# the user's state, and we never fall back to another state's rules.
# ---------------------------------------------------------------------------
from corpus_state import STATE_CORPUS, STATE_SENSITIVE_TOPICS  # noqa: E402


def _score_items(question: str, items: list) -> list[tuple[int, dict]]:
    """Score arbitrary items (e.g. the state corpus) against the question.
    Thin wrapper over the shared scorer in retrieval_logic, using the
    CORPUS-derived token weights so state entries are ranked on the same
    IDF scale as central ones."""
    return score_items(question, items, _token_weight)


def retrieve_state(question: str, state: str, limit: int = 2) -> list[dict]:
    """Verified rules that apply ONLY inside the user's state / UT."""
    code = (state or "").upper()
    if not code:
        return []
    items = [it for it in STATE_CORPUS if it.get("state") == code]
    if not items:
        return []
    scored = [(s, it) for s, it in _score_items(question, items) if s >= RETRIEVAL_MIN_SCORE]
    return [it for _, it in scored[:limit]]


def state_sensitive_topic(question: str):
    """If the question is on a subject where STATE law decides the answer,
    return {"topic", "label", "authority"}. Used to tell the user honestly that
    the local rule matters — never to invent a local rule."""
    q = _norm(question)
    for topic, meta in STATE_SENSITIVE_TOPICS.items():
        for kw in meta["keywords"]:
            k = _norm(kw)
            if k and k in q:
                return {"topic": topic, "label": meta["label"], "authority": meta["authority"]}
    return None


REFUSAL_NO_CORPUS = (
    "I cannot confirm this from the official text. Please consult an advocate."
)

REFUSAL_NON_INDIAN = (
    "I only cover Indian law (BNS, BNSS, and the Constitution of India). "
    "For laws of other countries or states, please consult an advocate in that jurisdiction."
)

REFUSAL_NOT_LEGAL = (
    "I can only help with questions about Indian law, your rights, and legal procedure. "
    "For personal or life advice, please speak to a family elder or counsellor."
)


# ---------------------------------------------------------------------------
# Localized refusal messages — keyed by language code (matches /api/reference/
# languages). Languages without a translation fall back to English.
# ---------------------------------------------------------------------------
REFUSAL_TRANSLATIONS: dict = {
    "hi": {
        "no_corpus": "मेरे पास इसके लिए कोई सत्यापित स्रोत नहीं है। कृपया किसी वकील से सलाह लें।",
        "non_indian": "मैं केवल भारतीय कानून (BNS, BNSS और भारत का संविधान) की जानकारी देती हूँ। अन्य देशों के कानूनों के लिए कृपया वहाँ के वकील से संपर्क करें।",
        "not_legal": "मैं केवल भारतीय कानून, आपके अधिकारों और कानूनी प्रक्रिया से जुड़े सवालों में मदद कर सकती हूँ। निजी या जीवन संबंधी सलाह के लिए कृपया परिवार के बड़ों या परामर्शदाता से बात करें।",
    },
    "bn": {
        "no_corpus": "এর জন্য আমার কাছে কোনো যাচাইকৃত সূত্র নেই। অনুগ্রহ করে একজন আইনজীবীর পরামর্শ নিন।",
        "non_indian": "আমি শুধুমাত্র ভারতীয় আইন (BNS, BNSS এবং ভারতের সংবিধান) নিয়ে সাহায্য করি। অন্য দেশের আইনের জন্য সেই দেশের আইনজীবীর পরামর্শ নিন।",
        "not_legal": "আমি শুধুমাত্র ভারতীয় আইন, আপনার অধিকার এবং আইনি প্রক্রিয়া সংক্রান্ত প্রশ্নে সাহায্য করতে পারি। ব্যক্তিগত পরামর্শের জন্য পরিবারের বড়দের বা পরামর্শদাতার সঙ্গে কথা বলুন।",
    },
    "ta": {
        "no_corpus": "இதற்கு என்னிடம் சரிபார்க்கப்பட்ட ஆதாரம் இல்லை. தயவுசெய்து ஒரு வழக்கறிஞரை அணுகவும்.",
        "non_indian": "நான் இந்திய சட்டங்களை (BNS, BNSS மற்றும் இந்திய அரசியலமைப்பு) மட்டுமே உள்ளடக்குகிறேன். பிற நாடுகளின் சட்டங்களுக்கு அந்த நாட்டு வழக்கறிஞரை அணுகவும்.",
        "not_legal": "இந்திய சட்டம், உங்கள் உரிமைகள் மற்றும் சட்ட நடைமுறை தொடர்பான கேள்விகளுக்கு மட்டுமே என்னால் உதவ முடியும். தனிப்பட்ட ஆலோசனைக்கு குடும்பப் பெரியவர்கள் அல்லது ஆலோசகரிடம் பேசவும்.",
    },
    "te": {
        "no_corpus": "దీనికి నా వద్ద ధృవీకరించబడిన ఆధారం లేదు. దయచేసి న్యాయవాదిని సంప్రదించండి.",
        "non_indian": "నేను భారతీయ చట్టాలను (BNS, BNSS మరియు భారత రాజ్యాంగం) మాత్రమే కవర్ చేస్తాను. ఇతర దేశాల చట్టాల కోసం ఆ దేశపు న్యాయవాదిని సంప్రదించండి.",
        "not_legal": "భారతీయ చట్టం, మీ హక్కులు మరియు న్యాయ ప్రక్రియకు సంబంధించిన ప్రశ్నలకు మాత్రమే నేను సహాయం చేయగలను. వ్యక్తిగత సలహా కోసం కుటుంబ పెద్దలు లేదా కౌన్సెలర్‌తో మాట్లాడండి.",
    },
    "mr": {
        "no_corpus": "माझ्याकडे यासाठी कोणताही पडताळलेला स्रोत नाही. कृपया वकिलाचा सल्ला घ्या.",
        "non_indian": "मी फक्त भारतीय कायदे (BNS, BNSS आणि भारताचे संविधान) कव्हर करते. इतर देशांच्या कायद्यांसाठी तेथील वकिलाचा सल्ला घ्या.",
        "not_legal": "मी फक्त भारतीय कायदा, तुमचे हक्क आणि कायदेशीर प्रक्रियेशी संबंधित प्रश्नांमध्ये मदत करू शकते. वैयक्तिक सल्ल्यासाठी कुटुंबातील ज्येष्ठांशी किंवा समुपदेशकाशी बोला.",
    },
    "gu": {
        "no_corpus": "મારી પાસે આ માટે કોઈ ચકાસાયેલ સ્રોત નથી. કૃપા કરીને વકીલની સલાહ લો.",
        "non_indian": "હું ફક્ત ભારતીય કાયદા (BNS, BNSS અને ભારતનું બંધારણ) આવરી લઉં છું. અન્ય દેશોના કાયદા માટે ત્યાંના વકીલની સલાહ લો.",
        "not_legal": "હું ફક્ત ભારતીય કાયદો, તમારા અધિકારો અને કાનૂની પ્રક્રિયા સંબંધિત પ્રશ્નોમાં મદદ કરી શકું છું. અંગત સલાહ માટે પરિવારના વડીલો અથવા સલાહકાર સાથે વાત કરો.",
    },
    "kn": {
        "no_corpus": "ಇದಕ್ಕೆ ನನ್ನ ಬಳಿ ಪರಿಶೀಲಿಸಿದ ಮೂಲವಿಲ್ಲ. ದಯವಿಟ್ಟು ವಕೀಲರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "non_indian": "ನಾನು ಭಾರತೀಯ ಕಾನೂನುಗಳನ್ನು (BNS, BNSS ಮತ್ತು ಭಾರತದ ಸಂವಿಧಾನ) ಮಾತ್ರ ಒಳಗೊಳ್ಳುತ್ತೇನೆ. ಇತರ ದೇಶಗಳ ಕಾನೂನುಗಳಿಗೆ ಆ ದೇಶದ ವಕೀಲರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "not_legal": "ಭಾರತೀಯ ಕಾನೂನು, ನಿಮ್ಮ ಹಕ್ಕುಗಳು ಮತ್ತು ಕಾನೂನು ಪ್ರಕ್ರಿಯೆಗೆ ಸಂಬಂಧಿಸಿದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಮಾತ್ರ ನಾನು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ವೈಯಕ್ತಿಕ ಸಲಹೆಗಾಗಿ ಕುಟುಂಬದ ಹಿರಿಯರು ಅಥವಾ ಸಲಹೆಗಾರರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
    },
    "ml": {
        "no_corpus": "ഇതിന് എന്റെ പക്കൽ സ്ഥിരീകരിച്ച ഉറവിടമില്ല. ദയവായി ഒരു അഭിഭാഷകനെ സമീപിക്കുക.",
        "non_indian": "ഞാൻ ഇന്ത്യൻ നിയമങ്ങൾ (BNS, BNSS, ഇന്ത്യൻ ഭരണഘടന) മാത്രമേ ഉൾക്കൊള്ളുന്നുള്ളൂ. മറ്റ് രാജ്യങ്ങളിലെ നിയമങ്ങൾക്ക് അവിടത്തെ അഭിഭാഷകനെ സമീപിക്കുക.",
        "not_legal": "ഇന്ത്യൻ നിയമം, നിങ്ങളുടെ അവകാശങ്ങൾ, നിയമ നടപടിക്രമം എന്നിവയുമായി ബന്ധപ്പെട്ട ചോദ്യങ്ങളിൽ മാത്രമേ എനിക്ക് സഹായിക്കാനാകൂ. വ്യക്തിപരമായ ഉപദേശത്തിന് കുടുംബത്തിലെ മുതിർന്നവരോടോ കൗൺസിലറോടോ സംസാരിക്കുക.",
    },
    "pa": {
        "no_corpus": "ਮੇਰੇ ਕੋਲ ਇਸ ਲਈ ਕੋਈ ਤਸਦੀਕਸ਼ੁਦਾ ਸਰੋਤ ਨਹੀਂ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਵਕੀਲ ਦੀ ਸਲਾਹ ਲਓ।",
        "non_indian": "ਮੈਂ ਸਿਰਫ਼ ਭਾਰਤੀ ਕਾਨੂੰਨ (BNS, BNSS ਅਤੇ ਭਾਰਤ ਦਾ ਸੰਵਿਧਾਨ) ਕਵਰ ਕਰਦੀ ਹਾਂ। ਹੋਰ ਦੇਸ਼ਾਂ ਦੇ ਕਾਨੂੰਨਾਂ ਲਈ ਉੱਥੋਂ ਦੇ ਵਕੀਲ ਦੀ ਸਲਾਹ ਲਓ।",
        "not_legal": "ਮੈਂ ਸਿਰਫ਼ ਭਾਰਤੀ ਕਾਨੂੰਨ, ਤੁਹਾਡੇ ਅਧਿਕਾਰਾਂ ਅਤੇ ਕਾਨੂੰਨੀ ਪ੍ਰਕਿਰਿਆ ਬਾਰੇ ਸਵਾਲਾਂ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ। ਨਿੱਜੀ ਸਲਾਹ ਲਈ ਪਰਿਵਾਰ ਦੇ ਵੱਡਿਆਂ ਜਾਂ ਸਲਾਹਕਾਰ ਨਾਲ ਗੱਲ ਕਰੋ।",
    },
    "or": {
        "no_corpus": "ମୋ ପାଖରେ ଏଥିପାଇଁ କୌଣସି ଯାଞ୍ଚିତ ଉତ୍ସ ନାହିଁ। ଦୟାକରି ଜଣେ ଓକିଲଙ୍କ ପରାମର୍ଶ ନିଅନ୍ତୁ।",
        "non_indian": "ମୁଁ କେବଳ ଭାରତୀୟ ଆଇନ (BNS, BNSS ଏବଂ ଭାରତର ସମ୍ବିଧାନ) କଭର କରେ। ଅନ୍ୟ ଦେଶର ଆଇନ ପାଇଁ ସେଠାକାର ଓକିଲଙ୍କ ପରାମର୍ଶ ନିଅନ୍ତୁ।",
        "not_legal": "ମୁଁ କେବଳ ଭାରତୀୟ ଆଇନ, ଆପଣଙ୍କ ଅଧିକାର ଏବଂ ଆଇନଗତ ପ୍ରକ୍ରିୟା ସମ୍ବନ୍ଧୀୟ ପ୍ରଶ୍ନରେ ସାହାଯ୍ୟ କରିପାରିବି। ବ୍ୟକ୍ତିଗତ ପରାମର୍ଶ ପାଇଁ ପରିବାରର ବଡ଼ମାନଙ୍କ ସହ କଥା ହୁଅନ୍ତୁ।",
    },
    "as": {
        "no_corpus": "ইয়াৰ বাবে মোৰ ওচৰত কোনো সত্যাপিত উৎস নাই। অনুগ্ৰহ কৰি এজন উকীলৰ পৰামৰ্শ লওক।",
        "non_indian": "মই কেৱল ভাৰতীয় আইন (BNS, BNSS আৰু ভাৰতৰ সংবিধান) সামৰি লওঁ। আন দেশৰ আইনৰ বাবে তাত থকা উকীলৰ পৰামৰ্শ লওক।",
        "not_legal": "মই কেৱল ভাৰতীয় আইন, আপোনাৰ অধিকাৰ আৰু আইনী প্ৰক্ৰিয়া সম্পৰ্কীয় প্ৰশ্নত সহায় কৰিব পাৰোঁ। ব্যক্তিগত পৰামৰ্শৰ বাবে পৰিয়ালৰ জ্যেষ্ঠসকলৰ সৈতে কথা পাতক।",
    },
    "ur": {
        "no_corpus": "میرے پاس اس کا کوئی تصدیق شدہ ذریعہ نہیں ہے۔ براہ کرم کسی وکیل سے مشورہ کریں۔",
        "non_indian": "میں صرف بھارتی قانون (BNS، BNSS اور بھارت کا آئین) کا احاطہ کرتی ہوں۔ دوسرے ممالک کے قوانین کے لیے وہاں کے وکیل سے رجوع کریں۔",
        "not_legal": "میں صرف بھارتی قانون، آپ کے حقوق اور قانونی طریقہ کار سے متعلق سوالات میں مدد کر سکتی ہوں۔ ذاتی مشورے کے لیے خاندان کے بزرگوں یا مشیر سے بات کریں۔",
    },
    "ne": {
        "no_corpus": "मसँग यसका लागि कुनै प्रमाणित स्रोत छैन। कृपया वकिलसँग सल्लाह लिनुहोस्।",
        "non_indian": "म केवल भारतीय कानून (BNS, BNSS र भारतको संविधान) समेट्छु। अन्य देशका कानूनका लागि त्यहाँका वकिलसँग सल्लाह लिनुहोस्।",
        "not_legal": "म केवल भारतीय कानून, तपाईंका अधिकार र कानूनी प्रक्रियासम्बन्धी प्रश्नमा मद्दत गर्न सक्छु। व्यक्तिगत सल्लाहका लागि परिवारका ठूलाबडा वा परामर्शदातासँग कुरा गर्नुहोस्।",
    },
}


def localize_refusal(refusal_en: str, lang_code: str) -> str:
    """Map an English refusal constant to the user's language. Falls back to English."""
    if refusal_en == REFUSAL_NO_CORPUS:
        kind = "no_corpus"
    elif refusal_en == REFUSAL_NON_INDIAN:
        kind = "non_indian"
    elif refusal_en == REFUSAL_NOT_LEGAL:
        kind = "not_legal"
    else:
        return refusal_en
    return REFUSAL_TRANSLATIONS.get((lang_code or "en").lower(), {}).get(kind, refusal_en)


# Case-insensitive patterns for citation-integrity post-processing.
# Any of these appearing in the model's output means the model tried to leak
# statutory identifiers — we strip / soften them so only plain-language remains.
import re as _re
_CITATION_LEAK_PATTERNS = [
    # "Article 21", "Article 22(1)", "Article 21 of the Constitution"
    (_re.compile(r"\b[Aa]rticle\s+\d+[A-Z]?(\(\d+\))?(\s+of\s+the\s+Constitution)?\b"), "this constitutional right"),
    # "Section 35 BNSS", "Section 43(5) of BNSS", "Sec. 43(5) BNSS", "BNSS Section 35"
    (_re.compile(r"\b(?:[Ss]ec(?:tion|\.)?\s+\d+[A-Z]?(?:\(\d+\))?\s+(?:of\s+)?(?:BNS|BNSS|BSA|IPC|CrPC|RTI|RTIR|CPA|CPER|MV|MVA|CMVR))(?![A-Za-z0-9])"), "the law"),
    (_re.compile(r"\b(?:BNS|BNSS|BSA|IPC|CrPC|RTI|RTIR|CPA|CPER|MV|MVA|CMVR)\s+[Ss]ec(?:tion|\.)?\s+\d+[A-Z]?(?:\(\d+\))?(?![A-Za-z0-9])"), "the law"),
    # "Rule 3 RTIR", "Rule 138(7) CMVR", "CMVR Rule 118", "E-Comm Rule 4"
    (_re.compile(r"\b[Rr]ule\s+\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?\s+(?:of\s+)?(?:RTIR|CPER|CMVR|E[- ]?Comm)(?![A-Za-z0-9])"), "the rule"),
    (_re.compile(r"\b(?:RTIR|CPER|CMVR|E[- ]?Comm)\s+[Rr]ule\s+\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?(?![A-Za-z0-9])"), "the rule"),
    # Bare "BNSS 43(5)" or "PWDVA 12" or "RTI 6" or "CPA 2(7)" or "MV 194B" style
    (_re.compile(r"\b(?:BNS|BNSS|BSA|IPC|CrPC|PWDVA|DV Act|RTI|RTIR|CPA|CPER|MV|MVA|CMVR)\s+\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?(?![A-Za-z0-9])"), "the law"),
    # Just "Section 35" alone
    (_re.compile(r"\b[Ss]ec(?:tion|\.)?\s+\d+[A-Z]?(?:\(\d+\))?(?![A-Za-z0-9])"), "the law"),
    # Just "Rule 138(3)" alone
    (_re.compile(r"\b[Rr]ule\s+\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?(?![A-Za-z0-9])"), "the rule"),
    # Long forms of the statutes
    # NOTE (Phase 1 hotfix): these two are deliberately narrower than the
    # other long-form patterns above — they only fire when the Act's full
    # name is directly followed by a section number. A bare, informational
    # mention of the Act's name ("The Indian Penal Code was replaced by the
    # Bharatiya Nyaya Sanhita") must NOT be touched; previously it was,
    # producing "The the law [UNVERIFIED] was replaced by the the law
    # [UNVERIFIED]." — a reproduced, confirmed defect.
    (_re.compile(r"\bBharatiya\s+(?:Nyaya|Nagarik|Sakshya)\s+(?:Sanhita|Suraksha|Adhiniyam)(?:,?\s*\d{4})?,?\s*(?:[Ss]ec(?:tion|\.)?\s*)?\d+[A-Z]?(?:\(\d+\))?\b"), "the law"),
    (_re.compile(r"\bIndian\s+Penal\s+Code(?:,?\s*\d{4})?,?\s*(?:[Ss]ec(?:tion|\.)?\s*)?\d+[A-Z]?(?:\(\d+\))?\b"), "the law"),
    (_re.compile(r"\bCode\s+of\s+Criminal\s+Procedure(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\b(?:Protection\s+of\s+Women\s+from\s+Domestic\s+Violence\s+Act|PWDVA)(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\b(?:Right\s+to\s+Information\s+Act|RTI\s+Act)(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\bRight\s+to\s+Information\s+Rules(?:,?\s*\d{4})?\b"), "the rules"),
    (_re.compile(r"\bConsumer\s+Protection\s+Act(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\bConsumer\s+Protection\s+\(E[- ]?Commerce\)\s+Rules(?:,?\s*\d{4})?\b"), "the rules"),
    (_re.compile(r"\bMotor\s+Vehicles\s+Act(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\bCentral\s+Motor\s+Vehicles\s+Rules(?:,?\s*\d{4})?\b"), "the rules"),
    (_re.compile(r"\bNegotiable\s+Instruments\s+Act(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\bInformation\s+Technology\s+Act(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\b(?:NI|IT)\s+[Ss]ec(?:tion|\.)?\s+\d+[A-Z]?(?:\(\d+\))?(?![A-Za-z0-9])"), "the law"),
    (_re.compile(r"\b[Ss]ec(?:tion|\.)?\s+\d+[A-Z]?(?:\(\d+\))?\s+(?:of\s+)?(?:NI|IT)(?![A-Za-z0-9])"), "the law"),
    (_re.compile(r"\bRent\s+Control\s+Act(?:,?\s*\d{4})?\b"), "the state rent law"),
    (_re.compile(r"\bCode\s+on\s+Wages(?:,?\s*\d{4})?\b"), "the wage law"),
    (_re.compile(r"\bIndustrial\s+Relations\s+Code(?:,?\s*\d{4})?\b"), "the labour law"),
    (_re.compile(r"\bCode\s+on\s+Social\s+Security(?:,?\s*\d{4})?\b"), "the social security law"),
    (_re.compile(r"\bPayment\s+of\s+(?:Wages|Gratuity)\s+Act(?:,?\s*\d{4})?\b"), "the law"),
    (_re.compile(r"\bIndustrial\s+Disputes\s+Act(?:,?\s*\d{4})?\b"), "the labour law"),
    (_re.compile(r"\bTenancy\s+Act(?:,?\s*\d{4})?\b"), "the state tenancy law"),
    (_re.compile(r"\bProhibition\s+(?:and\s+Excise\s+)?Act(?:,?\s*\d{4})?\b"), "the state liquor law"),
]


def sanitize_model_output(text: str) -> str:
    """
    Defense-in-depth. Even with prompt instructions, models sometimes leak
    section/article identifiers. Strip them here BEFORE showing to the user.
    Citations are rendered separately from the verified corpus.

    Also strips markdown syntax (**bold**, __underline__, `code`, #headers) since
    the UI renders plain text — otherwise users see literal `**Answer:**` in the
    bubble instead of a formatted heading. Per P3 style spec: no markdown.
    """
    if not text:
        return text
    out = text
    for pat, repl in _CITATION_LEAK_PATTERNS:
        out = pat.sub(repl, out)
    # Strip markdown formatting the model occasionally emits despite the prompt.
    out = _re.sub(r"\*\*(.+?)\*\*", r"\1", out)        # **bold** → bold
    out = _re.sub(r"(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)", r"\1", out)  # *italic* → italic
    out = _re.sub(r"__([^_\n]+?)__", r"\1", out)       # __underline__ → underline
    out = _re.sub(r"`([^`\n]+?)`", r"\1", out)         # `code` → code
    out = _re.sub(r"^#{1,6}\s+", "", out, flags=_re.MULTILINE)  # # heading → heading
    # collapse double spaces + trailing whitespace on lines
    out = _re.sub(r"[ \t]{2,}", " ", out)
    out = _re.sub(r"[ \t]+\n", "\n", out)
    return out
