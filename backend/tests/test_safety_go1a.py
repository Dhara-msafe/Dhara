"""
GO1A backend regression tests — safety_router saved places

Run with:
    cd /app/backend && pytest tests/test_safety_go1a.py -v

All tests hit the live backend at localhost:8001.
All tests use isolated user accounts to prevent cross-user contamination.
No real SMS, location monitoring, invitations or external calls are made.
"""
from __future__ import annotations

import asyncio
import hashlib
import os

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = "http://localhost:8001/api"

# ── DB helper (for soft-delete verification) ──────────────────────────────────

_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)
_MONGO = AsyncIOMotorClient(os.environ["MONGO_URL"], io_loop=_LOOP)

def _db():
    return _MONGO[os.environ.get("DB_NAME", "msafe")]

def _run(coro):
    return _LOOP.run_until_complete(coro)


# ── Auth helper ───────────────────────────────────────────────────────────────

def _register_and_login(suffix: str) -> str:
    """Create a fresh test user and return a valid Bearer token."""
    email = f"safety_test_{suffix}@example.com"
    pw = "TestPass123!"
    # Derive a unique 10-digit phone so parallel runs don't collide
    phone = str(int(hashlib.md5(suffix.encode()).hexdigest(), 16) % 9_000_000_000 + 1_000_000_000)
    reg = requests.post(f"{BASE}/auth/register", json={
        "email": email,
        "password": pw,
        "name": f"Test {suffix}",
        "phone": phone,
        "terms_accepted": True,
    })
    # 400 = already registered from a previous run — just login
    assert reg.status_code in (200, 400), f"Register failed: {reg.text}"
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"Login failed: {r.text}"
    data = r.json()
    return data.get("access_token") or data.get("token")


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Test: existing AsyncStorage contacts not affected by GO1A ─────────────────

class TestAsyncStoragePreservation:
    """
    The backend has no endpoint that reads or writes ws_trusted_circle.
    These tests confirm no safety_router endpoint touches that key.
    """
    def test_saved_places_endpoint_does_not_mention_trusted_circle(self):
        import inspect
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import api.safety_router as sr
        source = inspect.getsource(sr)
        assert "ws_trusted_circle" not in source
        assert "CIRCLE_KEY" not in source

    def test_safety_router_does_not_import_evidence_modules(self):
        import inspect
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import api.safety_router as sr
        source = inspect.getsource(sr)
        assert "evidenceCrypto" not in source
        assert "evidenceLock" not in source
        assert "EvidenceRecorder" not in source


# ── Test: unauthenticated access is blocked ────────────────────────────────────

class TestAuth:
    def test_list_places_requires_auth(self):
        r = requests.get(f"{BASE}/safety/places")
        assert r.status_code in (401, 403)

    def test_create_place_requires_auth(self):
        r = requests.post(f"{BASE}/safety/places", json={"label": "Home", "radius_meters": 200})
        assert r.status_code in (401, 403)

    def test_patch_place_requires_auth(self):
        r = requests.patch(f"{BASE}/safety/places/fake-id", json={"label": "X"})
        assert r.status_code in (401, 403)

    def test_delete_place_requires_auth(self):
        r = requests.delete(f"{BASE}/safety/places/fake-id")
        assert r.status_code in (401, 403)


# ── Test: CRUD lifecycle ──────────────────────────────────────────────────────

class TestCRUD:
    def test_create_and_list(self):
        tok = _register_and_login("crud01")
        # List should be empty (or have items from previous runs — just verify 200)
        r = requests.get(f"{BASE}/safety/places", headers=auth(tok))
        assert r.status_code == 200
        initial_count = len(r.json()["places"])

        # Create a place
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "College library", "radius_meters": 100},
            headers=auth(tok),
        )
        assert r.status_code == 201
        p = r.json()
        assert p["label"] == "College library"
        assert p["radius_meters"] == 100
        assert p["radius_label"] == "100 m"
        assert "place_id" in p
        assert "deleted_at" not in p or p.get("deleted_at") is None

        # List returns the new place
        r2 = requests.get(f"{BASE}/safety/places", headers=auth(tok))
        assert r2.status_code == 200
        assert len(r2.json()["places"]) == initial_count + 1
        assert r2.json()["places"][0]["place_id"] == p["place_id"]

    def test_edit_label_and_radius(self):
        tok = _register_and_login("crud02")
        cr = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Hostel gate", "radius_meters": 200},
            headers=auth(tok),
        )
        assert cr.status_code == 201
        pid = cr.json()["place_id"]

        patch = requests.patch(
            f"{BASE}/safety/places/{pid}",
            json={"label": "Hostel gate (north)", "radius_meters": 300},
            headers=auth(tok),
        )
        assert patch.status_code == 200
        assert patch.json()["label"] == "Hostel gate (north)"
        assert patch.json()["radius_meters"] == 300

    def test_delete_removes_from_list(self):
        tok = _register_and_login("crud03")
        cr = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Bus stop", "radius_meters": 100},
            headers=auth(tok),
        )
        assert cr.status_code == 201
        pid = cr.json()["place_id"]

        dr = requests.delete(f"{BASE}/safety/places/{pid}", headers=auth(tok))
        assert dr.status_code == 200
        assert dr.json()["deleted"] is True

        # No longer in list
        r = requests.get(f"{BASE}/safety/places", headers=auth(tok))
        pids = [p["place_id"] for p in r.json()["places"]]
        assert pid not in pids

    def test_delete_is_soft_not_hard(self):
        """Deleted place should not be in active list but document still in DB."""
        tok = _register_and_login("crud04")
        cr = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Park entrance", "radius_meters": 200},
            headers=auth(tok),
        )
        assert cr.status_code == 201
        pid = cr.json()["place_id"]
        dr = requests.delete(f"{BASE}/safety/places/{pid}", headers=auth(tok))
        assert dr.status_code == 200

        # Verify record still exists in DB with deleted_at set
        doc = _run(_db()["safety_saved_places"].find_one({"place_id": pid}))
        assert doc is not None, "Document should be preserved (soft delete)"
        assert doc["deleted_at"] is not None


# ── Test: validation ──────────────────────────────────────────────────────────

class TestValidation:
    def test_blank_label_rejected(self):
        tok = _register_and_login("val01")
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "   ", "radius_meters": 200},
            headers=auth(tok),
        )
        assert r.status_code == 422

    def test_label_too_long_rejected(self):
        tok = _register_and_login("val02")
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "A" * 81, "radius_meters": 200},
            headers=auth(tok),
        )
        assert r.status_code == 422

    def test_radius_below_minimum_rejected(self):
        tok = _register_and_login("val03")
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Home", "radius_meters": 10},
            headers=auth(tok),
        )
        assert r.status_code == 422

    def test_radius_above_maximum_rejected(self):
        tok = _register_and_login("val04")
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Home", "radius_meters": 9999},
            headers=auth(tok),
        )
        assert r.status_code == 422

    def test_custom_radius_accepted(self):
        tok = _register_and_login("val05")
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Custom spot", "radius_meters": 150},
            headers=auth(tok),
        )
        assert r.status_code == 201
        assert r.json()["radius_meters"] == 150
        assert "150 m (custom)" in r.json()["radius_label"]

    def test_preset_radii_accepted(self):
        tok = _register_and_login("val06")
        for m in (100, 200, 300):
            r = requests.post(
                f"{BASE}/safety/places",
                json={"label": f"Place {m}", "radius_meters": m},
                headers=auth(tok),
            )
            assert r.status_code == 201
            assert r.json()["radius_meters"] == m


# ── Test: IDOR — users cannot access each other's saved places ────────────────

class TestIDOR:
    def test_user_b_cannot_edit_user_a_place(self):
        tok_a = _register_and_login("idor01a")
        tok_b = _register_and_login("idor01b")

        cr = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Alice home", "radius_meters": 200},
            headers=auth(tok_a),
        )
        assert cr.status_code == 201
        pid = cr.json()["place_id"]

        patch = requests.patch(
            f"{BASE}/safety/places/{pid}",
            json={"label": "Hacked"},
            headers=auth(tok_b),
        )
        assert patch.status_code == 403

    def test_user_b_cannot_delete_user_a_place(self):
        tok_a = _register_and_login("idor02a")
        tok_b = _register_and_login("idor02b")

        cr = requests.post(
            f"{BASE}/safety/places",
            json={"label": "Alice office", "radius_meters": 100},
            headers=auth(tok_a),
        )
        assert cr.status_code == 201
        pid = cr.json()["place_id"]

        dr = requests.delete(f"{BASE}/safety/places/{pid}", headers=auth(tok_b))
        assert dr.status_code == 403

    def test_user_b_does_not_see_user_a_places(self):
        tok_a = _register_and_login("idor03a")
        tok_b = _register_and_login("idor03b")

        requests.post(
            f"{BASE}/safety/places",
            json={"label": "Alice secret spot", "radius_meters": 200},
            headers=auth(tok_a),
        )

        r = requests.get(f"{BASE}/safety/places", headers=auth(tok_b))
        labels = [p["label"] for p in r.json()["places"]]
        assert "Alice secret spot" not in labels


# ── Test: 10-place limit ──────────────────────────────────────────────────────

class TestLimit:
    def test_max_10_saved_places(self):
        tok = _register_and_login("lim01")
        # Remove existing places first to start from 0
        existing = requests.get(f"{BASE}/safety/places", headers=auth(tok)).json()["places"]
        for p in existing:
            requests.delete(f"{BASE}/safety/places/{p['place_id']}", headers=auth(tok))

        for i in range(10):
            r = requests.post(
                f"{BASE}/safety/places",
                json={"label": f"Place {i}", "radius_meters": 200},
                headers=auth(tok),
            )
            assert r.status_code == 201

        # 11th should fail
        r = requests.post(
            f"{BASE}/safety/places",
            json={"label": "One too many", "radius_meters": 200},
            headers=auth(tok),
        )
        assert r.status_code == 400
        assert "10" in r.json()["detail"]


# ── Test: no monitoring or alert behaviour ────────────────────────────────────

class TestNoMonitoring:
    def test_safety_router_has_no_journey_start_endpoint(self):
        """Confirm no ACTIVE journey or monitoring endpoint exists in GO1A."""
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from api.safety_router import router
        paths = [r.path for r in router.routes]  # type: ignore[attr-defined]
        assert not any("journey" in p for p in paths), f"Unexpected journey route: {paths}"
        assert not any("/start" in p for p in paths), f"Unexpected start route: {paths}"

    def test_safety_router_has_no_invitation_endpoints(self):
        """GO1A does not include invitation, token or delivery endpoints."""
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from api.safety_router import router
        paths = [r.path for r in router.routes]  # type: ignore[attr-defined]
        assert not any("invite" in p for p in paths), f"Unexpected invite route: {paths}"
        assert not any("accept" in p for p in paths), f"Unexpected accept route: {paths}"
        assert not any("token" in p for p in paths), f"Unexpected token route: {paths}"


# ── Test: SAFETY_TEST_MODE hard rejection ────────────────────────────────────

class TestTestModeRejection:
    def test_safety_test_mode_false_in_env(self):
        """SAFETY_TEST_MODE must be false in the test environment."""
        val = os.getenv("SAFETY_TEST_MODE", "false")
        assert val.lower() == "false", (
            "SAFETY_TEST_MODE is not false. This must never be true in a "
            "non-localhost environment."
        )
