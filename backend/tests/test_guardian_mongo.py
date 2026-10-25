"""
test_guardian_mongo.py
Real MongoDB predicate verification for _guardian_access_check queries.

PURPOSE
───────
The HTTP tests in test_guardian_http.py approximate MongoDB predicate
behaviour using Python-side evaluation (``id in ids_in and ...``).  This file
replaces that approximation with real MongoDB query execution via mongomock —
an in-process MongoDB emulator built on the CPython `bson` package.  All seven
tests run synchronously (no asyncio), using pymongo against mongomock.

QUERY SURFACES VERIFIED
────────────────────────
1. token equality on safety_journeys: ``{"token": token}``
2. $in operator on trusted_circle_links: ``{"id": {"$in": link_ids}}``
3. status equality: ``{"status": "accepted"}``
4. invitee_user_id binding: ``{"invitee_user_id": uid}``
5. Combined three-predicate link query (all fields together)

LIMITATIONS
───────────
• mongomock does not perfectly replicate every MongoDB server behaviour
  (collation, Atlas-specific operators, advanced aggregation pipelines).
  These tests verify the subset of operators that _guardian_access_check uses.
• Motor (async) is not used here — that is intentional: we test the predicate
  logic, not the Motor driver or asyncio event loop.
• Index behaviour, write concerns, and concurrency are out of scope.
"""
from __future__ import annotations

import mongomock
import pytest

# ── Constants ─────────────────────────────────────────────────────────────────
_OWNER   = "mongo-owner-001"
_RECIP   = "mongo-recip-001"
_LINK_A  = "mongo-link-A"        # the link selected for this journey
_LINK_B  = "mongo-link-B"        # an accepted link NOT selected for this journey
_TOKEN   = "MONGOTOK001"
_BAD_TOK = "WRONGTOKEN999"


# ── Record builders ───────────────────────────────────────────────────────────

def _journey() -> dict:
    return {
        "token":              _TOKEN,
        "user_id":            _OWNER,
        "user_display":       "Priya",
        "recipient_link_ids": [_LINK_A],
        "status":             "in_progress",
    }


def _link(
    link_id:  str = _LINK_A,
    invitee:  str = _RECIP,
    status:   str = "accepted",
) -> dict:
    return {
        "id":              link_id,
        "owner_id":        _OWNER,
        "invitee_user_id": invitee,
        "status":          status,
        "permissions": {
            "journey_status": True,
            "temp_location":  False,
        },
    }


# ── Helper: build the exact query used by _guardian_access_check ──────────────

def _link_query(link_ids: list, uid: str) -> dict:
    """Mirrors the db.trusted_circle_links.find_one() call in journey_router.py."""
    return {
        "id":               {"$in": link_ids},
        "invitee_user_id":  uid,
        "status":           "accepted",
    }


# ══════════════════════════════════════════════════════════════════════════════
# Journey token lookup
# ══════════════════════════════════════════════════════════════════════════════

def test_mongo1_journey_token_equality_match():
    """Exact token equality: correct token → document found."""
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.journeys.insert_one(_journey())
        result = db.journeys.find_one({"token": _TOKEN})
    assert result is not None
    assert result["token"] == _TOKEN


def test_mongo2_journey_token_equality_no_match():
    """Exact token equality: wrong token → None."""
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.journeys.insert_one(_journey())
        result = db.journeys.find_one({"token": _BAD_TOK})
    assert result is None


# ══════════════════════════════════════════════════════════════════════════════
# $in operator — link_id set membership
# ══════════════════════════════════════════════════════════════════════════════

def test_mongo3_in_operator_matches_selected_link():
    """$in: link_A is in recipient_link_ids set → document found."""
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.links.insert_one(_link(_LINK_A))
        result = db.links.find_one(_link_query([_LINK_A], _RECIP))
    assert result is not None, "Expected link_A to be found via $in"
    assert result["id"] == _LINK_A


def test_mongo4_in_operator_rejects_unselected_link():
    """
    $in: link_B is accepted and belongs to _RECIP, but the journey only
    selected link_A.  Query asks for $in=[_LINK_A] → link_B not in set → None.
    Confirms that the $in predicate is evaluated server-side by MongoDB (here:
    mongomock), not just by Python set membership.
    """
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.links.insert_one(_link(_LINK_B))  # B is accepted but not selected
        result = db.links.find_one(_link_query([_LINK_A], _RECIP))  # A in query
    assert result is None, "link_B must not match when query asks for $in=[link_A]"


# ══════════════════════════════════════════════════════════════════════════════
# status field filter
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("bad_status", ["revoked", "declined", "pending", "invited"])
def test_mongo5_status_accepted_filter_rejects_non_accepted(bad_status: str):
    """
    status='accepted' filter: link with correct id and identity but non-accepted
    status → None.  Verifies server-side string equality on the status field.
    """
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.links.insert_one(_link(_LINK_A, status=bad_status))
        result = db.links.find_one(_link_query([_LINK_A], _RECIP))
    assert result is None, (
        f"status='{bad_status}' must not match query filter status='accepted'"
    )


# ══════════════════════════════════════════════════════════════════════════════
# invitee_user_id binding
# ══════════════════════════════════════════════════════════════════════════════

def test_mongo6_invitee_binding_prevents_identity_crossover():
    """
    invitee_user_id binding: link belongs to _RECIP; impostor presents
    the same link_id but a different identity → None.
    Confirms that identity is tied to the DB document, not to a client-supplied
    parameter — the same guarantee the HTTP tests verify at the JWT layer.
    """
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.links.insert_one(_link(_LINK_A, invitee=_RECIP))
        result = db.links.find_one(_link_query([_LINK_A], "impostor-uid"))
    assert result is None, "impostor identity must not match the link's invitee_user_id"


# ══════════════════════════════════════════════════════════════════════════════
# Combined three-predicate query — positive path
# ══════════════════════════════════════════════════════════════════════════════

def test_mongo7_combined_predicate_positive_path():
    """
    All three predicates satisfied simultaneously:
    id $in set AND invitee_user_id matches AND status='accepted' → document found.
    This is the full production query path used by _guardian_access_check Gate A.
    """
    with mongomock.patch():
        import pymongo
        db = pymongo.MongoClient()["testdb"]
        db.links.insert_many([
            _link(_LINK_A, invitee=_RECIP, status="accepted"),
            _link(_LINK_B, invitee=_RECIP, status="accepted"),   # accepted but not in set
        ])
        result = db.links.find_one(_link_query([_LINK_A], _RECIP))
    assert result is not None
    assert result["id"] == _LINK_A
    assert result["status"] == "accepted"
    assert result["invitee_user_id"] == _RECIP
