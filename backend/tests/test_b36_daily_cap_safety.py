"""B-36: the daily LLM spend cap (meter_llm_use, FREE_DAILY_QUERIES) is an
ACCESS gate, not a safety gate. An immediate-danger message from a free user
who has exhausted today's query cap must still get the deterministic 112
banner, not a 429 — exactly like the guest-expiry (B-04b) and Pro-paywall
(B-04c) gates, which test_b04bc_gate_safety.py already covers.
"""
import os
import sys
import time
from datetime import datetime, timezone

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
FREE_DAILY_QUERIES = int(os.environ.get("FREE_DAILY_QUERIES", "30"))

DANGER_MSG = "he is going to kill me right now"
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
    db.users.delete_one({"id": uid})


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _post(token, msg):
    return requests.post(
        f"{API}/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": msg, "language": "en", "mode": "basic"},
        timeout=60,
    )


@pytest.fixture()
def free_user_at_daily_cap(db):
    uniq = int(time.time() * 1000)
    email = f"TEST_b36_{uniq}@gandhikar.in"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "test1234",
            "name": "B36 Tester",
            "phone": f"+9198772{uniq % 100000:05d}",
            "terms_accepted": True,
            "terms_version": "1.0",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    uid = r.json()["user"]["id"]
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db.usage_daily.update_one(
        {"scope": "user", "user_id": uid, "day": day, "kind": "query"},
        {"$set": {"count": FREE_DAILY_QUERIES + 1}},
        upsert=True,
    )
    yield token, uid
    _purge(db, uid)


def test_free_user_at_cap_danger_gets_112(free_user_at_daily_cap):
    token, _uid = free_user_at_daily_cap
    r = _post(token, DANGER_MSG)
    assert r.status_code == 200, r.text
    assert "112" in r.text


def test_free_user_at_cap_ordinary_still_429(free_user_at_daily_cap):
    token, _uid = free_user_at_daily_cap
    r = _post(token, ORDINARY_MSG)
    assert r.status_code == 429, r.text
