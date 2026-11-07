"""Sprint B5 — Evidence Vault (anchor + chunked encrypted backup) tests.

Covers:
  - Feature flag gating (503 when evidence_locker_enabled is OFF)
  - POST /api/evidence/anchor (happy path + hex validation 422)
  - GET /api/evidence/anchor/{item_id} (404 before anchor, 200 after)
  - Chunked upload flow: init -> chunk(s) -> complete -> backups list -> delete
  - Chunk/complete edge cases: unknown session 404, bad index 400, missing chunk 400
"""
import base64
import hashlib
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")  # injected by the isolated QA runner; never hard-code

GENESIS = "0" * 64


def _hexhash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    # E1 hardening: /evidence/* now requires a signed-in user (scope = user id).
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "protest@gandhikar.in", "password": "test1234"})
    assert r.status_code == 200, r.text
    session.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return session


@pytest.fixture(autouse=True, scope="module")
def ensure_flag_on():
    """Turn evidence_locker_enabled ON for the whole module, restore OFF after."""
    session = requests.Session()
    r = session.post(
        f"{BASE_URL}/api/women/admin/flags",
        json={"evidence_locker_enabled": True},
        headers={"X-Admin-Key": ADMIN_KEY},
    )
    assert r.status_code == 200, f"Could not enable flag: {r.status_code} {r.text}"
    assert r.json().get("evidence_locker_enabled") is True
    yield
    session.post(
        f"{BASE_URL}/api/women/admin/flags",
        json={"evidence_locker_enabled": False},
        headers={"X-Admin-Key": ADMIN_KEY},
    )


class TestFlagGating:
    def test_anchor_503_when_flag_off(self, api_client):
        # The vault routes are gated on `evidence_vault_enabled`, NOT on
        # `evidence_locker_enabled` (which only controls the on-device locker
        # UI). Toggling the wrong flag left the endpoint live and made this
        # test fail with 200.
        r_off = api_client.post(
            f"{BASE_URL}/api/women/admin/flags",
            json={"evidence_vault_enabled": False},
            headers={"X-Admin-Key": ADMIN_KEY},
        )
        assert r_off.status_code == 200
        try:
            item_id = f"TEST_{uuid.uuid4()}"
            payload = {
                "item_id": item_id, "scope": "device", "type": "audio",
                "manifest_hash": _hexhash("m1"), "chain_hash": _hexhash("c1"),
                "prev_hash": GENESIS, "device_time": "2026-01-01T00:00:00Z", "gps": None,
            }
            r = api_client.post(f"{BASE_URL}/api/evidence/anchor", json=payload)
            assert r.status_code == 503, r.text
        finally:
            api_client.post(
                f"{BASE_URL}/api/women/admin/flags",
                json={"evidence_vault_enabled": True},
                headers={"X-Admin-Key": ADMIN_KEY},
            )


class TestAnchor:
    def test_anchor_happy_path_and_get(self, api_client):
        item_id = f"TEST_{uuid.uuid4()}"
        scope = "device"
        payload = {
            "item_id": item_id, "scope": scope, "type": "audio",
            "manifest_hash": _hexhash("manifest"), "chain_hash": _hexhash("chain"),
            "prev_hash": GENESIS, "device_time": "2026-01-01T00:00:00Z",
            "gps": {"lat": 12.34, "lng": 56.78, "accuracy": 10.5},
        }
        r = api_client.post(f"{BASE_URL}/api/evidence/anchor", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["item_id"] == item_id
        assert data["manifest_hash"] == payload["manifest_hash"]
        assert data["chain_hash"] == payload["chain_hash"]
        assert "receipt_id" in data and "server_time" in data and "signature" in data

        # GET should now return 200 with persisted doc
        r2 = api_client.get(f"{BASE_URL}/api/evidence/anchor/{item_id}", params={"scope": scope})
        assert r2.status_code == 200, r2.text
        doc = r2.json()
        assert doc["receipt_id"] == data["receipt_id"]
        assert doc["gps"]["lat"] == 12.34

    def test_anchor_get_404_before_anchor(self, api_client):
        item_id = f"TEST_{uuid.uuid4()}"
        r = api_client.get(f"{BASE_URL}/api/evidence/anchor/{item_id}", params={"scope": "device"})
        assert r.status_code == 404

    @pytest.mark.parametrize("field", ["manifest_hash", "chain_hash", "prev_hash"])
    def test_anchor_rejects_bad_hex(self, api_client, field):
        payload = {
            "item_id": f"TEST_{uuid.uuid4()}", "scope": "device", "type": "audio",
            "manifest_hash": _hexhash("m"), "chain_hash": _hexhash("c"),
            "prev_hash": GENESIS, "device_time": "2026-01-01T00:00:00Z", "gps": None,
        }
        payload[field] = "not-a-valid-hash"
        r = api_client.post(f"{BASE_URL}/api/evidence/anchor", json=payload)
        assert r.status_code == 422, r.text

    def test_anchor_rejects_short_hex(self, api_client):
        payload = {
            "item_id": f"TEST_{uuid.uuid4()}", "scope": "device", "type": "audio",
            "manifest_hash": "abc123", "chain_hash": _hexhash("c"),
            "prev_hash": GENESIS, "device_time": "2026-01-01T00:00:00Z", "gps": None,
        }
        r = api_client.post(f"{BASE_URL}/api/evidence/anchor", json=payload)
        assert r.status_code == 422, r.text


class TestChunkedUploadFlow:
    def test_full_upload_list_delete(self, api_client):
        item_id = f"TEST_{uuid.uuid4()}"
        scope = "device"
        chunks = [b"chunk-zero-bytes-xx", b"chunk-one-bytes-yyy", b"chunk-two-final-zzz"]
        manifest_hash = hashlib.sha256(b"".join(chunks)).hexdigest()

        init_payload = {
            "item_id": item_id, "scope": scope, "total_chunks": len(chunks),
            "ext": "bin", "iv": "deadbeef", "manifest_hash": manifest_hash,
        }
        r_init = api_client.post(f"{BASE_URL}/api/evidence/upload/init", json=init_payload)
        assert r_init.status_code == 200, r_init.text
        session_id = r_init.json()["session_id"]
        assert session_id

        for i, c in enumerate(chunks):
            r_chunk = api_client.post(f"{BASE_URL}/api/evidence/upload/chunk", json={
                "session_id": session_id, "index": i, "data_b64": base64.b64encode(c).decode(),
            })
            assert r_chunk.status_code == 200, r_chunk.text
            assert r_chunk.json()["received"] == i

        r_complete = api_client.post(f"{BASE_URL}/api/evidence/upload/complete", json={"session_id": session_id})
        assert r_complete.status_code == 200, r_complete.text
        result = r_complete.json()
        assert result["item_id"] == item_id
        # E1 hardening: the server pins `scope` to the authenticated user's id
        # and ignores whatever the client sent, so it is never the literal
        # "device" the client asked for.
        assert result["scope"] and result["scope"] != scope
        assert result["size"] == sum(len(c) for c in chunks)
        assert "storage_path" in result and "uploaded_at" in result

        # Verify listed in backups
        r_list = api_client.get(f"{BASE_URL}/api/evidence/backups", params={"scope": scope})
        assert r_list.status_code == 200, r_list.text
        items = r_list.json()["items"]
        assert any(it["item_id"] == item_id for it in items)

        # Delete and verify removed
        r_del = api_client.delete(f"{BASE_URL}/api/evidence/backups/{item_id}", params={"scope": scope})
        assert r_del.status_code == 200, r_del.text
        assert r_del.json() == {"ok": True, "deleted": True}

        r_list2 = api_client.get(f"{BASE_URL}/api/evidence/backups", params={"scope": scope})
        items2 = r_list2.json()["items"]
        assert not any(it["item_id"] == item_id for it in items2)

    def test_delete_nonexistent_returns_404(self, api_client):
        # E2/A2 hardening: a missing item and someone else's item return the
        # SAME 404, so a caller cannot use the response to discover whether an
        # item exists.
        r = api_client.delete(f"{BASE_URL}/api/evidence/backups/{uuid.uuid4()}", params={"scope": "device"})
        assert r.status_code == 404
        assert "No backup found" in r.text

    def test_chunk_unknown_session_404(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/evidence/upload/chunk", json={
            "session_id": str(uuid.uuid4()), "index": 0, "data_b64": base64.b64encode(b"x").decode(),
        })
        assert r.status_code == 404

    def test_chunk_out_of_range_index_400(self, api_client):
        init_payload = {
            "item_id": f"TEST_{uuid.uuid4()}", "scope": "device", "total_chunks": 2,
            "ext": "bin", "iv": "", "manifest_hash": None,
        }
        r_init = api_client.post(f"{BASE_URL}/api/evidence/upload/init", json=init_payload)
        assert r_init.status_code == 200
        session_id = r_init.json()["session_id"]
        r_chunk = api_client.post(f"{BASE_URL}/api/evidence/upload/chunk", json={
            "session_id": session_id, "index": 5, "data_b64": base64.b64encode(b"x").decode(),
        })
        assert r_chunk.status_code == 400

    def test_complete_missing_chunk_400(self, api_client):
        init_payload = {
            "item_id": f"TEST_{uuid.uuid4()}", "scope": "device", "total_chunks": 3,
            "ext": "bin", "iv": "", "manifest_hash": None,
        }
        r_init = api_client.post(f"{BASE_URL}/api/evidence/upload/init", json=init_payload)
        session_id = r_init.json()["session_id"]
        # Only send chunk 0 and 2, skip 1
        api_client.post(f"{BASE_URL}/api/evidence/upload/chunk", json={
            "session_id": session_id, "index": 0, "data_b64": base64.b64encode(b"a").decode(),
        })
        api_client.post(f"{BASE_URL}/api/evidence/upload/chunk", json={
            "session_id": session_id, "index": 2, "data_b64": base64.b64encode(b"c").decode(),
        })
        r_complete = api_client.post(f"{BASE_URL}/api/evidence/upload/complete", json={"session_id": session_id})
        assert r_complete.status_code == 400, r_complete.text

    def test_complete_unknown_session_404(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/evidence/upload/complete", json={"session_id": str(uuid.uuid4())})
        assert r.status_code == 404
