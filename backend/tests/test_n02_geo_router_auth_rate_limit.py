"""N-02 (B-40): geo_router endpoints (autocomplete, details, nearby,
search-text, directions) must require an authenticated session and be
rate-limited per-user and per-IP, since they proxy a paid, server-keyed
Google API. Also guards the adjacent bug found while fixing this: a
previously-undefined `NominatimFallbackProvider()` call that silently
NameError'd (masked by a broad except) instead of the module's own
documented "fail closed" design.

These are local unit tests against the route functions and the rate-limit
helper directly, with a fake in-memory Mongo-like collection standing in for
`dependencies.db` — no live server/Mongo needed (unlike the live-integration
style tests elsewhere in this suite for P0/P1 Day 1 items).
"""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import geo_router  # noqa: E402

SRC = (Path(__file__).resolve().parent.parent / "api" / "geo_router.py").read_text(encoding="utf-8")

_ROUTE_KINDS = [
    ("geo_autocomplete", "autocomplete"),
    ("geo_details", "details"),
    ("geo_nearby", "nearby"),
    ("geo_search_text", "search_text"),
    ("geo_directions", "directions"),
]


def _function_slice(name: str, size: int = 1600) -> str:
    start = SRC.index(f"async def {name}(")
    return SRC[start:start + size]


# ── Source-wiring: every route requires auth and checks the rate limit first ─

@pytest.mark.parametrize("fn_name, kind", _ROUTE_KINDS)
def test_route_requires_current_user(fn_name, kind):
    sig_end = SRC.index("):", SRC.index(f"async def {fn_name}("))
    sig = SRC[SRC.index(f"async def {fn_name}("):sig_end]
    assert "Depends(current_user)" in sig, f"{fn_name} must require current_user"


@pytest.mark.parametrize("fn_name, kind", _ROUTE_KINDS)
def test_route_checks_rate_limit(fn_name, kind):
    body = _function_slice(fn_name)
    assert f'_check_geo_rate_limit("{kind}"' in body, f"{fn_name} must call the {kind} rate limit check"


def test_no_dangling_nominatim_fallback_reference():
    """Regression guard, narrowed after the emergent-workspace-9/11 merge:
    geo_autocomplete's "no provider configured" branch must fail closed
    (503) and must NOT call NominatimFallbackProvider() — that was the
    original dead/undefined-class NameError this fix caught, silently
    masked by a broad `except Exception`.

    NominatimFallbackProvider is no longer dead code workspace-wide: the
    merged geo_router.py defines the class for real and geo_details()
    legitimately calls it for an explicit provider="osm" place_id lookup
    (a self-describing token, no network call). That is a different,
    intentional code path, so this guard only checks geo_autocomplete's
    own provider-unconfigured branch, not the whole file.
    """
    body = _function_slice("geo_autocomplete", size=2000)
    # Isolate just the "provider is None" branch (up to the next top-level
    # `try:` that starts the real-provider call), so a legitimate reference
    # elsewhere in the file (or later in this same function) can't hide a
    # regression of the original bug.
    branch_start = body.index("if provider is None:")
    branch_end = body.index("try:", branch_start)
    branch = body[branch_start:branch_end]
    live_lines = [ln for ln in branch.splitlines() if not ln.strip().startswith("#")]
    assert "NominatimFallbackProvider(" not in "\n".join(live_lines)
    assert "raise HTTPException(503" in branch


# ── Fake Mongo-like collection standing in for dependencies.db.usage_daily ──

class _FakeCollection:
    def __init__(self):
        self._docs: dict[tuple, dict] = {}

    async def find_one_and_update(self, filter_, update, upsert=False, return_document=None):
        key = tuple(sorted(filter_.items()))
        doc = dict(self._docs.get(key, dict(filter_)))
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        self._docs[key] = doc
        return dict(doc)


class _FakeDB:
    def __init__(self):
        self.usage_daily = _FakeCollection()


@pytest.fixture
def fake_db(monkeypatch):
    fdb = _FakeDB()
    monkeypatch.setattr(geo_router, "db", fdb)
    return fdb


# ── Rate-limit behavior ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_under_cap_passes(fake_db):
    for _ in range(5):
        await geo_router._check_geo_rate_limit("autocomplete", "user-1", "1.2.3.4")


@pytest.mark.asyncio
async def test_over_user_cap_is_blocked(fake_db, monkeypatch):
    monkeypatch.setitem(geo_router._GEO_USER_DAILY_LIMIT, "details", 2)
    await geo_router._check_geo_rate_limit("details", "user-2", "5.6.7.8")
    await geo_router._check_geo_rate_limit("details", "user-2", "5.6.7.8")
    with pytest.raises(HTTPException) as exc:
        await geo_router._check_geo_rate_limit("details", "user-2", "5.6.7.8")
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_different_user_same_kind_is_not_blocked_by_someone_elses_count(fake_db, monkeypatch):
    monkeypatch.setitem(geo_router._GEO_USER_DAILY_LIMIT, "details", 1)
    await geo_router._check_geo_rate_limit("details", "user-3", "1.1.1.1")
    # A different user, different IP, must not inherit user-3's count.
    await geo_router._check_geo_rate_limit("details", "user-4", "2.2.2.2")


@pytest.mark.asyncio
async def test_exhausting_one_kind_does_not_block_another_kind_for_same_user(fake_db, monkeypatch):
    monkeypatch.setitem(geo_router._GEO_USER_DAILY_LIMIT, "details", 1)
    await geo_router._check_geo_rate_limit("details", "user-5", "3.3.3.3")
    with pytest.raises(HTTPException):
        await geo_router._check_geo_rate_limit("details", "user-5", "3.3.3.3")
    # "directions" has its own counter — must still work for the same user/ip.
    await geo_router._check_geo_rate_limit("directions", "user-5", "3.3.3.3")


@pytest.mark.asyncio
async def test_over_ip_cap_blocks_even_across_different_users(fake_db, monkeypatch):
    """Defense-in-depth: many different accounts (e.g. guest-token farming)
    hitting the same network must still eventually get throttled."""
    monkeypatch.setattr(geo_router, "_GEO_IP_DAILY_LIMIT", 2)
    await geo_router._check_geo_rate_limit("autocomplete", "guest-a", "9.9.9.9")
    await geo_router._check_geo_rate_limit("autocomplete", "guest-b", "9.9.9.9")
    with pytest.raises(HTTPException) as exc:
        await geo_router._check_geo_rate_limit("autocomplete", "guest-c", "9.9.9.9")
    assert exc.value.status_code == 429


# ── Fail-closed behavior when the feature isn't configured ──────────────────

class _FakeRequest:
    class _Client:
        host = "127.0.0.1"
    client = _Client()


@pytest.mark.asyncio
async def test_autocomplete_fails_closed_with_consistent_message(fake_db, monkeypatch):
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_PLACES_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_PLACES_SERVER_KEY", "")
    with pytest.raises(HTTPException) as exc:
        await geo_router.geo_autocomplete(
            request=_FakeRequest(), input="connaught", session_token="abcdefgh",
            limit=6, lat=None, lng=None, user={"id": "u-1"},
        )
    assert exc.value.status_code == 503
    assert exc.value.detail == "Places autocomplete is not enabled"


@pytest.mark.asyncio
async def test_details_message_is_consistent_with_autocomplete(fake_db, monkeypatch):
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_PLACES_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_PLACES_SERVER_KEY", "")
    with pytest.raises(HTTPException) as exc:
        await geo_router.geo_details(
            request=_FakeRequest(), place_id="abc", session_token="abcdefgh",
            provider="google", user={"id": "u-1"},
        )
    assert exc.value.status_code == 503
    assert exc.value.detail == "Places autocomplete is not enabled"


@pytest.mark.asyncio
async def test_nearby_fails_closed_when_unconfigured(fake_db, monkeypatch):
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_PLACES_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_PLACES_SERVER_KEY", "")
    with pytest.raises(HTTPException) as exc:
        await geo_router.geo_nearby(
            request=_FakeRequest(), category="police", lat=28.6, lng=77.2,
            radius_meters=5000, user={"id": "u-1"},
        )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_search_text_fails_closed_when_unconfigured(fake_db, monkeypatch):
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_PLACES_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_PLACES_SERVER_KEY", "")
    with pytest.raises(HTTPException) as exc:
        await geo_router.geo_search_text(
            request=_FakeRequest(), query="connaught place", lat=None, lng=None,
            user={"id": "u-1"},
        )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_directions_still_returns_approximate_fallback_when_unconfigured(fake_db, monkeypatch):
    """Directions is the one endpoint that is deliberately fail-OPEN to an
    approximate straight-line estimate (an active safety journey must never
    go blank) — auth/rate-limit still apply, but a successful, authenticated,
    under-cap call must get a usable result, not an error."""
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_DIRECTIONS_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_DIRECTIONS_SERVER_KEY", "")
    result = await geo_router.geo_directions(
        request=_FakeRequest(), origin_lat=28.60, origin_lng=77.20,
        dest_lat=28.61, dest_lng=77.21, user={"id": "u-1"},
    )
    assert result["provider"] == "approximate"


@pytest.mark.asyncio
async def test_directions_still_enforces_rate_limit_when_unconfigured(fake_db, monkeypatch):
    """The fail-open fallback must not bypass the rate limit — it still runs
    _check_geo_rate_limit before computing the approximate route."""
    monkeypatch.setattr(geo_router, "FEATURE_GOOGLE_DIRECTIONS_V1", False)
    monkeypatch.setattr(geo_router, "GOOGLE_DIRECTIONS_SERVER_KEY", "")
    monkeypatch.setitem(geo_router._GEO_USER_DAILY_LIMIT, "directions", 1)
    await geo_router.geo_directions(
        request=_FakeRequest(), origin_lat=28.60, origin_lng=77.20,
        dest_lat=28.61, dest_lng=77.21, user={"id": "u-over"},
    )
    with pytest.raises(HTTPException) as exc:
        await geo_router.geo_directions(
            request=_FakeRequest(), origin_lat=28.60, origin_lng=77.20,
            dest_lat=28.61, dest_lng=77.21, user={"id": "u-over"},
        )
    assert exc.value.status_code == 429
