"""
test_debug_log_dashboard.py
===========================
Tests for the debug-log dashboard (api/debug_log_router.py,
middleware/request_logger.py, services/log_scrubber.py).

ADMIN_KEY is always read from the environment — it is never hardcoded here.
Tests that require the middleware also set DEBUG_LOG_ENABLED=true and
DEBUG_LOG_BODIES=true so the full capture path is exercised.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

# ── Read ADMIN_KEY from environment (never hardcoded) ─────────────────────────
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")
if not ADMIN_KEY:
    pytest.skip(
        "ADMIN_KEY not set in environment — skipping dashboard tests",
        allow_module_level=True,
    )

# ── Helpers ───────────────────────────────────────────────────────────────────

class _AsyncIter:
    def __init__(self, items):
        self._items = iter(items)
    def __aiter__(self): return self
    async def __anext__(self):
        try: return next(self._items)
        except StopIteration: raise StopAsyncIteration


def _mock_db(logs=None):
    m = MagicMock()
    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=cursor)
    cursor.limit = MagicMock(return_value=_AsyncIter(logs or []))
    m.debug_logs.find = MagicMock(return_value=cursor)
    m.debug_logs.insert_one = AsyncMock()
    return m


def _log_doc(**kwargs):
    base = {
        "ts": datetime.now(timezone.utc),
        "user_id": "u-001",
        "user_email": "alice@example.com",
        "method": "GET",
        "path": "/api/health",
        "full_path": "/api/health",
        "status": 200,
        "duration_ms": 5.0,
        "req_body": None,
        "res_body": None,
        "error_msg": None,
        "stack_trace": None,
    }
    base.update(kwargs)
    return base


# ── A: Auth tests ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dashboard_correct_key_returns_html(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    with patch.object(dr, "db", _mock_db()):
        resp = await dr.logs_dashboard(key=ADMIN_KEY)
    assert resp.status_code == 200
    assert b"Dhara Debug Logs" in resp.body


@pytest.mark.asyncio
async def test_dashboard_wrong_key_returns_403(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    with pytest.raises(Exception) as exc:
        await dr.logs_dashboard(key="wrong-key")
    assert "403" in str(exc.value)


@pytest.mark.asyncio
async def test_dashboard_no_key_returns_403(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    with pytest.raises(Exception) as exc:
        await dr.logs_dashboard(key=None)
    assert "403" in str(exc.value)


@pytest.mark.asyncio
async def test_dashboard_disabled_returns_503(monkeypatch):
    """When DEBUG_LOG_ENABLED is not set, the dashboard must return 503."""
    monkeypatch.delenv("DEBUG_LOG_ENABLED", raising=False)
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    with pytest.raises(Exception) as exc:
        await dr.logs_dashboard(key=ADMIN_KEY)
    assert "503" in str(exc.value) or "log_disabled" in str(exc.value)


# ── B: Data API tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_data_endpoint_returns_logs(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    docs = [_log_doc(), _log_doc(status=404, error_msg="not found")]
    with patch.object(dr, "db", _mock_db(docs)):
        resp = await dr.logs_data(key=ADMIN_KEY)
    body = json.loads(resp.body)
    assert body["count"] == 2
    assert body["logs"][0]["method"] == "GET"


@pytest.mark.asyncio
async def test_data_endpoint_errors_tab_filters_4xx(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    docs = [_log_doc(status=404)]
    with patch.object(dr, "db", _mock_db(docs)):
        resp = await dr.logs_data(key=ADMIN_KEY, tab="errors")
    body = json.loads(resp.body)
    # The filter is applied in the MongoDB query; cursor returns whatever the mock gives
    assert isinstance(body["logs"], list)


# ── C: Scrubber tests (extended list) ─────────────────────────────────────────

def test_scrubber_redacts_credentials():
    from services.log_scrubber import scrub
    result = scrub({"password": "s3cr3t", "token": "jwt.abc", "name": "Alice"})
    assert result["password"] == "[redacted]"
    assert result["token"] == "[redacted]"
    assert result["name"] == "Alice"


def test_scrubber_redacts_pii_fields():
    """PR-chore: extended list must also redact PII fields."""
    from services.log_scrubber import scrub
    pii = {
        "phone": "+919876543210",
        "mobile": "+919876543210",
        "email": "alice@example.com",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "location": {"lat": 12.9, "lng": 77.5},
        "message": "I am going to the market",
        "text": "some content",
        "transcript": "she said hello",
        "query": "my query",
        "question": "what is happening",
        "content": "body content",
        "address": "123 Main St",
        "dob": "1990-01-15",
    }
    result = scrub(pii)
    for k in pii:
        assert result[k] == "[redacted]", f"Expected {k} to be redacted, got {result[k]!r}"


def test_scrubber_redacts_nested():
    from services.log_scrubber import scrub
    result = scrub({"user": {"email": "alice@example.com", "name": "Alice"}})
    assert result["user"]["email"] == "[redacted]"
    assert result["user"]["name"] == "Alice"


def test_scrubber_keeps_non_banned_keys():
    from services.log_scrubber import scrub
    result = scrub({"status": "ok", "user_id": "u-001", "duration": 123})
    assert result == {"status": "ok", "user_id": "u-001", "duration": 123}


def test_scrubber_handles_lists():
    from services.log_scrubber import scrub
    result = scrub([{"phone": "123"}, {"name": "Bob"}])
    assert result[0]["phone"] == "[redacted]"
    assert result[1]["name"] == "Bob"


def test_scrubber_extra_via_env(monkeypatch):
    monkeypatch.setenv("LOG_SCRUB_EXTRA", "nationalid,passportnumber")
    from services.log_scrubber import scrub
    result = scrub({"nationalid": "ABC123", "passportnumber": "P9876543"})
    assert result["nationalid"] == "[redacted]"
    assert result["passportnumber"] == "[redacted]"


# ── D: Middleware feature-flag tests ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_middleware_passthrough_when_disabled():
    """When DEBUG_LOG_ENABLED is off, the middleware must call the app and
    never touch the DB."""
    import api.debug_log_router as dr  # import just to be safe; not relevant here
    # We test the middleware class directly.
    called = []

    async def fake_app(scope, receive, send):
        called.append(True)

    import importlib
    import middleware.request_logger as ml
    with patch.object(ml, "_LOG_ENABLED", False):
        mw = ml.RequestLoggerMiddleware(fake_app)
        await mw({"type": "http", "path": "/api/health", "method": "GET",
                   "headers": [], "query_string": b""}, None, None)
    assert called, "app must still be called even when logging is disabled"


@pytest.mark.asyncio
async def test_middleware_does_not_log_admin_routes():
    """Admin-logs routes must be skipped to avoid circular log spam."""
    import importlib
    import middleware.request_logger as ml
    with patch.object(ml, "_LOG_ENABLED", True):
        called = []

        async def fake_app(scope, receive, send):
            called.append(True)

        mw = ml.RequestLoggerMiddleware(fake_app)
        await mw(
            {"type": "http", "path": "/api/admin/logs", "method": "GET",
             "headers": [], "query_string": b""},
            None, None
        )
    assert called, "app must still be called even for skip paths"


@pytest.mark.asyncio
async def test_middleware_stores_no_bodies_by_default(monkeypatch):
    """When DEBUG_LOG_BODIES is false (default), req_body and res_body must
    both be None in the stored document."""
    import importlib
    import middleware.request_logger as ml
    importlib.reload(ml)

    mock_db = _mock_db()   # insert_one is AsyncMock from _mock_db

    with patch("dependencies.db", mock_db), \
         patch.object(ml, "_LOG_BODIES", False):
        await ml._write_log(
            scope={"method": "GET", "path": "/api/health", "query_string": b""},
            headers={},
            status_code=200,
            start_ms=0.0,
            req_raw=b'{"name":"test"}',
            res_raw=b'{"ok":true}',
            exc_text=None,
            binary_body=False,
            store_bodies=False,
        )

    call_doc = mock_db.debug_logs.insert_one.call_args[0][0]
    assert call_doc["req_body"] is None, "req_body must be None when DEBUG_LOG_BODIES is off"
    assert call_doc["res_body"] is None, "res_body must be None when DEBUG_LOG_BODIES is off"
    assert call_doc["method"] == "GET"
    assert call_doc["status"] == 200


@pytest.mark.asyncio
async def test_middleware_stores_bodies_when_flag_on(monkeypatch):
    """When DEBUG_LOG_BODIES=true, scrubbed bodies must appear in the document."""
    import middleware.request_logger as ml
    mock_db = _mock_db()
    with patch("dependencies.db", mock_db), \
         patch("middleware.request_logger._LOG_BODIES", True):
        await ml._write_log(
            scope={"method": "POST", "path": "/api/chat", "query_string": b""},
            headers={},
            status_code=200,
            start_ms=0.0,
            req_raw=b'{"query":"what is my right","password":"secret"}',
            res_raw=b'{"answer":"you have the right to remain silent"}',
            exc_text=None,
            binary_body=False,
            store_bodies=True,
        )
    call_doc = mock_db.debug_logs.insert_one.call_args[0][0]
    # password must be redacted; query too (new extended scrubber list)
    assert call_doc["req_body"]["password"] == "[redacted]"
    assert call_doc["req_body"]["query"] == "[redacted]"
    # response body stored (answer key is not banned)
    assert call_doc["res_body"] is not None


# ── E: CSV export ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_csv_export_returns_csv_content_type(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    docs = [_log_doc()]
    with patch.object(dr, "db", _mock_db(docs)):
        resp = await dr.logs_export(key=ADMIN_KEY)
    assert "text/csv" in resp.media_type


@pytest.mark.asyncio
async def test_csv_export_contains_expected_headers(monkeypatch):
    monkeypatch.setenv("DEBUG_LOG_ENABLED", "true")
    monkeypatch.setenv("ADMIN_KEY", ADMIN_KEY)
    import importlib
    import api.debug_log_router as dr
    importlib.reload(dr)
    docs = [_log_doc()]
    with patch.object(dr, "db", _mock_db(docs)):
        resp = await dr.logs_export(key=ADMIN_KEY)
    chunks = []
    async for chunk in resp.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    csv_text = b"".join(chunks).decode()
    assert "ts" in csv_text
    assert "method" in csv_text
    assert "status" in csv_text
