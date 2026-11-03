"""E2/A2: owner checks, anchor DELETE, account-deletion cascade, migration dry-run.
Runs against the local backend (localhost:8001) and the local MongoDB."""
import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
BASE = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/") + "/api"
HEX = "a" * 64


LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)
_CLIENT = AsyncIOMotorClient(os.environ["MONGO_URL"], io_loop=LOOP)


def _db():
    return _CLIENT[os.environ["DB_NAME"]]


def _run(coro):
    return LOOP.run_until_complete(coro)


def _guest():
    r = requests.post(f"{BASE}/auth/guest", json={})
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    return {"Authorization": f"Bearer {tok}"}, j["user"]["id"]


@pytest.fixture(scope="module", autouse=True)
def vault_flag_on():
    async def get():
        return await _db().settings.find_one({"_id": "app_flags"}) or {}
    prev = _run(get()).get("evidence_vault_enabled")
    _run(_db().settings.update_one({"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": True}}, upsert=True))
    yield
    if prev is None:
        _run(_db().settings.update_one({"_id": "app_flags"}, {"$unset": {"evidence_vault_enabled": ""}}))
    else:
        _run(_db().settings.update_one({"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": prev}}))


def _anchor(h, item_id):
    body = {"item_id": item_id, "scope": "ignored", "type": "audio", "manifest_hash": HEX,
            "chain_hash": HEX, "prev_hash": "0" * 64, "device_time": "2026-06-01T00:00:00Z"}
    return requests.post(f"{BASE}/evidence/anchor", json=body, headers=h)


def test_backups_list_and_delete_require_login():
    assert requests.get(f"{BASE}/evidence/backups", params={"scope": "x"}).status_code in (401, 403)
    assert requests.delete(f"{BASE}/evidence/backups/x", params={"scope": "x"}).status_code in (401, 403)


def test_anchor_owner_checks_and_delete():
    ha, ua = _guest()
    hb, _ = _guest()
    item = f"t-{uuid.uuid4()}"
    assert _anchor(ha, item).status_code == 200
    doc = _run(_db().evidence_anchors.find_one({"item_id": item}))
    assert doc["user_id"] == ua
    assert requests.get(f"{BASE}/evidence/anchor/{item}", headers=hb).status_code == 404
    assert requests.delete(f"{BASE}/evidence/anchor/{item}", headers=hb).status_code == 404
    assert requests.delete(f"{BASE}/evidence/backups/{item}", headers=hb).status_code == 404
    assert requests.get(f"{BASE}/evidence/backups", headers=hb).json()["items"] == []
    assert requests.delete(f"{BASE}/evidence/anchor/{item}", headers=ha).status_code == 200
    assert requests.get(f"{BASE}/evidence/anchor/{item}", headers=ha).status_code == 404


def test_upload_session_owner_check():
    ha, ua = _guest()
    hb, _ = _guest()
    r = requests.post(f"{BASE}/evidence/upload/init", json={"item_id": "u1", "scope": "x", "total_chunks": 1}, headers=ha)
    sid = r.json()["session_id"]
    assert _run(_db().evidence_upload_sessions.find_one({"session_id": sid}))["user_id"] == ua
    rb = requests.post(f"{BASE}/evidence/upload/chunk", json={"session_id": sid, "index": 0, "data_b64": "AA=="}, headers=hb)
    assert rb.status_code == 404
    assert requests.post(f"{BASE}/evidence/upload/complete", json={"session_id": sid}, headers=hb).status_code == 404
    ra = requests.post(f"{BASE}/evidence/upload/chunk", json={"session_id": sid, "index": 0, "data_b64": "AA=="}, headers=ha)
    assert ra.status_code == 200
    _run(_db().evidence_upload_sessions.delete_one({"session_id": sid}))


def test_account_deletion_cascade_includes_legacy_rows():
    sys.path.insert(0, str(ROOT))
    from account_deletion import hard_delete_user
    uid = f"cascade-{uuid.uuid4()}"

    async def go():
        db = _db()
        await db.evidence_anchors.insert_many([
            {"receipt_id": str(uuid.uuid4()), "item_id": "n", "user_id": uid, "scope": uid},
            {"receipt_id": str(uuid.uuid4()), "item_id": "legacy", "scope": uid},
        ])
        await db.evidence_upload_sessions.insert_one({"session_id": str(uuid.uuid4()), "user_id": uid, "scope": uid})
        counts = await hard_delete_user(db, uid)
        left = await db.evidence_anchors.count_documents({"scope": uid})
        return counts, left
    counts, left = _run(go())
    assert counts["evidence_anchors"] == 2
    assert counts["evidence_upload_sessions"] == 1
    assert left == 0


def test_migration_dry_run_writes_nothing():
    async def snap():
        return await _db().evidence_anchors.count_documents({"user_id": {"$exists": False}})
    before = _run(snap())
    out = subprocess.run([sys.executable, "scripts/migrate_evidence_user_id.py"], cwd=ROOT,
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert "DRY-RUN" in out.stdout
    assert _run(snap()) == before


def test_chunk_complete_owner_check_flag_off():
    """STEP 3.2/3.3 — response ordering: login 401 → owner 404 → flag 503.

    When evidence_vault_enabled is OFF:
      unauthenticated           → 401/403   (login fires first)
      authenticated + non-owner → 404       (owner check fires before flag)
      authenticated + owner     → 503       (flag check fires after owner confirmed)
    """
    ha, ua = _guest()
    hb, _  = _guest()
    sid = str(uuid.uuid4())
    _run(_db().settings.update_one(
        {"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": False}}, upsert=True
    ))
    try:
        # init is flag-gated — 503 is expected
        ri = requests.post(f"{BASE}/evidence/upload/init",
                           json={"item_id": "flagoff", "scope": "x", "total_chunks": 1},
                           headers=ha)
        assert ri.status_code == 503, f"init flag-OFF should be 503, got {ri.status_code}"

        # Insert an in-flight session owned by ua (real user_id)
        _run(_db().evidence_upload_sessions.insert_one({
            "session_id": sid, "item_id": "flagoff-item",
            "user_id": ua, "scope": ua,
            "total_chunks": 1, "ext": "bin", "iv": "", "created_at": 0,
        }))

        # 1. Unauthenticated → 401/403 (never 503)
        for path, body in [
            ("/evidence/upload/chunk",    {"session_id": sid, "index": 0, "data_b64": "AA=="}),
            ("/evidence/upload/complete", {"session_id": sid}),
        ]:
            r = requests.post(f"{BASE}{path}", json=body)
            assert r.status_code in (401, 403), f"unauth {path} should be 401/403, got {r.status_code}"

        # 2. Authenticated non-owner → 404 (before flag check)
        for path, body in [
            ("/evidence/upload/chunk",    {"session_id": sid, "index": 0, "data_b64": "AA=="}),
            ("/evidence/upload/complete", {"session_id": sid}),
        ]:
            r = requests.post(f"{BASE}{path}", json=body, headers=hb)
            assert r.status_code == 404, f"non-owner {path} flag-OFF should be 404, got {r.status_code}: {r.text}"

        # 3. Authenticated owner → 503 (owner check passes, flag check fires next)
        for path, body in [
            ("/evidence/upload/chunk",    {"session_id": sid, "index": 0, "data_b64": "AA=="}),
            ("/evidence/upload/complete", {"session_id": sid}),
        ]:
            r = requests.post(f"{BASE}{path}", json=body, headers=ha)
            assert r.status_code == 503, f"owner {path} flag-OFF should be 503, got {r.status_code}: {r.text}"
    finally:
        _run(_db().settings.update_one(
            {"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": True}}
        ))
        _run(_db().evidence_upload_sessions.delete_one({"session_id": sid}))


def test_cascade_non_404_storage_error_keeps_row():
    """STEP 3.1/3.3 — non-404 storage error must keep the DB row for retry.

    Cascade contract:
      404  from storage → treat as success (file already gone), delete row.
      non-404 from storage → keep row so the run can be retried safely, count failure.
    """
    sys.path.insert(0, str(ROOT))
    from account_deletion import hard_delete_user
    import fir_storage
    from unittest.mock import patch
    import requests as req_lib

    uid = f"storageerr-{uuid.uuid4()}"
    backup_item = f"item-{uuid.uuid4()}"

    _run(_db().evidence_backups.insert_one({
        "id": str(uuid.uuid4()), "item_id": backup_item,
        "user_id": uid, "scope": uid,
        "storage_path": f"dhara-legal-aid/evidence_vault/{uid}/{backup_item}.enc",
        "size": 0, "uploaded_at": "2026-01-01T00:00:00+00:00",
    }))

    # Patch delete_raw_object_strict on the fir_storage module so the
    # in-function `from fir_storage import delete_raw_object_strict` sees it.
    async def _raise_500(*_a, **_kw):
        raise req_lib.exceptions.HTTPError("500 Server Error: mock")

    with patch.object(fir_storage, "delete_raw_object_strict", _raise_500):
        counts = _run(hard_delete_user(_db(), uid))

    # Row must still be present — kept for retry
    row = _run(_db().evidence_backups.find_one({"item_id": backup_item, "user_id": uid}))
    assert row is not None, "backup row must be kept when storage delete raises non-404"
    assert counts.get("evidence_backup_files_failed", 0) >= 1, "failed count should be ≥ 1"
    assert counts.get("evidence_backups", -1) == 0, "removed count should be 0 on storage failure"

    # Cleanup
    _run(_db().evidence_backups.delete_one({"item_id": backup_item, "user_id": uid}))


def test_cascade_works_with_vault_flag_off():
    """STEP 3.3 — hard_delete_user runs regardless of evidence_vault_enabled flag.
    The cascade has no flag check and must complete when the vault is disabled."""
    sys.path.insert(0, str(ROOT))
    from account_deletion import hard_delete_user
    uid = f"flagoff-cas-{uuid.uuid4()}"
    _run(_db().settings.update_one(
        {"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": False}}, upsert=True
    ))
    try:
        async def go():
            db_ = _db()
            await db_.evidence_anchors.insert_one({
                "receipt_id": str(uuid.uuid4()), "item_id": f"i-{uid}",
                "user_id": uid, "scope": uid,
            })
            counts = await hard_delete_user(db_, uid)
            remaining = await db_.evidence_anchors.count_documents({"user_id": uid})
            return counts, remaining
        counts, remaining = _run(go())
        assert counts["evidence_anchors"] >= 1, "cascade must delete anchors even when flag is OFF"
        assert remaining == 0
    finally:
        _run(_db().settings.update_one(
            {"_id": "app_flags"}, {"$set": {"evidence_vault_enabled": True}}
        ))
