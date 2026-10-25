"""
test_guardian_http.py
In-process HTTP tests for GET /api/journey/{token}/guardian.

ISOLATION APPROACH
──────────────────
A minimal FastAPI application is constructed at module level.  Only the
journey_router is mounted; server.py is NOT imported.  The production
lifecycle — deadline_worker startup, MongoDB initialisation, all other route
handlers and CORS/middleware — is not triggered.

AUTHENTICATION
──────────────
dependencies.current_user is the real FastAPI dependency.  It is not
overridden, substituted or bypassed.  JWTs are constructed in-test using
the same JWT_SECRET and JWT_ALG read from config.settings.

STORAGE MOCKING
───────────────
db is patched at two namespaces per test:
  • dependencies.db         — used by current_user (user lookup)
  • api.journey_router.db   — used by _guardian_access_check

The mock is QUERY-AWARE: each collection's find_one evaluates the
Python-equivalent of the relevant predicates:
  users:                    {"id": uid}
  safety_journeys:          {"token": tok}
  trusted_circle_links:     {"id": {"$in": link_ids},
                             "invitee_user_id": uid, "status": "accepted"}

This confirms the application constructs correct predicates and that those
predicates discriminate correctly in Python.

LIMITATIONS
───────────
• Python predicate evaluation is NOT equivalent to MongoDB server-side
  execution; MongoDB type coercion, collation and index behaviour are not
  verified.
• JWT expiry, signature and structure are validated by the real PyJWT library
  at request time, not by mock.
• MongoDB connectivity, write paths, index behavior and concurrency are
  out of scope for this test file.
• No production environment, native device or deep-link behavior is verified.
"""
from __future__ import annotations

import sys
import os
import pytest
import jwt as pyjwt
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.routing import APIRouter
from httpx import AsyncClient, ASGITransport

# ── Path setup ────────────────────────────────────────────────────────────────
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

import api.journey_router as jr_module
from config.settings import JWT_SECRET, JWT_ALG

# ── Minimal test application ──────────────────────────────────────────────────
# Only the journey_router is mounted.  No production lifecycle is started.
_api = APIRouter(prefix="/api")
_api.include_router(jr_module.router)
_test_app = FastAPI()
_test_app.include_router(_api)

# ── Constants ─────────────────────────────────────────────────────────────────
_TOK        = "HTTPGUARD001"
_RECIP_ID   = "http-recip-001"
_OWNER_ID   = "http-owner-001"
_LINK_ID    = "http-link-001"
_OTHER_LID  = "http-othlink-001"   # accepted link NOT in this journey
_IMPOST_ID  = "http-impost-001"    # different authenticated identity
_UNREL_ID   = "http-unrel-001"     # no relationship with this traveller
_DEST       = "Victoria Terminus Gate 3, Mumbai"
_LAT, _LNG  = 18.938, 72.835

# ── JWT helpers ───────────────────────────────────────────────────────────────

def _jwt(uid: str, delta: timedelta = timedelta(days=7)) -> str:
    """Create a JWT signed with the production secret and algorithm."""
    payload = {"sub": uid, "exp": datetime.now(timezone.utc) + delta}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def _expired_jwt(uid: str) -> str:
    return _jwt(uid, timedelta(seconds=-60))

def _wrong_sig_jwt(uid: str) -> str:
    payload = {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return pyjwt.encode(payload, "WRONG_SECRET_XYZ_NOTREAL", algorithm=JWT_ALG)

# ── Record builders ───────────────────────────────────────────────────────────

def _user(uid: str) -> Dict[str, Any]:
    return {
        "id": uid, "email": f"{uid}@test.example",
        "name": "Test", "phone": "+910000000000",
        "language": "en", "is_pro": False,
        "is_grandfathered": True, "state": "",
        "state_jurisdiction": "", "terms_accepted": True,
    }

def _journey(
    status: str = "in_progress",
    expired: bool = False,
    revoked: bool = False,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "token":               _TOK,
        "user_id":             _OWNER_ID,
        "user_display":        "Priya",
        "destination":         _DEST,
        "started_at":          (now - timedelta(hours=1)).isoformat(),
        "expected_checkin_at": (now + timedelta(hours=1)).isoformat(),
        "expires_at":          (
            (now - timedelta(hours=2)).isoformat() if expired
            else (now + timedelta(hours=22)).isoformat()
        ),
        "status":              status,
        "safe_at":             (now - timedelta(minutes=5)).isoformat() if status == "safe" else None,
        "sharing_revoked_at":  (now - timedelta(minutes=5)).isoformat() if revoked else None,
        "recipient_link_ids":  [_LINK_ID],
        # Synthetic location data present in the stored record; used to confirm
        # the endpoint suppresses these fields rather than merely finding them absent.
        "last_location":       {"lat": _LAT, "lng": _LNG, "area": "CST", "accuracy": 12.0},
    }

def _link(
    uid:            str  = _RECIP_ID,
    link_id:        str  = _LINK_ID,
    status:         str  = "accepted",
    journey_status: bool = True,
    temp_location:  bool = False,
) -> Dict[str, Any]:
    return {
        "id":              link_id,
        "owner_id":        _OWNER_ID,
        "invitee_user_id": uid,
        "status":          status,
        "permissions": {
            "journey_status":    journey_status,
            "expected_arrival":  True,
            "missed_checkin":    True,
            "temp_location":     temp_location,
            "emergency_requests": True,
        },
    }

# ── Query-aware mock DB ───────────────────────────────────────────────────────

def _make_db(
    journey_rec:  Dict | None,
    links_store:  List[Dict],
    users_store:  Dict[str, Dict],
) -> MagicMock:
    """
    Build a query-aware mock database.

    Each find_one evaluates the Python equivalent of the query predicates
    sent by the application.  See module docstring for limitations.
    """
    mock_db = MagicMock()

    async def _users_find(query, *args, **kwargs):
        # current_user calls: db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        return users_store.get(query.get("id"))

    async def _journeys_find(query, *args, **kwargs):
        # _guardian_access_check calls: db.safety_journeys.find_one({"token": token})
        tok = query.get("token")
        if journey_rec and journey_rec.get("token") == tok:
            return journey_rec
        return None

    async def _links_find(query, *args, **kwargs):
        # _guardian_access_check calls:
        #   db.trusted_circle_links.find_one({
        #       "id":               {"$in": link_ids},
        #       "invitee_user_id":  user["id"],
        #       "status":           "accepted",
        #   })
        # Python evaluation of $in, equality on invitee_user_id and status.
        ids_in      = query.get("id", {}).get("$in", [])
        invitee_uid = query.get("invitee_user_id")
        status_req  = query.get("status")
        for lnk in links_store:
            if (
                lnk.get("id") in ids_in
                and lnk.get("invitee_user_id") == invitee_uid
                and lnk.get("status") == status_req
            ):
                return lnk
        return None

    mock_db.users.find_one                = _users_find
    mock_db.safety_journeys.find_one      = _journeys_find
    mock_db.trusted_circle_links.find_one = _links_find
    return mock_db


@contextmanager
def _patched_db(journey_rec, links_store, users_store):
    mock_db = _make_db(journey_rec, links_store, users_store)
    with patch("dependencies.db", mock_db), \
         patch("api.journey_router.db", mock_db):
        yield


async def _get(
    auth: str | None,
    journey_rec: Dict | None,
    links_store:  List[Dict],
    users_store:  Dict[str, Dict],
) -> Any:
    """Fire one GET request through the minimal in-process app."""
    headers = {} if auth is None else {"Authorization": auth}
    with _patched_db(journey_rec, links_store, users_store):
        async with AsyncClient(
            transport=ASGITransport(app=_test_app),
            base_url="http://test",
        ) as client:
            return await client.get(
                f"/api/journey/{_TOK}/guardian",
                headers=headers,
            )


# ══════════════════════════════════════════════════════════════════════════════
# 1.  Authentication — missing / invalid tokens
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_http1_missing_auth_header_401():
    """No Authorization header → current_user raises 401 before any DB query."""
    r = await _get(None, _journey(), [], {})
    assert r.status_code == 401
    # No journey metadata in error body
    assert "Priya" not in r.text
    assert _DEST  not in r.text


@pytest.mark.asyncio
async def test_http2_malformed_bearer_value_401():
    """Non-JWT string in Authorization → jwt.decode raises → 401."""
    r = await _get("Bearer THIS_IS_NOT_A_JWT", _journey(), [], {})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_http3_wrong_signature_jwt_401():
    """JWT structure is valid but signed with wrong secret → 401."""
    r = await _get(
        f"Bearer {_wrong_sig_jwt(_RECIP_ID)}",
        _journey(), [], {},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_http4_expired_jwt_401():
    """JWT with past 'exp' claim → PyJWT raises ExpiredSignatureError → 401."""
    r = await _get(
        f"Bearer {_expired_jwt(_RECIP_ID)}",
        _journey(), [], {},
    )
    assert r.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# 2.  Authorization — Gate A (identity × selection × relationship)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_http5_valid_jwt_unselected_account_no_metadata():
    """
    Valid JWT, user found in DB, but has no relationship with this traveller.
    Auth passes; Gate A: link query finds nothing → 403.
    Response body must contain no journey metadata.
    """
    r = await _get(
        f"Bearer {_jwt(_UNREL_ID)}",
        _journey(),
        links_store=[],
        users_store={_UNREL_ID: _user(_UNREL_ID)},
    )
    assert r.status_code == 403
    assert "Priya" not in r.text
    assert _DEST  not in r.text
    assert str(_LAT) not in r.text


@pytest.mark.asyncio
async def test_http6_accepted_contact_not_selected_for_journey_403():
    """
    RECIPIENT_ID has an accepted link (OTHER_LID) with the traveller, but
    this journey's recipient_link_ids = [_LINK_ID] only.
    Query: id.$in = [_LINK_ID]; _OTHER_LID not in that set → no match → 403.
    NOTE: The $in predicate is evaluated in Python; MongoDB server-side
    behavior is not verified.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(),
        links_store=[_link(uid=_RECIP_ID, link_id=_OTHER_LID)],  # accepted but not selected
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_http7_link_belongs_to_different_authenticated_identity_403():
    """
    _LINK_ID is in journey.recipient_link_ids, with invitee_user_id=_RECIP_ID.
    _IMPOST_ID presents a valid JWT (user exists) but is not the link's owner.
    Query: invitee_user_id=_IMPOST_ID → no match → 403.
    Confirms identity is bound to JWT, not to a client-supplied parameter.
    """
    r = await _get(
        f"Bearer {_jwt(_IMPOST_ID)}",
        _journey(),
        links_store=[_link(uid=_RECIP_ID, link_id=_LINK_ID)],  # belongs to _RECIP_ID
        users_store={_IMPOST_ID: _user(_IMPOST_ID)},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("rel_status", ["revoked", "declined", "pending"])
async def test_http8_non_accepted_relationship_403(rel_status: str):
    """
    Link ID is in recipient_link_ids, identity matches, but status ≠ 'accepted'.
    Query filters status='accepted' → Python predicate returns no match → 403.
    NOTE: MongoDB server-side filtering of status field is not verified.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(),
        links_store=[_link(uid=_RECIP_ID, link_id=_LINK_ID, status=rel_status)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 3.  Permission gates — journey_status and temp_location
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_http9_accepted_recipient_with_status_permission_200():
    """
    Full positive path: valid JWT → user found → link matches → journey_status=True.
    Response: 200 with permitted metadata; no coordinates; access_level present.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(),
        links_store=[_link(journey_status=True, temp_location=False)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("traveller_display") == "Priya"
    assert body.get("status") == "in_progress"
    assert "access_level" in body
    # No coordinates in HISTORICAL_ONLY response
    assert str(_LAT) not in r.text
    assert str(_LNG) not in r.text


@pytest.mark.asyncio
async def test_http10_false_journey_status_permission_403():
    """
    Accepted, selected, identity matches — but journey_status=False.
    Application-level check on the returned link record → 403.
    This is an application-level gate on the DB row, not a DB predicate.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(),
        links_store=[_link(journey_status=False)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_http11_temp_location_denied_destination_absent():
    """
    journey_status=True, temp_location=False → destination key must not appear.
    _DEST is in the stored record; its absence confirms suppression, not
    a missing DB field.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(),
        links_store=[_link(journey_status=True, temp_location=False)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 200
    assert "destination" not in r.json()
    assert _DEST not in r.text


# ══════════════════════════════════════════════════════════════════════════════
# 4.  Closed-journey suppression (safe and sharing-revoked)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@pytest.mark.parametrize("jkwargs,label", [
    ({"status": "safe"},                              "safe"),
    ({"status": "in_progress", "revoked": True},      "sharing-revoked"),
])
async def test_http12_closed_journey_temp_location_true_no_destination(jkwargs, label):
    """
    Safe or sharing-revoked journey with temp_location=True.
    Destination and all location data must be withheld unconditionally.
    _DEST and synthetic coordinates are in the stored record; absence
    confirms code suppression, not absent DB fields.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(**jkwargs),
        links_store=[_link(journey_status=True, temp_location=True)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 200, f"[{label}] expected 200, got {r.status_code}"
    body = r.json()
    assert "destination"    not in body,  f"[{label}] destination must not appear"
    assert _DEST            not in r.text, f"[{label}] destination text must not appear"
    assert str(_LAT)        not in r.text, f"[{label}] lat must not appear"
    assert str(_LNG)        not in r.text, f"[{label}] lng must not appear"


# ══════════════════════════════════════════════════════════════════════════════
# 5.  Token hardening — expired journey
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_http13_expired_journey_410_no_sensitive_data():
    """
    Journey past expires_at → 410 Gone.
    Error body must not contain traveller name, destination, or location data.
    Expiry check fires before the link query; link is never evaluated.
    """
    r = await _get(
        f"Bearer {_jwt(_RECIP_ID)}",
        _journey(expired=True),
        links_store=[_link(journey_status=True)],
        users_store={_RECIP_ID: _user(_RECIP_ID)},
    )
    assert r.status_code == 410
    assert "Priya"       not in r.text
    assert _DEST         not in r.text
    assert str(_LAT)     not in r.text
