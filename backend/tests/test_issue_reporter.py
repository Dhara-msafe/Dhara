"""In-app issue reporter — validation, auth, admin-only access, rate limit,
and the privacy contract of the automatic `error_events` log.

Live HTTP against the running backend. Synthetic data only; every report this
file creates is removed at the end.
"""
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")

EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"

VALID_CATEGORY = "Navigation & UI"
MARKER = f"TEST_issue_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code}")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def _cleanup(db):
    yield
    db.issue_reports.delete_many({"title": {"$regex": f"^{MARKER}"}})


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _body(**over):
    payload = {"category": VALID_CATEGORY, "title": f"{MARKER} title", "description": "A description."}
    payload.update(over)
    return payload


class TestCategories:
    def test_category_list_is_public_and_complete(self):
        r = requests.get(f"{API}/issues/categories", timeout=30)
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert len(cats) == 17
        assert cats[0] == "Installation, Upgrade & Launch"
        assert cats[-1] == "Other"
        assert r.json()["statuses"] == ["New", "In progress", "Resolved"]


class TestAuth:
    def test_anonymous_cannot_report(self):
        r = requests.post(f"{API}/issues", json=_body(), timeout=30)
        assert r.status_code == 401

    def test_signed_in_user_can_report(self, token):
        r = requests.post(f"{API}/issues", json=_body(), headers=auth(token), timeout=30)
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "New"
        assert r.json()["id"]


class TestValidation:
    def test_unknown_category_rejected(self, token):
        r = requests.post(f"{API}/issues", json=_body(category="Totally Made Up"),
                          headers=auth(token), timeout=30)
        assert r.status_code == 422

    def test_missing_fields_rejected(self, token):
        r = requests.post(f"{API}/issues", json={"category": VALID_CATEGORY}, headers=auth(token), timeout=30)
        assert r.status_code == 422

    def test_blank_title_rejected(self, token):
        r = requests.post(f"{API}/issues", json=_body(title="   "), headers=auth(token), timeout=30)
        assert r.status_code == 422

    def test_oversize_text_is_capped_not_rejected(self, token, db):
        r = requests.post(
            f"{API}/issues",
            json=_body(title=f"{MARKER} " + "x" * 400, description="y" * 5000),
            headers=auth(token), timeout=30,
        )
        assert r.status_code == 201, r.text
        doc = db.issue_reports.find_one({"id": r.json()["id"]})
        assert len(doc["title"]) <= 120
        assert len(doc["description"]) <= 2000


class TestPrivacyOfStoredReport:
    def test_report_stores_no_contact_details(self, token, db):
        r = requests.post(f"{API}/issues", json=_body(), headers=auth(token), timeout=30)
        doc = db.issue_reports.find_one({"id": r.json()["id"]})
        for field in ("email", "phone", "name", "token", "lat", "lng", "location", "headers"):
            assert field not in doc, f"report must not store {field}"
        assert doc["user_id"]  # the only reporter identifier


class TestAdminOnly:
    def test_list_requires_admin_key(self):
        assert requests.get(f"{API}/issues", timeout=30).status_code in (401, 503)

    def test_user_token_is_not_admin(self, token):
        r = requests.get(f"{API}/issues", headers=auth(token), timeout=30)
        assert r.status_code in (401, 503)

    def test_admin_can_list_and_filter(self, token):
        if not ADMIN_KEY:
            pytest.skip("ADMIN_KEY not configured in this environment")
        requests.post(f"{API}/issues", json=_body(), headers=auth(token), timeout=30)
        r = requests.get(f"{API}/issues", params={"category": VALID_CATEGORY},
                         headers={"X-Admin-Key": ADMIN_KEY}, timeout=30)
        assert r.status_code == 200, r.text
        assert all(i["category"] == VALID_CATEGORY for i in r.json()["items"])

    def test_admin_can_change_status_and_rejects_unknown_status(self, token):
        if not ADMIN_KEY:
            pytest.skip("ADMIN_KEY not configured in this environment")
        created = requests.post(f"{API}/issues", json=_body(), headers=auth(token), timeout=30).json()["id"]
        ok = requests.patch(f"{API}/issues/{created}", json={"status": "In progress"},
                            headers={"X-Admin-Key": ADMIN_KEY}, timeout=30)
        assert ok.status_code == 200 and ok.json()["status"] == "In progress"
        bad = requests.patch(f"{API}/issues/{created}", json={"status": "Wontfix"},
                             headers={"X-Admin-Key": ADMIN_KEY}, timeout=30)
        assert bad.status_code == 422
        missing = requests.patch(f"{API}/issues/{uuid.uuid4()}", json={"status": "Resolved"},
                                 headers={"X-Admin-Key": ADMIN_KEY}, timeout=30)
        assert missing.status_code == 404

    def test_status_patch_requires_admin_key(self, token):
        r = requests.patch(f"{API}/issues/{uuid.uuid4()}", json={"status": "Resolved"},
                           headers=auth(token), timeout=30)
        assert r.status_code in (401, 503)


class TestRateLimit:
    def test_twenty_one_reports_in_an_hour_is_refused(self, token, db):
        """The 21st report inside one hour must be refused with 429."""
        codes = []
        for i in range(21):
            r = requests.post(f"{API}/issues", json=_body(title=f"{MARKER} rl {i}"),
                              headers=auth(token), timeout=30)
            codes.append(r.status_code)
            if r.status_code == 429:
                break
        assert 429 in codes, codes
        # Clean up this burst so the shared QA account is not left at the cap.
        db.issue_reports.delete_many({"title": {"$regex": f"^{MARKER} rl"}})


class TestErrorEventPrivacy:
    def test_error_events_never_hold_request_content(self, db):
        """Whatever is already in error_events must satisfy the contract: route,
        method, error type, traceback, status code, timestamp — nothing else."""
        allowed = {"_id", "route", "method", "error_type", "traceback", "status_code", "created_at"}
        for doc in db.error_events.find().limit(50):
            assert set(doc.keys()).issubset(allowed), f"unexpected fields: {set(doc) - allowed}"
            assert "?" not in doc["route"], "query string must be stripped from the route"
            for banned in ("body", "headers", "authorization", "token", "lat", "lng", "email", "phone"):
                assert banned not in doc


class TestErrorEventsAdminFeed:
    """GET /api/admin/error-events — the operator view behind admin-issues.tsx."""

    def test_requires_admin_key(self):
        assert requests.get(f"{API}/admin/error-events", timeout=30).status_code in (401, 503)

    def test_user_token_is_not_admin(self, token):
        r = requests.get(f"{API}/admin/error-events", headers=auth(token), timeout=30)
        assert r.status_code in (401, 503)

    def test_admin_feed_shape_and_privacy(self, db):
        if not ADMIN_KEY:
            pytest.skip("ADMIN_KEY not configured in this environment")
        marker_route = f"/api/__qa_{uuid.uuid4().hex[:8]}"
        db.error_events.insert_one({
            "route": marker_route, "method": "GET", "error_type": "QaSyntheticError",
            "traceback": "QA synthetic traceback", "status_code": 500,
            "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        })
        try:
            r = requests.get(f"{API}/admin/error-events", params={"route": marker_route},
                             headers={"X-Admin-Key": ADMIN_KEY}, timeout=30)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["count"] == 1 and data["by_route"] == {marker_route: 1}
            assert data["by_error_type"] == {"QaSyntheticError": 1}
            item = data["items"][0]
            assert set(item.keys()) == {"route", "method", "error_type", "traceback",
                                        "status_code", "created_at"}
            assert isinstance(item["created_at"], str)
        finally:
            db.error_events.delete_many({"route": marker_route})
