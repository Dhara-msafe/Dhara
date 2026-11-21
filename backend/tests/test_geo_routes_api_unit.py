"""Unit tests for the Routes API migration in geo_router (no server, no DB).

The rest of backend/tests are integration tests against a running backend;
this file is a pure unit test so the Routes API request/response handling
can be checked anywhere (CI container, VM, laptop). It stubs the
Emergent-only `emergentintegrations` package when it is not installed, and
monkeypatches httpx so no network is touched.
"""
from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path

import pytest

# ── Make `api.geo_router` importable without the Emergent runtime ────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if "emergentintegrations" not in sys.modules:  # present on the VM, absent elsewhere
    _ei = types.ModuleType("emergentintegrations")
    _llm = types.ModuleType("emergentintegrations.llm")
    _chat = types.ModuleType("emergentintegrations.llm.chat")
    _chat.LlmChat = object
    _chat.UserMessage = object
    sys.modules["emergentintegrations"] = _ei
    sys.modules["emergentintegrations.llm"] = _llm
    sys.modules["emergentintegrations.llm.chat"] = _chat

from api import geo_router  # noqa: E402


# ── Helpers ──────────────────────────────────────────────────────────────────
class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient; records the request it was given."""

    last_request = None  # (url, json_body, headers)

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeAsyncClient.last_request = (url, json, headers)
        return _FakeResponse(_FakeAsyncClient.payload)


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# polyline for [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]] — the
# worked example from Google's own polyline-algorithm documentation.
_DOC_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


# ── Tests ────────────────────────────────────────────────────────────────────
def test_google_route_parses_routes_api_answer(monkeypatch):
    _FakeAsyncClient.payload = {
        "routes": [{
            "distanceMeters": 1234,
            "duration": "347s",
            "polyline": {"encodedPolyline": _DOC_POLYLINE},
        }]
    }
    monkeypatch.setattr(geo_router.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(geo_router, "GOOGLE_DIRECTIONS_SERVER_KEY", "test-key")

    r = _run(geo_router._google_route(12.9, 77.6, 12.95, 77.65))

    assert r.provider == "google"
    assert r.distance_meters == 1234
    assert r.duration_seconds == 347
    assert r.polyline[0] == [38.5, -120.2]
    assert r.polyline[-1] == [43.252, -126.453]

    url, body, headers = _FakeAsyncClient.last_request
    assert url == geo_router.ROUTES_URL
    assert "routes.googleapis.com" in url                      # new API, not the legacy one
    assert body["travelMode"] == "WALK"
    assert body["origin"]["location"]["latLng"]["latitude"] == 12.9
    # Key travels in a header (never the URL), and the mandatory field mask is set.
    assert headers["X-Goog-Api-Key"] == "test-key"
    assert "routes.polyline.encodedPolyline" in headers["X-Goog-FieldMask"]


@pytest.mark.parametrize("payload", [
    {},                                             # no routes key at all
    {"routes": []},                                 # empty routes
    {"routes": [{"distanceMeters": 5}]},            # missing polyline/duration
    {"routes": [{"polyline": {"encodedPolyline": _DOC_POLYLINE}, "duration": "10s"}]},  # missing distance
])
def test_google_route_raises_on_bad_answer(monkeypatch, payload):
    _FakeAsyncClient.payload = payload
    monkeypatch.setattr(geo_router.httpx, "AsyncClient", _FakeAsyncClient)
    with pytest.raises(Exception):
        _run(geo_router._google_route(0.0, 0.0, 1.0, 1.0))


def test_approximate_fallback_shape_unchanged():
    r = geo_router._approximate_route(12.9, 77.6, 12.95, 77.65)
    assert r.provider == "approximate"
    assert r.polyline == [[12.9, 77.6], [12.95, 77.65]]
    assert r.distance_meters > 0
    assert r.duration_seconds > 0
