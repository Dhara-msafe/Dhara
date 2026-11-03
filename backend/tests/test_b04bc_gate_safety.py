"""B-04b / B-04c: safety before the access gates.

Expired guest (401) and exhausted-Pro (402) are ACCESS gates, not safety gates.
Immediate-danger and bare-distress messages must still get the deterministic
112 banner / SOS reply — no LLM call, no quota/sample consumption. Ordinary
messages must still receive 401 / 402 unchanged.
"""
import os
import time

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
PRO_FREE_SAMPLES = int(os.environ.get("PRO_FREE_SAMPLES", "5"))

DANGER_MSG = "he is going to kill me right now"
DISTRESS_MSG = "help"
ORDINARY_MSG = "What is a will?"


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
@pytest.fixture()
def expired_guest(db):
    r = requests.post(f"{API}/auth/guest", json={"language": "en"}, timeout=20)
    if r.status_code == 429:
        pytest.skip("guest-session throttle (429)")
    assert r.status_code == 200, r.text
    data = r.json()
    uid = data["user"]["id"]
    res = db.users.update_one(
        {"id": uid},
        {"$set": {"guest_expires_at": "2020-01-01T00:00:00+00:00", "guest_question_count": 0}},
    )
    if res.matched_count == 0:
        pytest.skip("could not locate guest user doc")
    yield data["token"], uid
    db.users.delete_one({"id": uid})


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
@pytest.fixture()
def exhausted_pro(db):
    uniq = int(time.time() * 1000)
    email = f"TEST_b04c_{uniq}@gandhikar.in"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "test1234",
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
    db.users.delete_one({"id": uid})


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
