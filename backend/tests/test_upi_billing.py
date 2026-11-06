"""
Backend tests for DHARA Pro UPI Payment Page (Phase 1) — api/upi_billing_router.py

Covers:
  - GET /api/billing/upi/config        (public)
  - GET /api/billing/upi/qrcode.png    (public)
  - POST /api/billing/upi/submit       (public) — success / unregistered email / short UTR
  - GET /api/billing/upi/submissions   (admin, X-Admin-Key)
  - POST /api/billing/upi/submissions/{id}/confirm  (admin) -> flips user.is_pro=True
  - POST /api/billing/upi/submissions/{id}/reject   (admin) -> leaves is_pro untouched

Uses the existing registered test account (voicetest2026@example.com, see
/app/memory/test_credentials.md) for the success/confirm/reject cases.
Every test submission created here is deleted, and the test account's
is_pro flag is reset back to False, in a module-scoped teardown fixture.
"""
import os
import pymongo
import pytest
import requests
from dotenv import dotenv_values

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend/.env directly (same env the mobile app uses)
    fe_env = dotenv_values("/app/frontend/.env")
    BASE_URL = fe_env.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

TEST_EMAIL = "voicetest2026@example.com"  # registered test account

_be_env = dotenv_values("/app/backend/.env")
ADMIN_KEY = _be_env.get("ADMIN_KEY")
MONGO_URL = _be_env.get("MONGO_URL")
DB_NAME = _be_env.get("DB_NAME")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo_db():
    client = pymongo.MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module", autouse=True)
def cleanup_after_module(mongo_db):
    """Delete any TEST submissions created for TEST_EMAIL during this run and
    reset is_pro back to False on the test account, regardless of test outcome."""
    yield
    mongo_db.upi_payment_submissions.delete_many({"email": TEST_EMAIL, "utr": {"$regex": "^PYTESTUTR"}})
    mongo_db.users.update_one(
        {"email": TEST_EMAIL},
        {"$set": {"is_pro": False}, "$unset": {"pro_provider": "", "pro_since": "", "pro_payment_ref": ""}},
    )


class TestUpiConfig:
    def test_config_returns_configured_true(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/billing/upi/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["vpa"] is not None and isinstance(data["vpa"], str) and len(data["vpa"]) > 0
        assert data["payee_name"]
        assert data["amount_label"]
        assert data["upi_uri"] and data["upi_uri"].startswith("upi://pay?")

    def test_qrcode_png(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/billing/upi/qrcode.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


class TestUpiSubmit:
    def test_submit_success_registered_email(self, api_client, mongo_db):
        payload = {"email": TEST_EMAIL, "utr": "PYTESTUTR000001"}
        resp = api_client.post(f"{BASE_URL}/api/billing/upi/submit", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["submission_id"]
        # verify persisted
        sub = mongo_db.upi_payment_submissions.find_one({"id": data["submission_id"]})
        assert sub is not None
        assert sub["email"] == TEST_EMAIL
        assert sub["status"] == "pending"

    def test_submit_unregistered_email(self, api_client):
        payload = {"email": "TEST_no_such_upi_user_zzz@example.com", "utr": "PYTESTUTR000002"}
        resp = api_client.post(f"{BASE_URL}/api/billing/upi/submit", json=payload)
        assert resp.status_code == 404
        assert "no dhara account" in resp.json()["detail"].lower()

    def test_submit_utr_too_short(self, api_client):
        payload = {"email": TEST_EMAIL, "utr": "abc"}
        resp = api_client.post(f"{BASE_URL}/api/billing/upi/submit", json=payload)
        assert resp.status_code == 400


class TestUpiAdmin:
    def test_submissions_requires_admin_key(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/billing/upi/submissions")
        assert resp.status_code in (401, 403)

    def test_submissions_wrong_key_rejected(self, api_client):
        resp = api_client.get(
            f"{BASE_URL}/api/billing/upi/submissions", headers={"X-Admin-Key": "definitely-wrong-key"}
        )
        assert resp.status_code in (401, 403)

    @pytest.mark.skipif(not ADMIN_KEY, reason="ADMIN_KEY not available in backend/.env")
    def test_submissions_list_with_correct_key(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/billing/upi/submissions", headers={"X-Admin-Key": ADMIN_KEY})
        assert resp.status_code == 200
        data = resp.json()
        assert "submissions" in data and isinstance(data["submissions"], list)

    @pytest.mark.skipif(not ADMIN_KEY, reason="ADMIN_KEY not available in backend/.env")
    def test_confirm_sets_is_pro_true(self, api_client, mongo_db):
        # create a fresh submission to confirm
        payload = {"email": TEST_EMAIL, "utr": "PYTESTUTR000003"}
        create_resp = api_client.post(f"{BASE_URL}/api/billing/upi/submit", json=payload)
        sub_id = create_resp.json()["submission_id"]

        confirm_resp = api_client.post(
            f"{BASE_URL}/api/billing/upi/submissions/{sub_id}/confirm",
            headers={"X-Admin-Key": ADMIN_KEY},
        )
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["ok"] is True

        # verify in Mongo
        sub = mongo_db.upi_payment_submissions.find_one({"id": sub_id})
        assert sub["status"] == "confirmed"
        user = mongo_db.users.find_one({"email": TEST_EMAIL})
        assert user["is_pro"] is True
        assert user["pro_provider"] == "upi"

    @pytest.mark.skipif(not ADMIN_KEY, reason="ADMIN_KEY not available in backend/.env")
    def test_reject_does_not_touch_is_pro(self, api_client, mongo_db):
        # reset is_pro to False first to isolate this test's assertion
        mongo_db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_pro": False}})

        payload = {"email": TEST_EMAIL, "utr": "PYTESTUTR000004"}
        create_resp = api_client.post(f"{BASE_URL}/api/billing/upi/submit", json=payload)
        sub_id = create_resp.json()["submission_id"]

        reject_resp = api_client.post(
            f"{BASE_URL}/api/billing/upi/submissions/{sub_id}/reject",
            headers={"X-Admin-Key": ADMIN_KEY},
        )
        assert reject_resp.status_code == 200

        sub = mongo_db.upi_payment_submissions.find_one({"id": sub_id})
        assert sub["status"] == "rejected"
        user = mongo_db.users.find_one({"email": TEST_EMAIL})
        assert user["is_pro"] is False
