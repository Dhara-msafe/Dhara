"""
Indian States and Union Territories — the jurisdiction list used for
state-specific legal rules (traffic compounding amounts, State Police Acts,
State RTI Rules, excise/prohibition, rent control).

`code` values are the official 2-letter ISO 3166-2:IN subdivision codes, so they
are stable and safe to store on the user document forever.
"""
from typing import Optional

STATES = [
    # ---- 28 States ----
    {"code": "AP", "name": "Andhra Pradesh", "native": "ఆంధ్రప్రదేశ్", "type": "state"},
    {"code": "AR", "name": "Arunachal Pradesh", "native": "अरुणाचल प्रदेश", "type": "state"},
    {"code": "AS", "name": "Assam", "native": "অসম", "type": "state"},
    {"code": "BR", "name": "Bihar", "native": "बिहार", "type": "state"},
    {"code": "CG", "name": "Chhattisgarh", "native": "छत्तीसगढ़", "type": "state"},
    {"code": "GA", "name": "Goa", "native": "गोवा", "type": "state"},
    {"code": "GJ", "name": "Gujarat", "native": "ગુજરાત", "type": "state"},
    {"code": "HR", "name": "Haryana", "native": "हरियाणा", "type": "state"},
    {"code": "HP", "name": "Himachal Pradesh", "native": "हिमाचल प्रदेश", "type": "state"},
    {"code": "JH", "name": "Jharkhand", "native": "झारखंड", "type": "state"},
    {"code": "KA", "name": "Karnataka", "native": "ಕರ್ನಾಟಕ", "type": "state"},
    {"code": "KL", "name": "Kerala", "native": "കേരളം", "type": "state"},
    {"code": "MP", "name": "Madhya Pradesh", "native": "मध्य प्रदेश", "type": "state"},
    {"code": "MH", "name": "Maharashtra", "native": "महाराष्ट्र", "type": "state"},
    {"code": "MN", "name": "Manipur", "native": "মণিপুর", "type": "state"},
    {"code": "ML", "name": "Meghalaya", "native": "मेघालय", "type": "state"},
    {"code": "MZ", "name": "Mizoram", "native": "मिजोरम", "type": "state"},
    {"code": "NL", "name": "Nagaland", "native": "नागालैंड", "type": "state"},
    {"code": "OD", "name": "Odisha", "native": "ଓଡ଼ିଶା", "type": "state"},
    {"code": "PB", "name": "Punjab", "native": "ਪੰਜਾਬ", "type": "state"},
    {"code": "RJ", "name": "Rajasthan", "native": "राजस्थान", "type": "state"},
    {"code": "SK", "name": "Sikkim", "native": "सिक्किम", "type": "state"},
    {"code": "TN", "name": "Tamil Nadu", "native": "தமிழ்நாடு", "type": "state"},
    {"code": "TG", "name": "Telangana", "native": "తెలంగాణ", "type": "state"},
    {"code": "TR", "name": "Tripura", "native": "ত্রিপুরা", "type": "state"},
    {"code": "UP", "name": "Uttar Pradesh", "native": "उत्तर प्रदेश", "type": "state"},
    {"code": "UK", "name": "Uttarakhand", "native": "उत्तराखंड", "type": "state"},
    {"code": "WB", "name": "West Bengal", "native": "পশ্চিমবঙ্গ", "type": "state"},
    # ---- 8 Union Territories ----
    {"code": "AN", "name": "Andaman & Nicobar Islands", "native": "अंडमान और निकोबार", "type": "ut"},
    {"code": "CH", "name": "Chandigarh", "native": "चंडीगढ़", "type": "ut"},
    {"code": "DH", "name": "Dadra & Nagar Haveli and Daman & Diu", "native": "दादरा नगर हवेली और दमन दीव", "type": "ut"},
    {"code": "DL", "name": "Delhi (NCT)", "native": "दिल्ली", "type": "ut"},
    {"code": "JK", "name": "Jammu & Kashmir", "native": "जम्मू और कश्मीर", "type": "ut"},
    {"code": "LA", "name": "Ladakh", "native": "लद्दाख", "type": "ut"},
    {"code": "LD", "name": "Lakshadweep", "native": "लक्षद्वीप", "type": "ut"},
    {"code": "PY", "name": "Puducherry", "native": "புதுச்சேரி", "type": "ut"},
]

STATE_BY_CODE = {s["code"]: s for s in STATES}
STATE_NAME_TO_CODE = {s["name"].upper(): s["code"] for s in STATES}

# B-78: major cities mapped to their state/UT code. This exists because the
# session-level jurisdiction value (engine.models.Jurisdiction.state, set by
# the LLM query parser from the user's own wording) is free text, not
# constrained to a code -- a query that names a city ("Bengaluru") rather
# than a state ("Karnataka") previously reached state_name() unresolved,
# producing a notice with a blank state name even though the question did
# name a real place. Covers state/UT capitals and other major metros; it is
# intentionally not exhaustive (no tier-3 towns) -- anything not listed here
# still falls through to "please confirm your state" rather than guessing.
CITY_TO_STATE_CODE = {
    "BENGALURU": "KA", "BANGALORE": "KA", "MYSURU": "KA", "MYSORE": "KA",
    "MUMBAI": "MH", "PUNE": "MH", "NAGPUR": "MH", "THANE": "MH",
    "CHENNAI": "TN", "COIMBATORE": "TN", "MADURAI": "TN",
    "HYDERABAD": "TG", "WARANGAL": "TG",
    "KOLKATA": "WB", "HOWRAH": "WB",
    "AHMEDABAD": "GJ", "SURAT": "GJ", "VADODARA": "GJ", "GANDHINAGAR": "GJ",
    "JAIPUR": "RJ", "JODHPUR": "RJ", "UDAIPUR": "RJ",
    "LUCKNOW": "UP", "KANPUR": "UP", "NOIDA": "UP", "AGRA": "UP", "VARANASI": "UP", "GHAZIABAD": "UP",
    "PATNA": "BR", "GAYA": "BR",
    "BHOPAL": "MP", "INDORE": "MP", "JABALPUR": "MP", "GWALIOR": "MP",
    "CHANDIGARH": "CH",
    "GURUGRAM": "HR", "GURGAON": "HR", "FARIDABAD": "HR",
    "THIRUVANANTHAPURAM": "KL", "KOCHI": "KL", "COCHIN": "KL", "KOZHIKODE": "KL",
    "BHUBANESWAR": "OD", "CUTTACK": "OD",
    "RAIPUR": "CG",
    "RANCHI": "JH", "JAMSHEDPUR": "JH",
    "DEHRADUN": "UK",
    "SHIMLA": "HP",
    "AMARAVATI": "AP", "VISAKHAPATNAM": "AP", "VIJAYAWADA": "AP",
    "GUWAHATI": "AS",
    "PANAJI": "GA", "PANJIM": "GA",
    "AMRITSAR": "PB", "LUDHIANA": "PB",
    "PUDUCHERRY": "PY", "PONDICHERRY": "PY",
    "NEW DELHI": "DL", "DELHI": "DL",
}


def state_name(code: str) -> str:
    s = STATE_BY_CODE.get((code or "").upper())
    return s["name"] if s else ""


def is_valid_state(code: str) -> bool:
    return (code or "").upper() in STATE_BY_CODE


def normalize_state_value(raw: Optional[str]) -> Optional[str]:
    """B-78: turn free text (a code, a full state name, or a known city
    name) into a valid 2-letter state/UT code, or None if it doesn't
    resolve to one. Never raises and never guesses past this list --
    anything unresolved returns None so callers fall back to the
    "please confirm your state" path instead of a blank-name notice."""
    if not raw:
        return None
    v = raw.strip().upper()
    if v in STATE_BY_CODE:
        return v
    if v in STATE_NAME_TO_CODE:
        return STATE_NAME_TO_CODE[v]
    if v in CITY_TO_STATE_CODE:
        return CITY_TO_STATE_CODE[v]
    return None
