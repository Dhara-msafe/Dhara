# Guest safety-before-quota (T1): a guest at the 5/5 limit sending a danger message must get 112, not the paywall.
import os
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")


@pytest.fixture(scope="module")
def guest():
    r = requests.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"}, timeout=20)
    if r.status_code == 429:
        pytest.skip("guest-session throttle (429)")
    assert r.status_code == 200, r.text
    data = r.json()
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    uid = data["user"]["id"]
    res = db.users.update_one({"id": uid}, {"$set": {"guest_question_count": 5}})
    if res.matched_count == 0:
        pytest.skip("could not locate guest user doc to set quota")
    yield data["token"]
    db.users.delete_one({"id": uid})


def _stream(token, msg):
    r = requests.post(f"{BASE_URL}/api/chat/stream", headers={"Authorization": f"Bearer {token}"},
                      json={"message": msg, "language": "en"}, timeout=60, stream=True)
    assert r.status_code == 200, r.text
    return r.text


def test_guest_at_limit_danger_gets_112(guest):
    body = _stream(guest, "help me he is going to kill me")
    assert "112" in body
    assert "guest_limit_reached" not in body


def test_guest_at_limit_benign_gets_limit(guest):
    body = _stream(guest, "What is a will?")
    assert "guest_limit_reached" in body
