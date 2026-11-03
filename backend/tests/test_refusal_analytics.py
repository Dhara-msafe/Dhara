"""
Tests for refusal-cause-code analytics instrumentation (A4 feature).
Covers:
  - POST /api/chat/stream still returns correct refusal/success SSE (no regression)
  - db.refusal_events created ONLY on refusal, with privacy-safe schema
  - GET /api/admin/refusal-stats (admin-key protected) returns expected shape/counts
  - Regression: /api/admin/stats, /api/admin/export/*.csv still work
"""
import os
import uuid
import time
import requests
import pytest
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "gandhikar_db")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")  # injected by the isolated QA runner; never hard-code

TEST_EMAIL = "protest@gandhikar.in"
TEST_PASSWORD = "test1234"

# NOTE: The review request suggested "cheque bounce section 138" / "divorce under
# Hindu Marriage Act" as refusal examples. In practice these DO NOT refuse — they
# trigger a false-positive retrieval match against unrelated corpus entries (see
# critical_code_review_comments in the test report) and the LLM then hallucinates
# an answer. Using a query with no keyword overlap instead, to reliably exercise
# the refusal path for this feature's own test purposes.
REFUSAL_QUERY = "cryptocurrency exchange withdrawal frozen blockchain wallet dispute"
SUCCESS_QUERY = "What is Article 21?"


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def auth_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL, "password": TEST_PASSWORD
    })
    if resp.status_code != 200:
        pytest.skip(f"Login failed: {resp.status_code} {resp.text}")
    return resp.json()["token"]


def stream_chat(token, message, session_id=None):
    """Consume the SSE stream and return (full_text, event_types)."""
    resp = requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message": message,
            "session_id": session_id,
            "language": "en",
            "language_name": "English",
            "mode": "basic",
        },
        stream=True,
        timeout=60,
    )
    return resp


class TestChatRefusalRegression:
    """Verify chat/stream refusal + success paths still work correctly."""

    def test_refusal_query_returns_refusal_message(self, auth_token):
        resp = stream_chat(auth_token, REFUSAL_QUERY)
        assert resp.status_code == 200
        body = resp.text
        assert "data:" in body
        assert "delta" in body or "done" in body
        # Refusal text should mention verified source / advocate
        assert ("verified source" in body.lower() or "consult" in body.lower())
        # No citations should accompany a pure refusal
        assert '"type": "citation"' not in body

    def test_success_query_returns_citation_and_answer(self, auth_token):
        resp = stream_chat(auth_token, SUCCESS_QUERY)
        assert resp.status_code == 200
        body = resp.text
        assert "citation" in body.lower()
        assert "type\": \"delta\"" in body or "delta" in body


class TestRefusalEventsPersistence:
    """Verify refusal_events collection is populated correctly & privately."""

    def test_refusal_creates_refusal_event_with_privacy_safe_schema(self, auth_token, mongo_db):
        before_count = mongo_db.refusal_events.count_documents({})
        resp = stream_chat(auth_token, REFUSAL_QUERY)
        assert resp.status_code == 200
        time.sleep(1)
        after_count = mongo_db.refusal_events.count_documents({})
        assert after_count == before_count + 1, "Expected exactly one new refusal_events doc"

        doc = mongo_db.refusal_events.find_one(sort=[("created_at", -1)])
        assert doc is not None
        allowed_keys = {
            "_id", "id", "cause_code", "sub_cause", "category",
            "language", "state", "top_score", "top_key", "created_at",
        }
        actual_keys = set(doc.keys())
        assert actual_keys.issubset(allowed_keys), f"Unexpected fields: {actual_keys - allowed_keys}"
        # Explicit privacy checks
        assert "user_id" not in doc
        assert "session_id" not in doc
        assert "message" not in doc
        assert "content" not in doc
        assert "query" not in doc
        assert doc["state"] is None
        assert doc["language"] == "en"
        assert doc["cause_code"] in {
            "no_corpus_match", "non_indian_jurisdiction", "not_legal_advice_request",
        }

    def test_success_query_creates_no_refusal_event(self, auth_token, mongo_db):
        before_count = mongo_db.refusal_events.count_documents({})
        resp = stream_chat(auth_token, SUCCESS_QUERY)
        assert resp.status_code == 200
        time.sleep(1)
        after_count = mongo_db.refusal_events.count_documents({})
        assert after_count == before_count, "Successful query must NOT create a refusal_events doc"

    def test_non_indian_jurisdiction_refusal_sets_correct_cause_code(self, auth_token, mongo_db):
        resp = stream_chat(auth_token, "What is the punishment for theft under California Penal Code?")
        assert resp.status_code == 200
        time.sleep(1)
        doc = mongo_db.refusal_events.find_one(sort=[("created_at", -1)])
        assert doc["cause_code"] == "non_indian_jurisdiction"
        assert doc["sub_cause"] is None
        assert doc["top_score"] is None

    def test_not_legal_advice_refusal_sets_correct_cause_code(self, auth_token, mongo_db):
        resp = stream_chat(auth_token, "Should I forgive my husband for cheating on me?")
        assert resp.status_code == 200
        time.sleep(1)
        doc = mongo_db.refusal_events.find_one(sort=[("created_at", -1)])
        assert doc["cause_code"] == "not_legal_advice_request"


class TestAdminRefusalStats:
    """GET /api/admin/refusal-stats"""

    def test_requires_admin_key_missing(self):
        resp = requests.get(f"{BASE_URL}/api/admin/refusal-stats")
        assert resp.status_code in (401, 403)

    def test_requires_admin_key_wrong(self):
        resp = requests.get(f"{BASE_URL}/api/admin/refusal-stats",
                             headers={"x-admin-key": "wrong-key"})
        assert resp.status_code in (401, 403)

    def test_returns_expected_shape_with_correct_key(self, auth_token):
        # generate at least one refusal first
        stream_chat(auth_token, REFUSAL_QUERY)
        time.sleep(1)
        resp = requests.get(f"{BASE_URL}/api/admin/refusal-stats",
                             headers={"x-admin-key": ADMIN_KEY})
        assert resp.status_code == 200
        data = resp.json()
        expected_keys = {
            "window_days", "total_refusals", "by_cause_code", "by_sub_cause",
            "by_category", "by_language", "score_histogram", "near_miss_top_keys",
            "generated_at",
        }
        assert expected_keys.issubset(set(data.keys()))
        assert data["total_refusals"] >= 1
        assert isinstance(data["by_cause_code"], dict)
        assert sum(data["by_cause_code"].values()) == data["total_refusals"]


class TestAdminRegression:
    """Regression: existing admin endpoints unaffected."""

    def test_admin_stats_with_key(self):
        resp = requests.get(f"{BASE_URL}/api/admin/stats",
                             headers={"x-admin-key": ADMIN_KEY})
        assert resp.status_code == 200
        data = resp.json()
        assert "users_total" in data
        assert "messages_total" in data

    def test_admin_stats_without_key(self):
        resp = requests.get(f"{BASE_URL}/api/admin/stats")
        assert resp.status_code in (401, 403)

    def test_export_users_csv(self):
        resp = requests.get(f"{BASE_URL}/api/admin/export/users.csv",
                             headers={"x-admin-key": ADMIN_KEY})
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        assert "email" in resp.text.splitlines()[0]

    def test_export_messages_csv(self):
        resp = requests.get(f"{BASE_URL}/api/admin/export/messages.csv",
                             headers={"x-admin-key": ADMIN_KEY})
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        assert "timestamp" in resp.text.splitlines()[0]
