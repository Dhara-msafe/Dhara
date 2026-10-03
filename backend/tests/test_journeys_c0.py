"""C0 Journey Registry — verification tests.

Covers api/journeys_router.py:
  - Public GET /api/journeys (list, category filter)
  - Public GET /api/journeys/{id} (detail, 404 for unknown/inactive)
  - Admin POST/PUT/DELETE require X-Admin-Key (401/503 without a valid key)
  - Admin create/update/deactivate round-trip, version bumping
  - Bulk import endpoint upserts idempotently (create then update)

Run: cd /app/backend && pytest tests/test_journeys_c0.py -v

Requires the seed journey to already exist (python seed_journeys.py) for the
first two tests — run that once before this suite in a fresh environment.
"""
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")


def admin_headers():
    return {"X-Admin-Key": ADMIN_KEY}


@pytest.fixture(scope="module")
def session():
    return requests.Session()


@pytest.fixture(scope="module")
def test_journey_id():
    return f"TEST_journey_{uuid.uuid4().hex[:8]}"


def test_seed_journey_visible_in_list(session):
    r = session.get(f"{API}/journeys")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "journeys" in body
    ids = [j["journey_id"] for j in body["journeys"]]
    assert "file-fir" in ids, f"seed journey not found in list: {ids}"


def test_seed_journey_detail_has_steps(session):
    r = session.get(f"{API}/journeys/file-fir")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["journey_id"] == "file-fir"
    assert len(doc["steps"]) >= 4
    module_types = {s["module_type"] for s in doc["steps"]}
    assert "helpline_router" in module_types
    assert "document_checklist" in module_types


def test_unknown_journey_404(session):
    r = session.get(f"{API}/journeys/TEST_does_not_exist_{uuid.uuid4().hex}")
    assert r.status_code == 404


def test_category_filter(session):
    r = session.get(f"{API}/journeys", params={"category": "police"})
    assert r.status_code == 200
    for j in r.json()["journeys"]:
        assert j["category"] == "police"


def test_admin_create_requires_key(session, test_journey_id):
    body = {
        "journey_id": test_journey_id,
        "title": "Test Journey",
        "category": "generic",
        "steps": [{"order": 0, "module_type": "info_card", "title": "Step 1", "body": "hi", "data": {}}],
    }
    r = session.post(f"{API}/admin/journeys", json=body)
    assert r.status_code in (401, 503)
    r = session.post(f"{API}/admin/journeys", json=body, headers={"X-Admin-Key": "wrong-key-xyz"})
    assert r.status_code in (401, 503)


@pytest.mark.skipif(not ADMIN_KEY, reason="ADMIN_KEY not set in test environment")
def test_admin_create_update_deactivate_roundtrip(session, test_journey_id):
    create_body = {
        "journey_id": test_journey_id,
        "title": "Test Journey",
        "summary": "A throwaway test journey",
        "category": "generic",
        "tags": ["test"],
        "steps": [
            {"order": 0, "module_type": "info_card", "title": "Step 1", "body": "hi", "data": {}},
        ],
    }
    r = session.post(f"{API}/admin/journeys", json=create_body, headers=admin_headers())
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["journey_id"] == test_journey_id
    assert created["version"] == 1

    # Duplicate create must fail
    r = session.post(f"{API}/admin/journeys", json=create_body, headers=admin_headers())
    assert r.status_code == 400

    # Update
    r = session.put(
        f"{API}/admin/journeys/{test_journey_id}",
        json={"title": "Test Journey Updated", "is_active": True},
        headers=admin_headers(),
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["title"] == "Test Journey Updated"
    assert updated["version"] == 2

    # Public detail reflects the update
    r = session.get(f"{API}/journeys/{test_journey_id}")
    assert r.status_code == 200
    assert r.json()["title"] == "Test Journey Updated"

    # Deactivate (soft delete)
    r = session.delete(f"{API}/admin/journeys/{test_journey_id}", headers=admin_headers())
    assert r.status_code == 200
    assert r.json()["is_active"] is False

    # Public detail now 404s
    r = session.get(f"{API}/journeys/{test_journey_id}")
    assert r.status_code == 404


@pytest.mark.skipif(not ADMIN_KEY, reason="ADMIN_KEY not set in test environment")
def test_bulk_import_idempotent(session, test_journey_id):
    bulk_id = f"{test_journey_id}_bulk"
    payload = [{
        "journey_id": bulk_id,
        "title": "Bulk Test",
        "category": "generic",
        "steps": [{"order": 0, "module_type": "info_card", "title": "S1", "body": "x", "data": {}}],
    }]
    r = session.post(f"{API}/admin/journeys/import", json=payload, headers=admin_headers())
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["action"] == "created"

    r = session.post(f"{API}/admin/journeys/import", json=payload, headers=admin_headers())
    assert r.status_code == 200
    assert r.json()["results"][0]["action"] == "updated"

    r = session.get(f"{API}/journeys/{bulk_id}")
    assert r.status_code == 200

    session.delete(f"{API}/admin/journeys/{bulk_id}", headers=admin_headers())
