"""B-37: mode="advocate" must only grant the professional prompt / skip the
Pro paywall for a VERIFIED advocate (a row in advocate_profiles). An
unverified account sending mode="advocate" must fall back to the ordinary
Pro gate - same paywall as a regular free user requesting mode="pro" - not
get free, unlimited Pro-quality access.
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

ORDINARY_MSG = "What is a will?"

USER_LINKED_COLLECTIONS = [
    "sessions", "messages", "bookmarks", "draft_events", "password_resets",
    "terms_acknowledgements", "client_error_logs", "billing_intents",
    "missing_media",
]


def _purge(db, uid: str):
    for name in USER_LINKED_COLLECTIONS:
        db[name].delete_many({"user_id": uid})
    db.usage_daily.delete_many({"user_id": uid, "scope": "user"})
    db.advocate_profiles.delete_many({"user_id": uid})
    db.verification_log.delete_many({"advocate_id": uid})
    db.users.delete_one({"id": uid})


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _register(db, tag):
    uniq = int(time.time() * 1000)
    email = f"TEST_b37_{tag}_{uniq}@gandhikar.in"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "test1234",
            "name": f"B37 {tag}",
            "phone": f"+9198773{uniq % 100000:05d}",
            "terms_accepted": True,
            "terms_version": "1.0",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    uid = r.json()["user"]["id"]
    db.users.update_one({"id": uid}, {"$set": {"is_pro": False, "pro_samples_used": PRO_FREE_SAMPLES}})
    return token, uid


@pytest.fixture()
def unverified_free_user(db):
    token, uid = _register(db, "unverified")
    yield token, uid
    _purge(db, uid)


@pytest.fixture()
def verified_advocate(db):
    token, uid = _register(db, "verified")
    db.advocate_profiles.insert_one({
        "user_id": uid,
        "bar_council_number": f"TEST/BCI/{uid[-8:]}",
        "state_bar": "Test State Bar",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    yield token, uid
    _purge(db, uid)


def _post(token, mode):
    return requests.post(
        f"{API}/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": ORDINARY_MSG, "language": "en", "mode": mode},
        timeout=60,
    )


def test_unverified_user_claiming_advocate_mode_still_hits_paywall(unverified_free_user, db):
    """Exhausted-Pro-samples free user sends mode="advocate" with no
    advocate_profiles row - must get the same 402 a mode="pro" request
    would, not a free pass."""
    token, uid = unverified_free_user
    r = _post(token, "advocate")
    assert r.status_code == 402, r.text
    assert "paywall" in r.text
    # no sample silently consumed, no advocate status granted
    assert int(db.users.find_one({"id": uid})["pro_samples_used"]) == PRO_FREE_SAMPLES


def test_verified_advocate_mode_bypasses_paywall(verified_advocate, db):
    """A genuinely registered advocate (has an advocate_profiles row) still
    gets the no-paywall professional prompt as intended."""
    token, uid = verified_advocate
    r = _post(token, "advocate")
    assert r.status_code == 200, r.text
    # paywall never consumed a sample for a real advocate either
    assert int(db.users.find_one({"id": uid})["pro_samples_used"]) == PRO_FREE_SAMPLES
