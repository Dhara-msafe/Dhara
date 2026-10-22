"""
DHARA CORPUS — IPC (1860) and CrPC (1973) legacy statutes.

WHY THIS FILE EXISTS
--------------------
The Bharatiya Nyaya Sanhita (BNS) 2023 replaced the Indian Penal Code 1860 and
the Bharatiya Nagarik Suraksha Sanhita (BNSS) 2023 replaced the Code of Criminal
Procedure 1973, both with effect from 1 July 2024.

BUT the old codes are STILL live law for:
  * every offence committed BEFORE 1 July 2024, and
  * every FIR, trial and appeal already pending on that date.

Millions of such matters are running in Indian courts right now, so a citizen
asking "what is IPC 498A?" or "what is CrPC 438?" must get a real answer.

Each entry carries a `bns_mapping` note inside `scope_note` telling the user the
equivalent new-code section, so the answer is useful for both old and new cases.

Format is identical to CORPUS in corpus.py (same required keys). This module is
imported and appended to CORPUS at import time.

Sources: India Code portal (indiacode.nic.in), Ministry of Law and Justice.
"""

IPC_URL = "https://www.indiacode.nic.in/handle/123456789/2263"
CRPC_URL = "https://www.indiacode.nic.in/handle/123456789/1611"
V = "2026-06-01"

# ---------------------------------------------------------------------------
# INDIAN PENAL CODE, 1860 — most-asked sections
# ---------------------------------------------------------------------------
IPC_ENTRIES = [
    {
        "key": "ipc_34",
        "citation": "Indian Penal Code 1860, Section 34 — Acts done by several persons in furtherance of common intention",
        "short_label": "IPC 34",
        "act": "IPC",
        "official_text": (
            "When a criminal act is done by several persons in furtherance of the common "
            "intention of all, each of such persons is liable for that act in the same manner "
            "as if it were done by him alone."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "If a group commits a crime together with a shared plan, every member is punished as "
            "if he did the whole act himself. (Old code — for offences before 1 July 2024. The "
            "equivalent new provision is BNS Section 3(5).)"
        ),
        "keywords": [
            "ipc 34", "section 34 ipc", "common intention", "acts done several persons",
            "group crime liability", "joint liability crime", "gang liability",
        ],
    },
    {
        "key": "ipc_120b",
        "citation": "Indian Penal Code 1860, Section 120B — Punishment of criminal conspiracy",
        "short_label": "IPC 120B",
        "act": "IPC",
        "official_text": (
            "(1) Whoever is a party to a criminal conspiracy to commit an offence punishable with "
            "death, imprisonment for life or rigorous imprisonment for a term of two years or "
            "upwards, shall, where no express provision is made in this Code for the punishment of "
            "such a conspiracy, be punished in the same manner as if he had abetted such offence.\n"
            "(2) Whoever is a party to a criminal conspiracy other than a criminal conspiracy to "
            "commit an offence punishable as aforesaid shall be punished with imprisonment of "
            "either description for a term not exceeding six months, or with fine or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Agreeing with someone to commit a serious crime is itself punishable, even if the "
            "crime never happened. (Old code — offences before 1 July 2024; new equivalent is "
            "BNS Section 61(2).)"
        ),
        "keywords": [
            "ipc 120b", "section 120b", "criminal conspiracy", "conspiracy punishment",
            "conspiracy charge", "party to conspiracy",
        ],
    },
    {
        "key": "ipc_153a",
        "citation": "Indian Penal Code 1860, Section 153A — Promoting enmity between different groups",
        "short_label": "IPC 153A",
        "act": "IPC",
        "official_text": (
            "(1) Whoever—\n"
            "(a) by words, either spoken or written, or by signs or by visible representations or "
            "otherwise, promotes or attempts to promote, on grounds of religion, race, place of "
            "birth, residence, language, caste or community or any other ground whatsoever, "
            "disharmony or feelings of enmity, hatred or ill-will between different religious, "
            "racial, language or regional groups or castes or communities, or\n"
            "(b) commits any act which is prejudicial to the maintenance of harmony between "
            "different religious, racial, language or regional groups or castes or communities, "
            "and which disturbs or is likely to disturb the public tranquillity, ... shall be "
            "punished with imprisonment which may extend to three years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Spreading hate between religions, castes, languages or regions is a crime punishable "
            "with up to 3 years. (Old code; new equivalent is BNS Section 196.)"
        ),
        "keywords": [
            "ipc 153a", "section 153a", "promoting enmity", "hate speech india",
            "communal hatred", "religious hatred crime", "caste hatred speech",
            "disharmony between groups",
        ],
    },
    {
        "key": "ipc_279",
        "citation": "Indian Penal Code 1860, Section 279 — Rash driving or riding on a public way",
        "short_label": "IPC 279",
        "act": "IPC",
        "official_text": (
            "Whoever drives any vehicle, or rides, on any public way in a manner so rash or "
            "negligent as to endanger human life, or to be likely to cause hurt or injury to any "
            "other person, shall be punished with imprisonment of either description for a term "
            "which may extend to six months, or with fine which may extend to one thousand "
            "rupees, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Driving or riding dangerously on a public road is itself a crime — up to 6 months "
            "jail — even if nobody was hurt. (Old code; new equivalent is BNS Section 281.)"
        ),
        "keywords": [
            "ipc 279", "section 279", "rash driving", "negligent driving", "reckless driving crime",
            "dangerous driving punishment", "rash riding public way",
        ],
    },
    {
        "key": "ipc_294",
        "citation": "Indian Penal Code 1860, Section 294 — Obscene acts and songs",
        "short_label": "IPC 294",
        "act": "IPC",
        "official_text": (
            "Whoever, to the annoyance of others,—\n"
            "(a) does any obscene act in any public place, or\n"
            "(b) sings, recites or utters any obscene song, ballad or words, in or near any public "
            "place,\n"
            "shall be punished with imprisonment of either description for a term which may extend "
            "to three months, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Obscene behaviour, songs or abuse in a public place that annoys others is punishable "
            "with up to 3 months. (Old code; new equivalent is BNS Section 296.)"
        ),
        "keywords": [
            "ipc 294", "section 294", "obscene act public", "obscene song", "public abuse case",
            "vulgar words public place", "gali case",
        ],
    },
    {
        "key": "ipc_302",
        "citation": "Indian Penal Code 1860, Section 302 — Punishment for murder",
        "short_label": "IPC 302",
        "act": "IPC",
        "official_text": (
            "Whoever commits murder shall be punished with death, or imprisonment for life, and "
            "shall also be liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Murder carries the death penalty or life imprisonment, plus fine. (Old code; new "
            "equivalent is BNS Section 103.)"
        ),
        "keywords": [
            "ipc 302", "section 302", "punishment for murder", "murder sentence",
            "murder case punishment", "302 case",
        ],
    },
    {
        "key": "ipc_304a",
        "citation": "Indian Penal Code 1860, Section 304A — Causing death by negligence",
        "short_label": "IPC 304A",
        "act": "IPC",
        "official_text": (
            "Whoever causes the death of any person by doing any rash or negligent act not "
            "amounting to culpable homicide shall be punished with imprisonment of either "
            "description for a term which may extend to two years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "This is the section normally used in fatal road accidents — death caused by "
            "carelessness, not intention. Up to 2 years. (Old code; new equivalent is BNS "
            "Section 106.)"
        ),
        "keywords": [
            "ipc 304a", "section 304a", "death by negligence", "accident death case",
            "road accident death punishment", "fatal accident section", "negligent death",
        ],
    },
    {
        "key": "ipc_307",
        "citation": "Indian Penal Code 1860, Section 307 — Attempt to murder",
        "short_label": "IPC 307",
        "act": "IPC",
        "official_text": (
            "Whoever does any act with such intention or knowledge, and under such circumstances "
            "that, if he by that act caused death, he would be guilty of murder, shall be punished "
            "with imprisonment of either description for a term which may extend to ten years, and "
            "shall also be liable to fine; and if hurt is caused to any person by such act, the "
            "offender shall be liable either to imprisonment for life, or to such punishment as is "
            "hereinbefore mentioned."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Trying to kill someone is punishable with up to 10 years, and up to life imprisonment "
            "if the victim was actually hurt. (Old code; new equivalent is BNS Section 109.)"
        ),
        "keywords": [
            "ipc 307", "section 307", "attempt to murder", "attempt murder punishment",
            "307 case", "tried to kill",
        ],
    },
    {
        "key": "ipc_323",
        "citation": "Indian Penal Code 1860, Section 323 — Punishment for voluntarily causing hurt",
        "short_label": "IPC 323",
        "act": "IPC",
        "official_text": (
            "Whoever, except in the case provided for by section 334, voluntarily causes hurt, "
            "shall be punished with imprisonment of either description for a term which may extend "
            "to one year, or with fine which may extend to one thousand rupees, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Deliberately hurting someone (a slap, a beating, minor injury) is punishable with up "
            "to 1 year. (Old code; new equivalent is BNS Section 115(2).)"
        ),
        "keywords": [
            "ipc 323", "section 323", "voluntarily causing hurt", "simple hurt punishment",
            "marpit case", "beaten up case", "assault hurt punishment",
        ],
    },
    {
        "key": "ipc_325",
        "citation": "Indian Penal Code 1860, Section 325 — Punishment for voluntarily causing grievous hurt",
        "short_label": "IPC 325",
        "act": "IPC",
        "official_text": (
            "Whoever, except in the case provided for by section 335, voluntarily causes grievous "
            "hurt, shall be punished with imprisonment of either description for a term which may "
            "extend to seven years, and shall also be liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Causing serious injury — a fracture, loss of sight or hearing, permanent damage, or "
            "injury keeping the victim in severe pain for 20 days — carries up to 7 years. (Old "
            "code; new equivalent is BNS Section 117(2).)"
        ),
        "keywords": [
            "ipc 325", "section 325", "grievous hurt", "serious injury punishment",
            "fracture case punishment", "grievous hurt seven years",
        ],
    },
    {
        "key": "ipc_354",
        "citation": "Indian Penal Code 1860, Section 354 — Assault or criminal force to woman with intent to outrage her modesty",
        "short_label": "IPC 354",
        "act": "IPC",
        "official_text": (
            "Whoever assaults or uses criminal force to any woman, intending to outrage or knowing "
            "it to be likely that he will thereby outrage her modesty, shall be punished with "
            "imprisonment of either description for a term which shall not be less than one year "
            "but which may extend to five years, and shall also be liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Touching, grabbing or using force on a woman to outrage her modesty carries a MINIMUM "
            "of 1 year and up to 5 years. (Old code; new equivalent is BNS Section 74.)"
        ),
        "keywords": [
            "ipc 354", "section 354", "outrage modesty", "molestation", "molested woman case",
            "inappropriate touching case", "assault on woman modesty", "bad touch complaint",
        ],
    },
    {
        "key": "ipc_354a",
        "citation": "Indian Penal Code 1860, Section 354A — Sexual harassment",
        "short_label": "IPC 354A",
        "act": "IPC",
        "official_text": (
            "(1) A man committing any of the following acts—\n"
            "(i) physical contact and advances involving unwelcome and explicit sexual overtures; or\n"
            "(ii) a demand or request for sexual favours; or\n"
            "(iii) showing pornography against the will of a woman; or\n"
            "(iv) making sexually coloured remarks,\n"
            "shall be guilty of the offence of sexual harassment.\n"
            "(2) Any man who commits the offence specified in clause (i) or clause (ii) or clause "
            "(iii) of sub-section (1) shall be punished with rigorous imprisonment for a term which "
            "may extend to three years, or with fine, or with both.\n"
            "(3) Any man who commits the offence specified in clause (iv) of sub-section (1) shall "
            "be punished with imprisonment of either description for a term which may extend to "
            "one year, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Unwanted sexual advances, demanding sexual favours, showing pornography or making "
            "sexual remarks are all punishable sexual harassment. (Old code; new equivalent is BNS "
            "Section 75.)"
        ),
        "keywords": [
            "ipc 354a", "section 354a", "sexual harassment", "sexual favours demand",
            "sexually coloured remarks", "workplace harassment law", "eve teasing",
            "unwelcome advances",
        ],
    },
    {
        "key": "ipc_354d",
        "citation": "Indian Penal Code 1860, Section 354D — Stalking",
        "short_label": "IPC 354D",
        "act": "IPC",
        "official_text": (
            "(1) Any man who—\n"
            "(i) follows a woman and contacts, or attempts to contact such woman to foster personal "
            "interaction repeatedly despite a clear indication of disinterest by such woman; or\n"
            "(ii) monitors the use by a woman of the internet, email or any other form of "
            "electronic communication,\n"
            "commits the offence of stalking.\n"
            "(2) Whoever commits the offence of stalking shall be punished on first conviction with "
            "imprisonment of either description for a term which may extend to three years, and "
            "shall also be liable to fine; and be punished on a second or subsequent conviction "
            "with imprisonment of either description for a term which may extend to five years, and "
            "shall also be liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Repeatedly following or messaging a woman after she has shown disinterest, or spying "
            "on her online, is stalking — up to 3 years the first time. (Old code; new equivalent "
            "is BNS Section 78.)"
        ),
        "keywords": [
            "ipc 354d", "section 354d", "stalking", "stalker case", "following woman",
            "online stalking", "cyber stalking woman", "repeatedly messaging woman",
        ],
    },
    {
        "key": "ipc_376",
        "citation": "Indian Penal Code 1860, Section 376(1) — Punishment for rape",
        "short_label": "IPC 376",
        "act": "IPC",
        "official_text": (
            "(1) Whoever, except in the cases provided for in sub-section (2), commits rape, shall "
            "be punished with rigorous imprisonment of either description for a term which shall "
            "not be less than ten years, but which may extend to imprisonment for life, and shall "
            "also be liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Rape carries a MINIMUM of 10 years rigorous imprisonment and can extend to life, plus "
            "fine. Aggravated cases under sub-section (2) carry higher punishment. (Old code; new "
            "equivalent is BNS Section 64.)"
        ),
        "keywords": [
            "ipc 376", "section 376", "punishment for rape", "rape sentence", "rape case punishment",
            "376 case",
        ],
    },
    {
        "key": "ipc_379",
        "citation": "Indian Penal Code 1860, Section 379 — Punishment for theft",
        "short_label": "IPC 379",
        "act": "IPC",
        "official_text": (
            "Whoever commits theft shall be punished with imprisonment of either description for a "
            "term which may extend to three years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Theft — taking someone's movable property without consent — carries up to 3 years. "
            "(Old code; new equivalent is BNS Section 303(2).)"
        ),
        "keywords": [
            "ipc 379", "section 379", "punishment for theft", "theft case", "stolen phone case",
            "chori case", "mobile stolen fir",
        ],
    },
    {
        "key": "ipc_384",
        "citation": "Indian Penal Code 1860, Section 384 — Punishment for extortion",
        "short_label": "IPC 384",
        "act": "IPC",
        "official_text": (
            "Whoever commits extortion shall be punished with imprisonment of either description "
            "for a term which may extend to three years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Forcing someone to hand over money or property by threatening injury is extortion — "
            "up to 3 years. (Old code; new equivalent is BNS Section 308(2).)"
        ),
        "keywords": [
            "ipc 384", "section 384", "extortion", "extortion punishment", "threat for money",
            "blackmail money", "vasooli case", "demanding money threat",
        ],
    },
    {
        "key": "ipc_392",
        "citation": "Indian Penal Code 1860, Section 392 — Punishment for robbery",
        "short_label": "IPC 392",
        "act": "IPC",
        "official_text": (
            "Whoever commits robbery shall be punished with rigorous imprisonment for a term which "
            "may extend to ten years, and shall also be liable to fine; and, if the robbery be "
            "committed on the highway between sunset and sunrise, the imprisonment may be extended "
            "to fourteen years."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Robbery — theft or extortion with violence or fear — carries up to 10 years, and up to "
            "14 years if done on a highway at night. (Old code; new equivalent is BNS Section 309(4).)"
        ),
        "keywords": [
            "ipc 392", "section 392", "robbery punishment", "loot case", "chain snatching case",
            "highway robbery night", "daketi",
        ],
    },
    {
        "key": "ipc_406",
        "citation": "Indian Penal Code 1860, Section 406 — Punishment for criminal breach of trust",
        "short_label": "IPC 406",
        "act": "IPC",
        "official_text": (
            "Whoever commits criminal breach of trust shall be punished with imprisonment of either "
            "description for a term which may extend to three years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "If someone you trusted with money or property dishonestly keeps or uses it, that is "
            "criminal breach of trust — up to 3 years. Commonly used for stridhan / dowry articles "
            "not returned. (Old code; new equivalent is BNS Section 316(2).)"
        ),
        "keywords": [
            "ipc 406", "section 406", "criminal breach of trust", "stridhan not returned",
            "misappropriation entrusted property", "money not returned case",
        ],
    },
    {
        "key": "ipc_420",
        "citation": "Indian Penal Code 1860, Section 420 — Cheating and dishonestly inducing delivery of property",
        "short_label": "IPC 420",
        "act": "IPC",
        "official_text": (
            "Whoever cheats and thereby dishonestly induces the person deceived to deliver any "
            "property to any person, or to make, alter or destroy the whole or any part of a "
            "valuable security, or anything which is signed or sealed, and which is capable of "
            "being converted into a valuable security, shall be punished with imprisonment of "
            "either description for a term which may extend to seven years, and shall also be "
            "liable to fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "This is the classic fraud/cheating section — tricking someone into parting with money "
            "or property. Up to 7 years. (Old code; new equivalent is BNS Section 318(4).)"
        ),
        "keywords": [
            "ipc 420", "section 420", "cheating", "fraud case", "420 case", "dhokha case",
            "online fraud section", "cheated money", "fake promise money",
        ],
    },
    {
        "key": "ipc_427",
        "citation": "Indian Penal Code 1860, Section 427 — Mischief causing damage to the amount of fifty rupees",
        "short_label": "IPC 427",
        "act": "IPC",
        "official_text": (
            "Whoever commits mischief and thereby causes loss or damage to the amount of fifty "
            "rupees or upwards, shall be punished with imprisonment of either description for a "
            "term which may extend to two years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Deliberately damaging someone's property worth ₹50 or more is punishable with up to "
            "2 years. (Old code; new equivalent is BNS Section 324(4).)"
        ),
        "keywords": [
            "ipc 427", "section 427", "mischief damage property", "property damage case",
            "vandalism india", "broke my property case",
        ],
    },
    {
        "key": "ipc_447",
        "citation": "Indian Penal Code 1860, Section 447 — Punishment for criminal trespass",
        "short_label": "IPC 447",
        "act": "IPC",
        "official_text": (
            "Whoever commits criminal trespass shall be punished with imprisonment of either "
            "description for a term which may extend to three months, or with fine which may extend "
            "to five hundred rupees, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Entering someone's property to intimidate, annoy or commit an offence is criminal "
            "trespass — up to 3 months. (Old code; new equivalent is BNS Section 330(1).)"
        ),
        "keywords": [
            "ipc 447", "section 447", "criminal trespass", "trespass punishment",
            "entered my land case", "illegal entry property", "encroachment complaint",
        ],
    },
    {
        "key": "ipc_465",
        "citation": "Indian Penal Code 1860, Section 465 — Punishment for forgery",
        "short_label": "IPC 465",
        "act": "IPC",
        "official_text": (
            "Whoever commits forgery shall be punished with imprisonment of either description for "
            "a term which may extend to two years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Making a false document or false electronic record with intent to cause damage is "
            "forgery — up to 2 years. (Old code; new equivalent is BNS Section 336(2).)"
        ),
        "keywords": [
            "ipc 465", "section 465", "forgery punishment", "fake document case",
            "forged signature case", "false document offence",
        ],
    },
    {
        "key": "ipc_498a",
        "citation": "Indian Penal Code 1860, Section 498A — Husband or relative of husband subjecting a woman to cruelty",
        "short_label": "IPC 498A",
        "act": "IPC",
        "official_text": (
            "Whoever, being the husband or the relative of the husband of a woman, subjects such "
            "woman to cruelty shall be punished with imprisonment for a term which may extend to "
            "three years and shall also be liable to fine.\n"
            "Explanation.—For the purposes of this section, \u201ccruelty\u201d means—\n"
            "(a) any wilful conduct which is of such a nature as is likely to drive the woman to "
            "commit suicide or to cause grave injury or danger to life, limb or health (whether "
            "mental or physical) of the woman; or\n"
            "(b) harassment of the woman where such harassment is with a view to coercing her or "
            "any person related to her to meet any unlawful demand for any property or valuable "
            "security or is on account of failure by her or any person related to her to meet such "
            "demand."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "A husband or his relatives who treat a married woman cruelly — including dowry "
            "harassment — can be jailed up to 3 years. (Old code; new equivalent is BNS Section 85.)"
        ),
        "keywords": [
            "ipc 498a", "section 498a", "498a", "cruelty by husband", "dowry harassment",
            "in laws harassment case", "domestic cruelty section", "sasural harassment",
            "husband cruelty punishment",
        ],
    },
    {
        "key": "ipc_500",
        "citation": "Indian Penal Code 1860, Section 500 — Punishment for defamation",
        "short_label": "IPC 500",
        "act": "IPC",
        "official_text": (
            "Whoever defames another shall be punished with simple imprisonment for a term which "
            "may extend to two years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Damaging someone's reputation by spoken or written words is criminal defamation — up "
            "to 2 years simple imprisonment. (Old code; new equivalent is BNS Section 356(2).)"
        ),
        "keywords": [
            "ipc 500", "section 500", "defamation punishment", "defamation case",
            "badnami case", "false allegations reputation", "libel slander india",
        ],
    },
    {
        "key": "ipc_506",
        "citation": "Indian Penal Code 1860, Section 506 — Punishment for criminal intimidation",
        "short_label": "IPC 506",
        "act": "IPC",
        "official_text": (
            "Whoever commits the offence of criminal intimidation shall be punished with "
            "imprisonment of either description for a term which may extend to two years, or with "
            "fine, or with both;\n"
            "and if the threat be to cause death or grievous hurt, or to cause the destruction of "
            "any property by fire, or to cause an offence punishable with death or imprisonment for "
            "life, or with imprisonment for a term which may extend to seven years, or to impute "
            "unchastity to a woman, shall be punished with imprisonment of either description for a "
            "term which may extend to seven years, or with fine, or with both."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Threatening someone with injury is punishable with up to 2 years — and up to 7 years "
            "if the threat is of death, grievous hurt or arson. (Old code; new equivalent is BNS "
            "Section 351.)"
        ),
        "keywords": [
            "ipc 506", "section 506", "criminal intimidation", "threat case", "death threat case",
            "dhamki case", "someone threatened me", "threatening punishment",
        ],
    },
    {
        "key": "ipc_509",
        "citation": "Indian Penal Code 1860, Section 509 — Word, gesture or act intended to insult the modesty of a woman",
        "short_label": "IPC 509",
        "act": "IPC",
        "official_text": (
            "Whoever, intending to insult the modesty of any woman, utters any word, makes any "
            "sound or gesture, or exhibits any object, intending that such word or sound shall be "
            "heard, or that such gesture or object shall be seen, by such woman, or intrudes upon "
            "the privacy of such woman, shall be punished with simple imprisonment for a term which "
            "may extend to three years, and also with fine."
        ),
        "source_url": IPC_URL,
        "verified_at": V,
        "scope_note": (
            "Passing lewd remarks, obscene gestures or intruding on a woman's privacy is punishable "
            "with up to 3 years. (Old code; new equivalent is BNS Section 79.)"
        ),
        "keywords": [
            "ipc 509", "section 509", "insult modesty of woman", "lewd comment case",
            "obscene gesture woman", "privacy intrusion woman", "catcalling india",
        ],
    },
]

# ---------------------------------------------------------------------------
# CODE OF CRIMINAL PROCEDURE, 1973 — most-asked sections
# ---------------------------------------------------------------------------
CRPC_ENTRIES = [
    {
        "key": "crpc_41",
        "citation": "Code of Criminal Procedure 1973, Section 41 — When police may arrest without warrant",
        "short_label": "CrPC 41",
        "act": "CrPC",
        "official_text": (
            "(1) Any police officer may without an order from a Magistrate and without a warrant, "
            "arrest any person—\n"
            "(a) who commits, in the presence of a police officer, a cognizable offence;\n"
            "(b) against whom a reasonable complaint has been made, or credible information has "
            "been received, or a reasonable suspicion exists that he has committed a cognizable "
            "offence punishable with imprisonment for a term which may be less than seven years or "
            "which may extend to seven years whether with or without fine, if the following "
            "conditions are satisfied, namely:—\n"
            "  (i) the police officer has reason to believe on the basis of such complaint, "
            "information, or suspicion that such person has committed the said offence;\n"
            "  (ii) the police officer is satisfied that such arrest is necessary to prevent such "
            "person from committing any further offence, or for proper investigation of the "
            "offence, or to prevent such person from causing the evidence of the offence to "
            "disappear or tampering with such evidence, or to prevent such person from making any "
            "inducement, threat or promise to any witness, or as unless such person is arrested his "
            "presence in the Court whenever required cannot be ensured,\n"
            "and the police officer shall record while making such arrest, his reasons in writing."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "Police can arrest without a warrant only in defined situations, and for offences "
            "punishable up to 7 years they MUST record written reasons why the arrest was "
            "necessary. (Old code — for matters before 1 July 2024; new equivalent is BNSS "
            "Section 35.)"
        ),
        "keywords": [
            "crpc 41", "section 41 crpc", "arrest without warrant", "police arrest powers",
            "when police can arrest", "cognizable offence arrest",
        ],
    },
    {
        "key": "crpc_41a",
        "citation": "Code of Criminal Procedure 1973, Section 41A — Notice of appearance before police officer",
        "short_label": "CrPC 41A",
        "act": "CrPC",
        "official_text": (
            "(1) The police officer shall, in all cases where the arrest of a person is not "
            "required under the provisions of sub-section (1) of section 41, issue a notice "
            "directing the person against whom a reasonable complaint has been made, or credible "
            "information has been received, or a reasonable suspicion exists that he has committed "
            "a cognizable offence, to appear before him or at such other place as may be specified "
            "in the notice.\n"
            "(2) Where such a notice is issued to any person, it shall be the duty of that person "
            "to comply with the terms of the notice.\n"
            "(3) Where such person complies and continues to comply with the notice, he shall not "
            "be arrested in respect of the offence referred to in the notice unless, for reasons to "
            "be recorded, the police officer is of the opinion that he ought to be arrested."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "If arrest is not necessary, police must send you a written notice to appear instead. "
            "If you keep attending as directed, you cannot be arrested for that offence. (Old code; "
            "new equivalent is BNSS Section 35(3)-(6).)"
        ),
        "keywords": [
            "crpc 41a", "section 41a", "notice of appearance", "41a notice police",
            "police notice instead of arrest", "summons notice police",
        ],
    },
    {
        "key": "crpc_46",
        "citation": "Code of Criminal Procedure 1973, Section 46 — Arrest how made",
        "short_label": "CrPC 46",
        "act": "CrPC",
        "official_text": (
            "(1) In making an arrest the police officer or other person making the same shall "
            "actually touch or confine the body of the person to be arrested, unless there be a "
            "submission to the custody by word or action:\n"
            "Provided that where a woman is to be arrested, unless the circumstances indicate to "
            "the contrary, her submission to custody on an oral intimation of arrest shall be "
            "presumed and, unless the circumstances otherwise require or unless the police officer "
            "is a female, the police officer shall not touch the person of the woman for making her "
            "arrest.\n"
            "(4) Save in exceptional circumstances, no woman shall be arrested after sunset and "
            "before sunrise, and where such exceptional circumstances exist, the woman police "
            "officer shall, by making a written report, obtain the prior permission of the Judicial "
            "Magistrate of the first class within whose local jurisdiction the offence is committed "
            "or the arrest is to be made."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "A woman must normally not be arrested between sunset and sunrise, and only a woman "
            "police officer may touch her while arresting. (Old code; new equivalent is BNSS "
            "Section 43.)"
        ),
        "keywords": [
            "crpc 46", "section 46 crpc", "arrest how made", "woman arrest at night",
            "cannot arrest woman after sunset", "female arrest rules", "woman police officer arrest",
        ],
    },
    {
        "key": "crpc_50",
        "citation": "Code of Criminal Procedure 1973, Section 50 — Person arrested to be informed of grounds of arrest and of right to bail",
        "short_label": "CrPC 50",
        "act": "CrPC",
        "official_text": (
            "(1) Every police officer or other person arresting any person without warrant shall "
            "forthwith communicate to him full particulars of the offence for which he is arrested "
            "or other grounds for such arrest.\n"
            "(2) Where a police officer arrests without warrant any person other than a person "
            "accused of a non-bailable offence, he shall inform the person arrested that he is "
            "entitled to be released on bail and that he may arrange for sureties on his behalf."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "The police MUST immediately tell you exactly why you are being arrested, and — for a "
            "bailable offence — that you have a right to bail. (Old code; new equivalent is BNSS "
            "Section 47.)"
        ),
        "keywords": [
            "crpc 50", "section 50 crpc", "informed grounds of arrest", "right to bail informed",
            "why am i being arrested", "police must tell reason arrest",
        ],
    },
    {
        "key": "crpc_54",
        "citation": "Code of Criminal Procedure 1973, Section 54 — Examination of arrested person by medical officer",
        "short_label": "CrPC 54",
        "act": "CrPC",
        "official_text": (
            "(1) When any person is arrested, he shall be examined by a medical officer in the "
            "service of Central or State Government, and in case the medical officer is not "
            "available, by a registered medical practitioner soon after the arrest is made:\n"
            "Provided that where the arrested person is a female, the examination of the body shall "
            "be made only by or under the supervision of a female medical officer, and in case the "
            "female medical officer is not available, by a female registered medical practitioner.\n"
            "(2) The medical officer or a registered medical practitioner so examining the arrested "
            "person shall prepare the record of such examination, mentioning therein any injuries "
            "or marks of violence upon the person arrested, and the approximate time when such "
            "injuries or marks may have been inflicted.\n"
            "(3) Where an examination is made under sub-section (1), a copy of the report of such "
            "examination shall be furnished by the medical officer or registered medical "
            "practitioner, as the case may be, to the arrested person or the person nominated by "
            "such arrested person."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "Every arrested person must be medically examined right after arrest, injuries must be "
            "recorded, and you are entitled to a copy of that report — this is your main protection "
            "against custodial violence. (Old code; new equivalent is BNSS Section 53.)"
        ),
        "keywords": [
            "crpc 54", "section 54 crpc", "medical examination arrested person",
            "custodial violence proof", "police beating medical report", "injury record arrest",
        ],
    },
    {
        "key": "crpc_57",
        "citation": "Code of Criminal Procedure 1973, Section 57 — Person arrested not to be detained more than twenty-four hours",
        "short_label": "CrPC 57",
        "act": "CrPC",
        "official_text": (
            "No police officer shall detain in custody a person arrested without warrant for a "
            "longer period than under all the circumstances of the case is reasonable, and such "
            "period shall not, in the absence of a special order of a Magistrate under section 167, "
            "exceed twenty-four hours exclusive of the time necessary for the journey from the place "
            "of arrest to the Magistrate's Court."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "Police cannot keep you in custody for more than 24 hours without producing you before "
            "a Magistrate. (Old code; new equivalent is BNSS Section 58.)"
        ),
        "keywords": [
            "crpc 57", "section 57 crpc", "24 hours police custody", "detained more than 24 hours",
            "twenty four hours magistrate", "illegal detention police",
        ],
    },
    {
        "key": "crpc_125",
        "citation": "Code of Criminal Procedure 1973, Section 125 — Order for maintenance of wives, children and parents",
        "short_label": "CrPC 125",
        "act": "CrPC",
        "official_text": (
            "(1) If any person having sufficient means neglects or refuses to maintain—\n"
            "(a) his wife, unable to maintain herself, or\n"
            "(b) his legitimate or illegitimate minor child, whether married or not, unable to "
            "maintain itself, or\n"
            "(c) his legitimate or illegitimate child (not being a married daughter) who has "
            "attained majority, where such child is, by reason of any physical or mental "
            "abnormality or injury unable to maintain itself, or\n"
            "(d) his father or mother, unable to maintain himself or herself,\n"
            "a Magistrate of the first class may, upon proof of such neglect or refusal, order such "
            "person to make a monthly allowance for the maintenance of his wife or such child, "
            "father or mother, at such monthly rate as such Magistrate thinks fit."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "A wife, child or parent who cannot support themselves can ask a Magistrate for monthly "
            "maintenance from a person who has means but refuses to pay. (Old code; new equivalent "
            "is BNSS Section 144.)"
        ),
        "keywords": [
            "crpc 125", "section 125 crpc", "maintenance wife", "maintenance children parents",
            "monthly allowance wife", "husband not giving money", "kharcha case",
            "maintenance case", "guzara bhatta",
        ],
    },
    {
        "key": "crpc_154",
        "citation": "Code of Criminal Procedure 1973, Section 154 — Information in cognizable cases (FIR)",
        "short_label": "CrPC 154",
        "act": "CrPC",
        "official_text": (
            "(1) Every information relating to the commission of a cognizable offence, if given "
            "orally to an officer in charge of a police station, shall be reduced to writing by him "
            "or under his direction, and be read over to the informant; and every such information, "
            "whether given in writing or reduced to writing as aforesaid, shall be signed by the "
            "person giving it, and the substance thereof shall be entered in a book to be kept by "
            "such officer in such form as the State Government may prescribe in this behalf.\n"
            "(2) A copy of the information as recorded under sub-section (1) shall be given "
            "forthwith, free of cost, to the informant.\n"
            "(3) Any person aggrieved by a refusal on the part of an officer in charge of a police "
            "station to record the information referred to in sub-section (1) may send the substance "
            "of such information, in writing and by post, to the Superintendent of Police concerned "
            "who, if satisfied that such information discloses the commission of a cognizable "
            "offence, shall either investigate the case himself or direct an investigation to be "
            "made by any police officer subordinate to him."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "The police MUST register an FIR for a cognizable offence and give you a free copy. If "
            "they refuse, you can post your complaint to the Superintendent of Police. (Old code; "
            "new equivalent is BNSS Section 173.)"
        ),
        "keywords": [
            "crpc 154", "section 154 crpc", "fir registration", "police refusing fir",
            "how to file fir", "free copy of fir", "zero fir", "sp complaint fir refusal",
            "first information report",
        ],
    },
    {
        "key": "crpc_156_3",
        "citation": "Code of Criminal Procedure 1973, Section 156(3) — Magistrate's power to order investigation",
        "short_label": "CrPC 156(3)",
        "act": "CrPC",
        "official_text": (
            "(1) Any officer in charge of a police station may, without the order of a Magistrate, "
            "investigate any cognizable case which a Court having jurisdiction over the local area "
            "within the limits of such station would have power to inquire into or try under the "
            "provisions of Chapter XIII.\n"
            "(3) Any Magistrate empowered under section 190 may order such an investigation as "
            "above-mentioned."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "If the police will not register or investigate your case, you can apply to the "
            "Magistrate who can order the police to investigate. (Old code; new equivalent is BNSS "
            "Section 175(3).)"
        ),
        "keywords": [
            "crpc 156 3", "section 156 3", "magistrate order investigation",
            "police not investigating", "complaint to magistrate police inaction",
            "156 3 application",
        ],
    },
    {
        "key": "crpc_161",
        "citation": "Code of Criminal Procedure 1973, Section 161 — Examination of witnesses by police",
        "short_label": "CrPC 161",
        "act": "CrPC",
        "official_text": (
            "(1) Any police officer making an investigation under this Chapter may examine orally "
            "any person supposed to be acquainted with the facts and circumstances of the case.\n"
            "(2) Such person shall be bound to answer truly all questions relating to such case put "
            "to him by such officer, other than questions the answers to which would have a "
            "tendency to expose him to a criminal charge or to a penalty or forfeiture.\n"
            "(3) A police officer may reduce into writing any statement made to him in the course "
            "of an examination under this section... Provided further that the statement of a woman "
            "against whom an offence under section 354, 354A, 354B, 354C, 354D, 376, 376A to 376E "
            "or 509 of the Indian Penal Code is alleged to have been committed or attempted shall "
            "be recorded, by a woman police officer or any woman officer."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "Police can question anyone who knows about a case, but you need not answer anything "
            "that would incriminate you. A woman victim of a sexual offence must be recorded by a "
            "woman officer. (Old code; new equivalent is BNSS Section 180.)"
        ),
        "keywords": [
            "crpc 161", "section 161 crpc", "police statement", "examination of witnesses police",
            "161 statement", "police questioning rights", "woman officer record statement",
        ],
    },
    {
        "key": "crpc_167",
        "citation": "Code of Criminal Procedure 1973, Section 167 — Procedure when investigation cannot be completed in twenty-four hours (default bail)",
        "short_label": "CrPC 167",
        "act": "CrPC",
        "official_text": (
            "(2) The Magistrate to whom an accused person is forwarded under this section may, "
            "whether he has or has not jurisdiction to try the case, from time to time, authorise "
            "the detention of the accused in such custody as such Magistrate thinks fit, for a term "
            "not exceeding fifteen days in the whole; ...\n"
            "Provided that—\n"
            "(a) the Magistrate may authorise the detention of the accused person, otherwise than "
            "in the custody of the police, beyond the period of fifteen days, if he is satisfied "
            "that adequate grounds exist for doing so, but no Magistrate shall authorise the "
            "detention of the accused person in custody under this paragraph for a total period "
            "exceeding—\n"
            "  (i) ninety days, where the investigation relates to an offence punishable with death, "
            "imprisonment for life or imprisonment for a term of not less than ten years;\n"
            "  (ii) sixty days, where the investigation relates to any other offence,\n"
            "and, on the expiry of the said period of ninety days, or sixty days, as the case may "
            "be, the accused person shall be released on bail if he is prepared to and does furnish "
            "bail."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "If the police fail to file the charge sheet within 60 days (or 90 days for the most "
            "serious offences), you have an absolute right to 'default bail'. (Old code; new "
            "equivalent is BNSS Section 187.)"
        ),
        "keywords": [
            "crpc 167", "section 167 crpc", "default bail", "60 days charge sheet",
            "90 days charge sheet", "judicial custody remand", "statutory bail",
            "police custody 15 days",
        ],
    },
    {
        "key": "crpc_173",
        "citation": "Code of Criminal Procedure 1973, Section 173 — Report of police officer on completion of investigation (charge sheet)",
        "short_label": "CrPC 173",
        "act": "CrPC",
        "official_text": (
            "(1) Every investigation under this Chapter shall be completed without unnecessary "
            "delay.\n"
            "(1A) The investigation in relation to an offence under sections 376, 376A, 376AB, "
            "376B, 376C, 376D, 376DA, 376DB or 376E of the Indian Penal Code shall be completed "
            "within two months from the date on which the information was recorded by the officer "
            "in charge of the police station.\n"
            "(2)(i) As soon as it is completed, the officer in charge of the police station shall "
            "forward to a Magistrate empowered to take cognizance of the offence on a police report, "
            "a report in the form prescribed by the State Government..."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "Police must finish the investigation without unnecessary delay and file a report "
            "(charge sheet) before the Magistrate; rape investigations must finish within 2 months. "
            "(Old code; new equivalent is BNSS Section 193.)"
        ),
        "keywords": [
            "crpc 173", "section 173 crpc", "charge sheet", "chargesheet filing",
            "police report investigation complete", "final report police",
            "investigation delay complaint",
        ],
    },
    {
        "key": "crpc_200",
        "citation": "Code of Criminal Procedure 1973, Section 200 — Examination of complainant (private complaint)",
        "short_label": "CrPC 200",
        "act": "CrPC",
        "official_text": (
            "A Magistrate taking cognizance of an offence on complaint shall examine upon oath the "
            "complainant and the witnesses present, if any, and the substance of such examination "
            "shall be reduced to writing and shall be signed by the complainant and the witnesses, "
            "and also by the Magistrate."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "You can go directly to a Magistrate with a private complaint instead of the police; "
            "the Magistrate will record your statement on oath. (Old code; new equivalent is BNSS "
            "Section 223.)"
        ),
        "keywords": [
            "crpc 200", "section 200 crpc", "private complaint magistrate",
            "complaint case court", "direct complaint to court", "examination of complainant",
        ],
    },
    {
        "key": "crpc_436",
        "citation": "Code of Criminal Procedure 1973, Section 436 — In what cases bail to be taken (bailable offences)",
        "short_label": "CrPC 436",
        "act": "CrPC",
        "official_text": (
            "(1) When any person other than a person accused of a non-bailable offence is arrested "
            "or detained without warrant by an officer in charge of a police station, or appears or "
            "is brought before a Court, and is prepared at any time while in the custody of such "
            "officer or at any stage of the proceeding before such Court to give bail, such person "
            "shall be released on bail:\n"
            "Provided that such officer or Court, if he or it thinks fit, may, and shall, if such "
            "person is indigent and is unable to furnish surety, instead of taking bail from such "
            "person, discharge him on his executing a bond without sureties for his appearance."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "In a bailable offence, bail is your RIGHT — not a favour. If you are poor and cannot "
            "arrange a surety, you must be released on a personal bond. (Old code; new equivalent "
            "is BNSS Section 478.)"
        ),
        "keywords": [
            "crpc 436", "section 436 crpc", "bailable offence bail", "bail as right",
            "cannot afford surety bail", "personal bond release", "bail poor person",
        ],
    },
    {
        "key": "crpc_437",
        "citation": "Code of Criminal Procedure 1973, Section 437 — When bail may be taken in case of non-bailable offence",
        "short_label": "CrPC 437",
        "act": "CrPC",
        "official_text": (
            "(1) When any person accused of, or suspected of, the commission of any non-bailable "
            "offence is arrested or detained without warrant by an officer in charge of a police "
            "station or appears or is brought before a Court other than the High Court or Court of "
            "Session, he may be released on bail, but—\n"
            "(i) such person shall not be so released if there appear reasonable grounds for "
            "believing that he has been guilty of an offence punishable with death or imprisonment "
            "for life;\n"
            "Provided that the Court may direct that a person referred to in clause (i) or clause "
            "(ii) be released on bail if such person is under the age of sixteen years or is a woman "
            "or is sick or infirm."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "In a non-bailable offence bail is at the court's discretion, but children under 16, "
            "women, and the sick or infirm may still be granted bail. (Old code; new equivalent is "
            "BNSS Section 480.)"
        ),
        "keywords": [
            "crpc 437", "section 437 crpc", "non bailable offence bail", "bail discretion court",
            "bail for woman accused", "bail sick accused", "regular bail",
        ],
    },
    {
        "key": "crpc_438",
        "citation": "Code of Criminal Procedure 1973, Section 438 — Direction for grant of bail to person apprehending arrest (anticipatory bail)",
        "short_label": "CrPC 438",
        "act": "CrPC",
        "official_text": (
            "(1) Where any person has reason to believe that he may be arrested on accusation of "
            "having committed a non-bailable offence, he may apply to the High Court or the Court of "
            "Session for a direction under this section; and that Court may, if it thinks fit, "
            "direct that in the event of such arrest, he shall be released on bail. ...\n"
            "(2) When the High Court or the Court of Session makes a direction under sub-section "
            "(1), it may include such conditions in such directions in the light of the facts of "
            "the particular case, as it may think fit, including—\n"
            "(i) a condition that the person shall make himself available for interrogation by a "
            "police officer as and when required;\n"
            "(ii) a condition that the person shall not, directly or indirectly, make any "
            "inducement, threat or promise to any person acquainted with the facts of the case..."
        ),
        "source_url": CRPC_URL,
        "verified_at": V,
        "scope_note": (
            "If you fear arrest in a non-bailable case, you can apply to the Sessions Court or High "
            "Court for anticipatory bail BEFORE being arrested. (Old code; new equivalent is BNSS "
            "Section 482.)"
        ),
        "keywords": [
            "crpc 438", "section 438 crpc", "anticipatory bail", "bail before arrest",
            "fear of arrest bail", "pre arrest bail", "agrim jamanat",
        ],
    },
]

IPC_CRPC_CORPUS = [
    dict(e, historical_still_applicable=True) for e in (IPC_ENTRIES + CRPC_ENTRIES)
]
# `historical_still_applicable=True` tells engine.law_status_guard.annotate_provisions
# NOT to treat these as dead/superseded provisions, even though the IPC/CrPC
# registry entries are INACTIVE: every entry in this file was hand-verified
# specifically to answer "what did the old IPC/CrPC section say" correctly,
# and that text remains the governing law for events/FIRs/trials from before
# the 1 July 2024 cutover — it must never be swallowed by the generic
# cannot-verify/dead-law refusal template (see law_status_guard.py for the
# exact mechanism this flag disables).
