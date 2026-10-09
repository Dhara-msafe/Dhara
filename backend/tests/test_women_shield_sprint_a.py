"""
Sprint A acceptance tests — Emmy Build Brief, Section 3 ("Sprint A acceptance
tests"). Codifies the 6 checks explicitly listed in the brief so they run as
part of CI instead of being re-verified by hand every time:

  1. A DRAFT card is not served when the minimum state is ADVOCATE_VERIFIED.
  2. A quarantined card disappears on the very next request.
  3. A card whose corpus_id resolves to a repealed section is blocked.
  4. The three A3 routing examples return the expected scenario/urgency/112.
  5. An unverified directory entry is never returned.
  6. Layer M (the deterministic PROHIBITED-phrase strip) rejects every
     prohibited phrase from Section 1, Rule 6.

All tests are black-box HTTP against the running backend, using only the
public + admin APIs that already exist (no direct DB access, no new test
dependency) — same pattern as test_language_roundtrip_p0a.py.
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or ""
).rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

ADMIN_KEY = os.environ.get("ADMIN_KEY", "")
if not ADMIN_KEY:
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("ADMIN_KEY="):
                ADMIN_KEY = line.split("=", 1)[1].strip()
                break
assert ADMIN_KEY, "ADMIN_KEY not configured"
ADMIN_HEADERS = {"X-Admin-Key": ADMIN_KEY}

MONGO_URL = os.environ.get("MONGO_URL", "")
DB_NAME = os.environ.get("DB_NAME", "")
if not MONGO_URL or not DB_NAME:
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("MONGO_URL=") and not MONGO_URL:
                MONGO_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
            if line.startswith("DB_NAME=") and not DB_NAME:
                DB_NAME = line.split("=", 1)[1].strip().strip('"').strip("'")
assert MONGO_URL and DB_NAME, "MONGO_URL/DB_NAME not configured"

# Test-created cards/services are tracked here and swept up in a
# module-teardown fixture, so this file NEVER leaves stray "TESTNUM-"/
# "test_sprint_a_" documents visible to real users (there is deliberately no
# generic admin delete-service/delete-card endpoint, so cleanup goes
# straight to Mongo, scoped only to the exact ids this file created).
_CREATED_CARD_IDS: list = []
_CREATED_SERVICE_IDS: list = []


@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data():
    yield
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    if _CREATED_CARD_IDS:
        db.rights_cards.delete_many({"card_id": {"$in": _CREATED_CARD_IDS}})
    if _CREATED_SERVICE_IDS:
        db.service_directory.delete_many({"service_id": {"$in": _CREATED_SERVICE_IDS}})
    client.close()


@pytest.fixture(scope="module", autouse=True)
def ensure_flags_for_sprint_a():
    """A1 requires women_cards_min_release_state=ADVOCATE_VERIFIED to exercise
    the DRAFT-not-served check. Capture the original flags and restore them
    afterwards so this test module has no lasting side effect on the app."""
    original = requests.get(f"{BASE_URL}/api/women/flags", timeout=15).json()
    requests.post(
        f"{BASE_URL}/api/women/admin/flags",
        headers=ADMIN_HEADERS,
        json={"women_shield_enabled": True, "women_cards_min_release_state": "ADVOCATE_VERIFIED"},
        timeout=15,
    )
    yield
    requests.post(
        f"{BASE_URL}/api/women/admin/flags",
        headers=ADMIN_HEADERS,
        json={k: v for k, v in original.items() if k in (
            "women_shield_enabled", "women_cards_min_release_state", "discreet_mode_enabled",
            "trusted_circle_enabled", "evidence_locker_enabled",
        )},
        timeout=15,
    )


def _import_card(**overrides) -> dict:
    key = f"test_sprint_a_{uuid.uuid4().hex[:10]}"
    payload = {
        "scenario_key": key, "language": "en", "situation": "Test card (automated)",
        "verdict": "Test verdict.", "release_state": "DRAFT", "law": [],
    }
    payload.update(overrides)
    r = requests.post(f"{BASE_URL}/api/women/admin/cards/import", headers=ADMIN_HEADERS, json=[payload], timeout=15)
    assert r.status_code == 200, r.text
    card_id = r.json()["results"][0]["card_id"]
    _CREATED_CARD_IDS.append(card_id)
    return {"card_id": card_id, "scenario_key": key}


def _list_card_keys() -> dict:
    r = requests.get(f"{BASE_URL}/api/women/cards", params={"language": "en"}, timeout=15)
    assert r.status_code == 200, r.text
    return {c["scenario_key"]: c for c in r.json()["cards"]}


class TestA1DraftAndQuarantine:
    def test_draft_card_not_served_at_min_advocate_verified(self):
        created = _import_card(release_state="DRAFT")
        cards = _list_card_keys()
        assert created["scenario_key"] not in cards, (
            "A DRAFT card was served even though women_cards_min_release_state=ADVOCATE_VERIFIED"
        )

    def test_quarantine_takes_effect_on_next_request(self):
        created = _import_card(release_state="ADVOCATE_VERIFIED")
        assert created["scenario_key"] in _list_card_keys(), "setup failed: card should be visible before quarantine"
        r = requests.post(
            f"{BASE_URL}/api/women/admin/cards/{created['card_id']}/quarantine", headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert created["scenario_key"] not in _list_card_keys(), (
            "A quarantined card was still served on the very next request"
        )

    def test_repealed_section_blocks_card(self):
        # "IPC" is SUPERSEDED in law_status_registry.json (replaced by BNS 2023
        # on 1 July 2024) — a real repealed-act case, not a synthetic one.
        created = _import_card(
            release_state="ADVOCATE_VERIFIED",
            law=[{"corpus_id": "test", "act": "IPC", "section": "354", "status": "", "effective_date": ""}],
        )
        assert created["scenario_key"] not in _list_card_keys(), (
            "A card citing a repealed act (IPC, superseded by BNS 2023) was still served"
        )


class TestA3SafetyRouterExamples:
    """The three worked examples from Section 3, A3 of the brief, verbatim."""

    def test_domestic_violence_gives_112_first(self):
        r = requests.post(f"{BASE_URL}/api/women/route", json={"text": "my husband is beating me right now"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["urgency"] == "emergency"
        assert body["scenario_key"] == "violence_at_home"
        assert body["services"], "expected at least one service (112) for an emergency"
        assert "112" in body["services"][0]["number"], f"112 must be first, got {body['services'][0]}"

    def test_private_photos_gives_cyber_service(self):
        r = requests.post(f"{BASE_URL}/api/women/route", json={"text": "Someone posted my private photos"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scenario_key"] == "private_photos_leaked"
        assert any("1930" in s["number"] for s in body["services"]), (
            f"expected the 1930 cyber helpline, got {body['services']}"
        )

    def test_police_refusing_fir_gives_no_112(self):
        r = requests.post(f"{BASE_URL}/api/women/route", json={"text": "The police won't write my complaint"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scenario_key"] == "police_wont_file"
        assert body["urgency"] == "normal"
        assert not any("112" in s["number"] for s in body["services"]), (
            f"police-refusing-FIR must NOT include 112, got {body['services']}"
        )


class TestA2UnverifiedServiceNeverReturned:
    def test_unverified_service_hidden_until_verified(self):
        name = f"Test Helpline {uuid.uuid4().hex[:8]}"
        number = f"TESTNUM-{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/women/admin/services/import", headers=ADMIN_HEADERS,
            json=[{"name": name, "number": number, "categories": ["women_support"]}], timeout=15,
        )
        assert r.status_code == 200, r.text
        service_id = r.json()["results"][0]["service_id"]
        _CREATED_SERVICE_IDS.append(service_id)

        helplines = requests.get(f"{BASE_URL}/api/women/helplines", timeout=15).json()["services"]
        assert not any(s["number"] == number for s in helplines), (
            "An unverified (verified_at=null) service was returned by /women/helplines"
        )

        v = requests.post(f"{BASE_URL}/api/women/admin/services/{service_id}/verify", headers=ADMIN_HEADERS, timeout=15)
        assert v.status_code == 200, v.text

        helplines_after = requests.get(f"{BASE_URL}/api/women/helplines", timeout=15).json()["services"]
        assert any(s["number"] == number for s in helplines_after), (
            "A newly-verified service was not returned by /women/helplines"
        )


class TestLayerMProhibitedPhrases:
    PROHIBITED = [
        "help is on the way", "police have been notified", "your fir has been filed",
        "your complaint has been registered", "court-ready", "guaranteed admissible",
        "you will win",
    ]

    def test_every_prohibited_phrase_is_stripped(self):
        verdict = " ".join(f"Sentence with {p}." for p in self.PROHIBITED)
        created = _import_card(release_state="ADVOCATE_VERIFIED", verdict=verdict)
        cards = _list_card_keys()
        assert created["scenario_key"] in cards, "setup failed: card should be visible"
        served_verdict = cards[created["scenario_key"]]["verdict"].lower()
        for phrase in self.PROHIBITED:
            assert phrase not in served_verdict, f"prohibited phrase '{phrase}' was NOT stripped from served card text"
