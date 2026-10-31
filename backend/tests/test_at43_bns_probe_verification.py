"""
test_at43_bns_probe_verification.py — AT43 acceptance test closure.

Verifies that every BNS / BNSS section cited in the 10 Women's Shield
rights cards is present in the live corpus database and has the expected
section heading.

This is the PROBE-VERIFICATION step required to close AT43:
  "AT43 — BNS articles linked from Rights Cards verified against
   official text (corpus database)."

These tests are READ-ONLY; they never modify any collection.

POCSO (children_safety) and PWDV (thrown_out_of_home) are not in the BNS
corpus — those cards are checked for existence and release_state only.
"""

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"

# ── Citation registry ─────────────────────────────────────────────────────────
# (card_key, act_short, section_number, expected_heading_fragment)
CITATIONS = [
    ("police_wont_file",      "BNSS", "173", "Information in cognizable"),
    ("police_wont_file",      "BNSS", "175", "Police officer"),
    ("violence_at_home",      "BNS",  "85",  "Husband or relative"),
    ("dowry_demands",         "BNS",  "80",  "Dowry death"),
    ("dowry_demands",         "BNS",  "85",  "Husband or relative"),
    ("harassment_at_work",    "BNS",  "75",  "Sexual harassment"),
    ("stalking_online_abuse",  "BNS",  "78",  "Stalking"),
    ("private_photos_leaked", "BNS",  "77",  "Voyeurism"),
    ("after_assault",         "BNS",  "64",  "Punishment for rape"),
    ("after_assault",         "BNS",  "66",  "Punishment for causing death"),
    ("woman_arrested",        "BNSS", "43",  "Arrest how made"),
    ("woman_arrested",        "BNSS", "46",  "No unnecessary restraint"),
]

_ACT_NAME = {
    "BNS":  "Bharatiya Nyaya Sanhita",
    "BNSS": "Bharatiya Nagarik Suraksha Sanhita",
}

VALID_RELEASE_STATES = {"LEGAL_REVIEWED", "ADVOCATE_VERIFIED"}
ALL_CARD_KEYS = [
    "police_wont_file", "violence_at_home", "dowry_demands",
    "harassment_at_work", "stalking_online_abuse", "private_photos_leaked",
    "after_assault", "woman_arrested", "thrown_out_of_home", "children_safety",
]


# ── Helper ────────────────────────────────────────────────────────────────────

async def _get_section(act_short: str, section: str) -> dict | None:
    client = AsyncIOMotorClient(MONGO_URL)
    corpus = client["bns-know-your-rights-gandhikar_db"]
    doc = await corpus.legal_sections.find_one(
        {
            "section_number": section,
            "act_name": {"$regex": _ACT_NAME[act_short], "$options": "i"},
        },
        {"section_heading": 1, "_id": 0},
    )
    client.close()
    return doc


async def _get_card(scenario_key: str) -> dict | None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client["gandhikar_db"]
    card = await db.rights_cards.find_one(
        {"scenario_key": scenario_key},
        {"release_state": 1, "_id": 0},
    )
    client.close()
    return card


# ── AT43 Probe: BNS/BNSS sections present in corpus ──────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("card,act_short,section,heading_frag", CITATIONS)
async def test_bns_section_in_corpus(card: str, act_short: str, section: str, heading_frag: str):
    """AT43-PROBE: cited BNS/BNSS section exists in corpus with expected heading."""
    doc = await _get_section(act_short, section)
    assert doc is not None, (
        f"AT43 PROBE FAIL: {act_short} §{section} (card='{card}') not found in corpus."
    )
    heading = doc.get("section_heading", "")
    assert heading_frag.lower() in heading.lower(), (
        f"AT43 PROBE FAIL: {act_short} §{section} heading {heading!r} "
        f"does not contain {heading_frag!r}."
    )


# ── AT43 Gate: all cards at LEGAL_REVIEWED or above ──────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("scenario_key", ALL_CARD_KEYS)
async def test_rights_card_at_or_above_legal_reviewed(scenario_key: str):
    """AT43-GATE: every rights card must be at LEGAL_REVIEWED or ADVOCATE_VERIFIED."""
    card = await _get_card(scenario_key)
    assert card is not None, (
        f"AT43 GATE FAIL: card '{scenario_key}' not found — seed script must be run."
    )
    assert card.get("release_state") in VALID_RELEASE_STATES, (
        f"Card '{scenario_key}' is at {card.get('release_state')!r}, "
        f"expected one of {VALID_RELEASE_STATES}."
    )


# ── AT43 Sanity: corpus coverage ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_corpus_bns_section_count_minimum():
    """AT43-SANITY: corpus must have ≥ 100 BNS sections (proves DB is populated)."""
    client = AsyncIOMotorClient(MONGO_URL)
    corpus = client["bns-know-your-rights-gandhikar_db"]
    count = await corpus.legal_sections.count_documents(
        {"act_name": {"$regex": "Bharatiya Nyaya Sanhita", "$options": "i"}}
    )
    client.close()
    assert count >= 100, (
        f"BNS corpus has only {count} sections — expected ≥ 100. "
        "Verify that bns-know-your-rights-gandhikar_db is populated."
    )
