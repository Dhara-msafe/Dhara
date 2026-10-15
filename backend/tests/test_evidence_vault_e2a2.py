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
BASE = "http://localhost:8001/api"
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
