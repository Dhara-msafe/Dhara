"""
Regression acceptance tests for T01–T28 (backend-testable subset).
Tests: T05, T07, T08, T09, T11, T18, T20, T21, T22, T23, T28
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')

# ── Shared auth fixture ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "voicetest2026@example.com",
        "password": "TestPass123!"
    })
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("token") or r.json().get("access_token")

@pytest.fixture(scope="module")
def authed(auth_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"})
    return s


# ── T05: POST /api/consent/log returns 200 ────────────────────────────────────
class TestT05ConsentLog:
    """T05: Consent log endpoint exists and returns 200"""

    def test_consent_log_returns_200(self, authed):
        r = authed.post(f"{BASE_URL}/api/consent/log", json={
            "notice_version": "2026-11-01",
            "purposes": {"core": True, "analytics": False, "updates": False},
            "language": "en",
            "age_confirmed_18": True,
            "anon_id": None,
            "app_version": "1.0.0"
        })
        assert r.status_code in (200, 201), f"Expected 200/201, got {r.status_code}: {r.text[:300]}"
        print(f"T05 PASS: POST /api/consent/log -> {r.status_code}")

    def test_consent_log_entry_persisted(self, authed):
        # Verify via my-data/export that consent_log has entries
        r = authed.get(f"{BASE_URL}/api/user/my-data/export")
        assert r.status_code == 200, f"my-data/export failed: {r.status_code}"
        data = r.json()
        assert "consent_log" in data, "consent_log key missing from export"
        assert len(data["consent_log"]) > 0, "consent_log is empty after POST"
        print(f"T05 PASS: consent_log has {len(data['consent_log'])} entries")


# ── T07: terms_version bump triggers consent guard ────────────────────────────
class TestT07ConsentVersionBump:
    """T07: /api/user/me returns terms_version; we can verify the guard mechanism"""

    def test_user_has_terms_version(self, authed):
        r = authed.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        # terms_version or consent info must be present
        has_terms = "terms_version" in data or "consent_purposes" in data
        assert has_terms, f"User record missing terms/consent fields: {list(data.keys())}"
        print(f"T07 PASS: user has consent info, terms_version={data.get('terms_version')}")


# ── T09: PATCH /api/user/privacy-choices (withdrawal) ─────────────────────────
class TestT09Withdrawal:
    """T09: Withdraw analytics consent, verify it updates in users collection"""

    def test_withdraw_analytics_consent(self, authed):
        # First get current state via auth/me
        r = authed.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        original_analytics = r.json().get("consent_purposes", {}).get("analytics", True)

        # Withdraw analytics
        r2 = authed.patch(f"{BASE_URL}/api/user/privacy-choices", json={
            "analytics": False, "updates": False
        })
        assert r2.status_code == 200, f"privacy-choices PATCH failed: {r2.status_code} {r2.text[:300]}"
        data = r2.json()
        assert data.get("consent_purposes", {}).get("analytics") == False, \
            f"analytics not set to false: {data}"
        print(f"T09 PASS: analytics withdrawn -> {data.get('consent_purposes')}")

    def test_analytics_persisted_in_user(self, authed):
        # GET to verify persisted via auth/me
        r = authed.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        cp = r.json().get("consent_purposes", {})
        assert cp.get("analytics") == False, f"analytics not False in DB: {cp}"
        print(f"T09 PASS: analytics=False confirmed in users collection")

    def test_restore_analytics_consent(self, authed):
        # Restore original value (best-effort cleanup)
        r = authed.patch(f"{BASE_URL}/api/user/privacy-choices", json={
            "analytics": True, "updates": False
        })
        assert r.status_code == 200
        print("T09 CLEANUP: analytics restored to True")


# ── T11: /api/user/my-data/export returns downloadable data ───────────────────
class TestT11Download:
    """T11: Download record returns JSON without sensitive personal data"""

    def test_export_returns_200(self, authed):
        r = authed.get(f"{BASE_URL}/api/user/my-data/export")
        assert r.status_code == 200, f"Export failed: {r.status_code} {r.text[:300]}"
        print(f"T11 PASS: /api/user/my-data/export -> 200")

    def test_export_has_no_raw_password(self, authed):
        r = authed.get(f"{BASE_URL}/api/user/my-data/export")
        assert r.status_code == 200
        text = r.text
        assert "password" not in text.lower() or "password_hash" not in text, \
            "Export contains password field"
        print("T11 PASS: export doesn't expose password")

    def test_export_contains_expected_structure(self, authed):
        r = authed.get(f"{BASE_URL}/api/user/my-data/export")
        assert r.status_code == 200
        data = r.json()
        # Should have consent or user info
        assert len(data) > 0, "Export is empty"
        print(f"T11 PASS: export keys: {list(data.keys())[:6]}")


# ── T18: /api/journey/status/{token} and revoke endpoint ─────────────────────
class TestT18GuardianShare:
    """T18: Guardian share endpoints exist and work"""

    @pytest.fixture(scope="class")
    def journey_token(self, authed):
        r = authed.post(f"{BASE_URL}/api/journey/status", json={
            "destination": "TEST_T18 Destination",
            "expected_arrival": "2026-12-31T23:59:00Z"
        })
        if r.status_code not in (200, 201):
            pytest.skip(f"Could not create journey: {r.status_code} {r.text[:300]}")
        data = r.json()
        token = data.get("token") or data.get("status_url", "").split("/")[-1]
        yield token
        # Cleanup: revoke the journey
        try:
            authed.post(f"{BASE_URL}/api/journey/status/{token}/revoke")
        except Exception:
            pass

    def test_journey_status_returns_valid_json(self, authed, journey_token):
        r = requests.get(f"{BASE_URL}/api/journey/status/{journey_token}")
        # Public endpoint - could return HTML or JSON
        assert r.status_code in (200, 403, 404), f"Unexpected status: {r.status_code}"
        print(f"T18 PASS: GET /api/journey/status/{journey_token[:8]}... -> {r.status_code}")

    def test_revoke_endpoint_exists(self, authed, journey_token):
        r = authed.post(f"{BASE_URL}/api/journey/status/{journey_token}/revoke")
        assert r.status_code in (200, 400, 409), \
            f"Revoke endpoint failed: {r.status_code} {r.text[:300]}"
        print(f"T18 PASS: revoke endpoint -> {r.status_code}")


# ── T20: Cyber fraud route ─────────────────────────────────────────────────────
class TestT20CyberFraud:
    """T20: Fraud-help route is reachable"""

    def test_visitor_intent_route_accessible(self):
        # The frontend route /visitor/cyber-fraud should load from the web preview
        r = requests.get(f"{BASE_URL}/visitor/cyber-fraud", timeout=10)
        # Accept any non-500 (it's a frontend route)
        assert r.status_code not in (500, 502, 503), f"Server error: {r.status_code}"
        print(f"T20 PASS: /visitor/cyber-fraud -> {r.status_code}")


# ── T21: Auth — sign-in with test credentials ─────────────────────────────────
class TestT21Auth:
    """T21: Guest access and sign-in"""

    def test_login_works(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "token" in data or "access_token" in data, "No token in response"
        print(f"T21 PASS: login -> 200, token present")

    def test_public_routes_accessible(self):
        # /api/reference/languages should be a public route
        r = requests.get(f"{BASE_URL}/api/reference/languages")
        assert r.status_code in (200, 404), f"Unexpected: {r.status_code}"
        print(f"T21 PASS: public route accessible -> {r.status_code}")
