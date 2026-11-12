"""B-04b / B-04c: safety before the access gates.

Expired guest (401) and exhausted-Pro (402) are ACCESS gates, not safety gates.
Immediate-danger and bare-distress messages must still get the deterministic
112 banner / SOS reply — no LLM call, no quota/sample consumption. Ordinary
messages must still receive 401 / 402 unchanged.
"""
import os
import sys
import time

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

sys.path.insert(0, "/app/backend")
from dependencies import make_token  # noqa: E402

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
PRO_FREE_SAMPLES = int(os.environ.get("PRO_FREE_SAMPLES", "5"))

DANGER_MSG = "he is going to kill me right now"
DISTRESS_MSG = "help"
ORDINARY_MSG = "What is a will?"

# Every user-linked collection a test account can touch (mirrors
# account_deletion._SIMPLE_USER_ID_COLLECTIONS) — tests must leave no residue.
USER_LINKED_COLLECTIONS = [
    "sessions", "messages", "bookmarks", "draft_events", "password_resets",
    "terms_acknowledgements", "client_error_logs", "billing_intents",
    "missing_media",
]


def _purge(db, uid: str):
    for name in USER_LINKED_COLLECTIONS:
        db[name].delete_many({"user_id": uid})
    db.usage_daily.delete_many({"user_id": uid, "scope": "user"})
    db.users.delete_one({"id": uid})


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _post(token, msg):
    return requests.post(
        f"{API}/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": msg, "language": "en", "mode": "pro"},
        timeout=60,
    )


# ---------------- expired guest (B-04b) ----------------
# The guest doc + token are built directly (POST /api/auth/guest is IP
# rate-limited, which made this fixture skip on repeat runs). make_token is the
# same minting helper the auth router uses, so the request is a genuine
# authenticated guest call end-to-end.
@pytest.fixture()
def expired_guest(db):
    uid = f"TEST_b04b_guest_{int(time.time() * 1000)}"
    db.users.insert_one({
        "id": uid,
        "email": f"{uid}@guest.local",
        "name": "B04b Guest",
        "is_guest": True,
        "guest_expires_at": "2020-01-01T00:00:00+00:00",
        "guest_question_count": 0,
        "guest_question_limit": 5,
    })
    yield make_token(uid), uid
    _purge(db, uid)


def test_expired_guest_danger_gets_112(expired_guest, db):
    token, uid = expired_guest
    r = _post(token, DANGER_MSG)
    assert r.status_code == 200, r.text
    assert "112" in r.text
    assert '"emergency": true' in r.text.lower()
    # no quota consumption
    assert int(db.users.find_one({"id": uid}).get("guest_question_count", 0)) == 0


def test_expired_guest_distress_gets_sos(expired_guest, db):
    token, uid = expired_guest
    r = _post(token, DISTRESS_MSG)
    assert r.status_code == 200, r.text
    assert "112" in r.text or "181" in r.text
    assert int(db.users.find_one({"id": uid}).get("guest_question_count", 0)) == 0


def test_expired_guest_ordinary_still_401(expired_guest, db):
    token, uid = expired_guest
    r = _post(token, ORDINARY_MSG)
    assert r.status_code == 401, r.text
    assert "guest_expired" in r.text
    assert int(db.users.find_one({"id": uid}).get("guest_question_count", 0)) == 0


# ---------------- exhausted Pro samples (B-04c) ----------------
@pytest.fixture(scope="module")
def exhausted_pro(db):
    uniq = int(time.time() * 1000)
    email = f"TEST_b04c_{uniq}@gandhikar.in"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "Test1234!",
            "name": "B04c Tester",
            "phone": f"+9198771{uniq % 100000:05d}",
            "terms_accepted": True,
            "terms_version": "1.0",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    uid = r.json()["user"]["id"]
    db.users.update_one(
        {"id": uid}, {"$set": {"is_pro": False, "pro_samples_used": PRO_FREE_SAMPLES}},
    )
    yield token, uid
    _purge(db, uid)


def test_exhausted_pro_danger_gets_112(exhausted_pro, db):
    token, uid = exhausted_pro
    r = _post(token, DANGER_MSG)
    assert r.status_code == 200, r.text
    assert "112" in r.text
    assert int(db.users.find_one({"id": uid})["pro_samples_used"]) == PRO_FREE_SAMPLES


def test_exhausted_pro_distress_gets_sos(exhausted_pro, db):
    token, uid = exhausted_pro
    r = _post(token, DISTRESS_MSG)
    assert r.status_code == 200, r.text
    assert "112" in r.text or "181" in r.text
    assert int(db.users.find_one({"id": uid})["pro_samples_used"]) == PRO_FREE_SAMPLES


def test_exhausted_pro_ordinary_still_402(exhausted_pro, db):
    token, uid = exhausted_pro
    r = _post(token, ORDINARY_MSG)
    assert r.status_code == 402, r.text
    assert "paywall" in r.text
    assert int(db.users.find_one({"id": uid})["pro_samples_used"]) == PRO_FREE_SAMPLES
