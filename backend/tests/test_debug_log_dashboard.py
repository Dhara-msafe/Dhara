"""
Tests for the Debug Log Dashboard feature:
  - GET /api/admin/logs (HTML dashboard)
  - GET /api/admin/logs/data (JSON data)
  - GET /api/admin/logs/export (CSV export)
  - Auth: correct key / wrong key / no key
  - Logging: health requests appear in logs, admin routes NOT logged
  - Scrubber: password/token keys are redacted
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
ADMIN_KEY = "gz9cap1QPTVbzeHjHKpxhlykJQxJfr64kcrDwJL3BkE"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── Auth Tests ────────────────────────────────────────────────────────────────

class TestDashboardAuth:
    """Authentication checks for dashboard routes"""

    def test_dashboard_no_key_returns_403(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs")
        assert r.status_code == 403, f"Expected 403, got {r.status_code}"
        print("PASS: no key → 403")

    def test_dashboard_wrong_key_returns_403(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs?key=wrongkey")
        assert r.status_code == 403, f"Expected 403, got {r.status_code}"
        print("PASS: wrong key → 403")

    def test_dashboard_correct_key_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs?key={ADMIN_KEY}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        assert "text/html" in r.headers.get("content-type", "")
        print("PASS: correct key → 200 HTML")

    def test_data_no_key_returns_403(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/data")
        assert r.status_code == 403
        print("PASS: data no key → 403")

    def test_data_wrong_key_returns_403(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/data?key=bad")
        assert r.status_code == 403
        print("PASS: data wrong key → 403")

    def test_export_no_key_returns_403(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/export")
        assert r.status_code == 403
        print("PASS: export no key → 403")


# ── Data API Tests ────────────────────────────────────────────────────────────

class TestLogsData:
    """JSON data endpoint tests"""

    def test_data_returns_json_with_logs_array(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "logs" in data, "Response missing 'logs' key"
        assert "count" in data, "Response missing 'count' key"
        assert isinstance(data["logs"], list), "'logs' should be a list"
        assert data["count"] == len(data["logs"]), "count mismatch"
        print(f"PASS: data returns JSON with {data['count']} logs")

    def test_health_requests_appear_in_logs(self, session):
        """Make a health request then verify it appears in logs"""
        # Make several health requests to ensure they're logged
        for _ in range(3):
            session.get(f"{BASE_URL}/api/health")
        time.sleep(2)  # Allow async task to write to MongoDB

        r = session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}&path_prefix=/api/health")
        assert r.status_code == 200
        data = r.json()
        assert data["count"] > 0, "Health requests not found in logs"
        # Verify the entry has expected fields
        entry = data["logs"][0]
        assert entry.get("method") in ("GET", "POST", "PUT", "DELETE", "PATCH")
        assert "/api/health" in entry.get("full_path", entry.get("path", ""))
        print(f"PASS: health requests logged ({data['count']} found)")

    def test_admin_logs_not_in_logs(self, session):
        """Dashboard's own requests must NOT appear in the logs"""
        # Trigger a few dashboard requests
        for _ in range(3):
            session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}")
        time.sleep(1)

        r = session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}&path_prefix=/api/admin/logs")
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0, f"Admin logs should not be in debug_logs, found {data['count']}"
        print("PASS: admin/logs routes not logged (no circular spam)")

    def test_errors_tab_returns_only_4xx_5xx(self, session):
        """Trigger a 404 and ensure it shows under errors tab"""
        session.get(f"{BASE_URL}/api/this-route-does-not-exist-xyz")
        time.sleep(2)

        r = session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}&tab=errors")
        assert r.status_code == 200
        data = r.json()
        # All returned entries must be 4xx or 5xx
        for entry in data["logs"]:
            st = entry.get("status", 0)
            assert st >= 400, f"Non-error status {st} found in errors tab"
        print(f"PASS: errors tab returns only 4xx/5xx ({data['count']} entries)")

    def test_no_id_field_in_response(self, session):
        """MongoDB _id must not be exposed"""
        r = session.get(f"{BASE_URL}/api/admin/logs/data?key={ADMIN_KEY}")
        data = r.json()
        for entry in data["logs"][:5]:
            assert "_id" not in entry, f"MongoDB _id leaked in response: {entry}"
        print("PASS: _id not exposed in log entries")


# ── CSV Export Tests ──────────────────────────────────────────────────────────

class TestLogsExport:
    """CSV export endpoint tests"""

    def test_export_returns_csv_content_type(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/export?key={ADMIN_KEY}")
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct, f"Expected text/csv, got {ct}"
        print("PASS: export returns text/csv")

    def test_export_has_correct_headers(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/export?key={ADMIN_KEY}")
        assert r.status_code == 200
        lines = r.text.strip().split("\n")
        assert len(lines) >= 1, "CSV is empty"
        header_line = lines[0]
        expected_cols = ["ts", "user_id", "user_email", "method", "full_path",
                         "status", "duration_ms", "req_body", "res_body",
                         "error_msg", "stack_trace"]
        for col in expected_cols:
            assert col in header_line, f"Missing column '{col}' in CSV header: {header_line}"
        print(f"PASS: CSV has all required headers")

    def test_export_content_disposition(self, session):
        r = session.get(f"{BASE_URL}/api/admin/logs/export?key={ADMIN_KEY}")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd, f"Missing attachment in Content-Disposition: {cd}"
        assert ".csv" in cd, f"Missing .csv in Content-Disposition: {cd}"
        print(f"PASS: Content-Disposition set correctly: {cd}")


# ── Log Scrubber Tests ────────────────────────────────────────────────────────

class TestLogScrubber:
    """Test that the log scrubber works correctly"""

    def test_scrubber_redacts_password_key(self):
        """Unit-style test via importing the scrubber directly"""
        import sys
        sys.path.insert(0, "/app/backend")
        from services.log_scrubber import scrub

        payload = {"username": "alice", "password": "secret123", "data": "safe"}
        result = scrub(payload)
        assert result["password"] == "[redacted]", f"password not redacted: {result}"
        assert result["username"] == "alice", f"username should not be redacted"
        assert result["data"] == "safe", f"data should not be redacted"
        print("PASS: scrubber redacts 'password' key")

    def test_scrubber_redacts_token_key(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.log_scrubber import scrub

        payload = {"access_token": "jwt.abc.def", "user": "bob"}
        result = scrub(payload)
        assert result["access_token"] == "[redacted]", f"token not redacted: {result}"
        assert result["user"] == "bob"
        print("PASS: scrubber redacts 'token' key")

    def test_scrubber_keeps_safe_keys(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.log_scrubber import scrub

        payload = {"name": "Alice", "email": "alice@test.com", "age": 30}
        result = scrub(payload)
        assert result == payload, f"Safe keys were modified: {result}"
        print("PASS: scrubber keeps safe keys intact")

    def test_scrubber_handles_nested_dicts(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.log_scrubber import scrub

        payload = {"user": {"password": "p@ss", "name": "Alice"}, "count": 1}
        result = scrub(payload)
        assert result["user"]["password"] == "[redacted]"
        assert result["user"]["name"] == "Alice"
        assert result["count"] == 1
        print("PASS: scrubber handles nested dicts")
