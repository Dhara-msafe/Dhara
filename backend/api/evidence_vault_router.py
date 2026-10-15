"""Evidence Vault — Sprint B5 cloud anchor + chunked encrypted backup.

Non-negotiables honoured:
  * The server NEVER sees plaintext evidence. Capture, AES-256 encryption and
    the SHA-256 hash chain all happen on-device (see frontend
    src/women/evidenceManifest.ts). Only the resulting ciphertext bytes and
    hash/metadata ever reach this router — never a transcript, photo content,
    or anything the citizen did not explicitly choose to anchor/back up.
  * GPS is optional, opt-in per item, and stored only when the citizen chose
    to attach it on-device before calling /evidence/anchor.
  * Gated behind the existing `evidence_locker_enabled` feature flag (same
    flag Women's Shield already uses) so an admin can disable cloud
    anchor/backup without touching the always-available local encryption.
  * No admin key required — these are citizen-facing endpoints, consistent
    with the rest of Women's Shield's public routes.
"""
import base64
import hashlib
import hmac
import re
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator

from dependencies import db, logger, current_user
from config.settings import JWT_SECRET
from fir_storage import put_raw_bytes, delete_raw_object
from api.women_router import get_flags

router = APIRouter()

HEX64 = re.compile(r"^[0-9a-f]{64}$")
TMP_ROOT = Path(tempfile.gettempdir()) / "dhara_evidence_chunks"
TMP_ROOT.mkdir(parents=True, exist_ok=True)

MAX_CHUNK_B64_BYTES = 1 * 1024 * 1024  # generous headroom over a 256KB raw chunk
MAX_TOTAL_CHUNKS = 4000  # generous ceiling for a 2-min video at low quality


async def _flags_or_503() -> None:
    flags = await get_flags()
    if not flags.get("evidence_vault_enabled"):
        raise HTTPException(503, "Evidence vault cloud features are not enabled on this server.")


def _owner_filter(user_id: str) -> dict:
    """E2/A2: rows are owned by user_id. Legacy rows (pre-migration) carry no
    user_id yet, so they fall back to scope — which E1 already pinned to the
    authenticated user's id at write time."""
    return {"$or": [{"user_id": user_id}, {"user_id": {"$exists": False}, "scope": user_id}]}


# ── Anchor: independent timestamp + tamper-evidence receipt ─────────────────

class GpsIn(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


class AnchorIn(BaseModel):
    item_id: str
    scope: str
    type: str
    manifest_hash: str   # SHA-256 of the ciphertext bytes, computed on-device
    chain_hash: str       # SHA256(prev_hash|manifest_hash|item_id|device_time)
    prev_hash: str         # genesis = 64 zero-chars for the first item in a chain
    device_time: str
    gps: Optional[GpsIn] = None

    @field_validator("manifest_hash", "chain_hash", "prev_hash")
    @classmethod
    def _hex(cls, v):
        if not HEX64.match(v or ""):
            raise ValueError("must be a 64-character hex SHA-256 digest")
        return v


@router.post("/evidence/anchor")
async def anchor_evidence(body: AnchorIn, user: dict = Depends(current_user)):
    """Stores ONLY hashes + capture metadata — never file content.
    E1 hardening: scope is always the authenticated user's id; any
    client-supplied body.scope is accepted for parsing but ignored."""
    await _flags_or_503()
    scope = user["id"]
    server_time = datetime.now(timezone.utc).isoformat()
    receipt_id = str(uuid.uuid4())
    msg = f"{body.item_id}|{body.manifest_hash}|{body.chain_hash}|{server_time}"
    signature = hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    doc = {
        "receipt_id": receipt_id,
        "item_id": body.item_id,
        "user_id": user["id"],
        "scope": scope,
        "type": body.type,
        "manifest_hash": body.manifest_hash,
        "chain_hash": body.chain_hash,
        "prev_hash": body.prev_hash,
        "device_time": body.device_time,
        "server_time": server_time,
        "gps": body.gps.model_dump() if body.gps else None,
        "signature": signature,
        "created_at": server_time,
    }
    await db.evidence_anchors.insert_one(doc)
    logger.info("[evidence_vault] anchored item scope=%s gps=%s", scope, bool(body.gps))
    return {
        "receipt_id": receipt_id,
        "server_time": server_time,
        "signature": signature,
        "item_id": body.item_id,
        "manifest_hash": body.manifest_hash,
        "chain_hash": body.chain_hash,
    }


@router.get("/evidence/anchor/{item_id}")
async def get_anchor(item_id: str, scope: str = "", user: dict = Depends(current_user)):
    # E1 hardening: `scope` query param kept for frontend backward-compat but
    # ignored — only the authenticated user's own id is trusted server-side.
    await _flags_or_503()
    doc = await db.evidence_anchors.find_one({"item_id": item_id, **_owner_filter(user["id"])}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "No anchor receipt found for this item.")
    return doc


@router.delete("/evidence/anchor/{item_id}")
async def delete_anchor(item_id: str, user: dict = Depends(current_user)):
    """Owner-checked. A non-owner gets the same 404 as a missing item, so the
    response never confirms that someone else's item_id exists."""
    result = await db.evidence_anchors.delete_many({"item_id": item_id, **_owner_filter(user["id"])})
    if result.deleted_count == 0:
        raise HTTPException(404, "No anchor receipt found for this item.")
    return {"ok": True, "deleted": result.deleted_count}


# ── Chunked encrypted upload — server only ever handles ciphertext bytes ────

class UploadInitIn(BaseModel):
    item_id: str
    scope: str
    total_chunks: int = Field(gt=0, le=MAX_TOTAL_CHUNKS)
    ext: str = "bin"
    iv: str = ""
    manifest_hash: Optional[str] = None


@router.post("/evidence/upload/init")
async def upload_init(body: UploadInitIn, user: dict = Depends(current_user)):
    await _flags_or_503()
    session_id = str(uuid.uuid4())
    (TMP_ROOT / session_id).mkdir(parents=True, exist_ok=True)
    await db.evidence_upload_sessions.insert_one({
        "session_id": session_id,
        "item_id": body.item_id,
        "user_id": user["id"],
        "scope": user["id"],  # E1 hardening: authenticated scope; body.scope ignored
        "total_chunks": body.total_chunks,
        "ext": body.ext,
        "iv": body.iv,
        "manifest_hash": body.manifest_hash,
        "created_at": time.time(),
    })
    return {"session_id": session_id}


class UploadChunkIn(BaseModel):
    session_id: str
    index: int = Field(ge=0)
    data_b64: str


@router.post("/evidence/upload/chunk")
async def upload_chunk(body: UploadChunkIn, user: dict = Depends(current_user)):
    await _flags_or_503()
    if len(body.data_b64) > MAX_CHUNK_B64_BYTES:
        raise HTTPException(413, "Chunk too large.")
    session = await db.evidence_upload_sessions.find_one({"session_id": body.session_id, **_owner_filter(user["id"])})
    if not session:
        raise HTTPException(404, "Upload session not found or expired. Please retry the backup.")
    if body.index >= session["total_chunks"]:
        raise HTTPException(400, "Chunk index out of range.")
    session_dir = TMP_ROOT / body.session_id
    if not session_dir.exists():
        raise HTTPException(404, "Upload session expired. Please retry the backup.")
    try:
        raw = base64.b64decode(body.data_b64, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid chunk data.")
    (session_dir / f"{body.index:06d}.part").write_bytes(raw)
    return {"received": body.index}


class UploadCompleteIn(BaseModel):
    session_id: str


@router.post("/evidence/upload/complete")
async def upload_complete(body: UploadCompleteIn, user: dict = Depends(current_user)):
    await _flags_or_503()
    session = await db.evidence_upload_sessions.find_one({"session_id": body.session_id, **_owner_filter(user["id"])})
    if not session:
        raise HTTPException(404, "Upload session not found or expired. Please retry the backup.")
    session_dir = TMP_ROOT / body.session_id
    total = session["total_chunks"]
    buf = bytearray()
    for i in range(total):
        part = session_dir / f"{i:06d}.part"
        if not part.exists():
            raise HTTPException(400, f"Missing chunk {i}. Please retry the backup.")
        buf.extend(part.read_bytes())
    storage_path = f"dhara-legal-aid/evidence_vault/{session['scope']}/{session['item_id']}.enc"
    try:
        result = await put_raw_bytes(storage_path, bytes(buf), "application/octet-stream")
    finally:
        shutil.rmtree(session_dir, ignore_errors=True)
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid.uuid4()),
        "item_id": session["item_id"],
        "user_id": user["id"],
        "scope": session["scope"],
        "storage_path": result.get("path", storage_path),
        "ext": session.get("ext"),
        "iv": session.get("iv"),
        "manifest_hash": session.get("manifest_hash"),
        "size": result.get("size", len(buf)),
        "uploaded_at": now,
    }
    await db.evidence_backups.update_one(
        {"item_id": session["item_id"], "scope": session["scope"]},
        {"$set": record},
        upsert=True,
    )
    await db.evidence_upload_sessions.delete_one({"session_id": body.session_id})
    logger.info("[evidence_vault] backed up scope=%s size=%s", session["scope"], record["size"])
    return record


@router.get("/evidence/backups")
async def list_backups(scope: str = "", user: dict = Depends(current_user)):
    # E2/A2: `scope` query param kept for backward-compat but ignored.
    cursor = db.evidence_backups.find(_owner_filter(user["id"]), {"_id": 0})
    return {"items": await cursor.to_list(length=500)}


@router.delete("/evidence/backups/{item_id}")
async def delete_backup(item_id: str, scope: str = "", user: dict = Depends(current_user)):
    """Owner-checked. Non-owner and missing item get the same 404."""
    query = {"item_id": item_id, **_owner_filter(user["id"])}
    doc = await db.evidence_backups.find_one(query)
    if not doc:
        raise HTTPException(404, "No backup found for this item.")
    await delete_raw_object(doc["storage_path"])
    await db.evidence_backups.delete_one({"_id": doc["_id"]})
    return {"ok": True, "deleted": True}


async def cleanup_stale_upload_sessions() -> None:
    """Startup fire-and-forget: sweep upload temp dirs left behind by a
    crashed/abandoned backup so /tmp never grows unbounded."""
    try:
        cutoff = time.time() - 2 * 3600
        async for session in db.evidence_upload_sessions.find({"created_at": {"$lt": cutoff}}):
            shutil.rmtree(TMP_ROOT / session["session_id"], ignore_errors=True)
            await db.evidence_upload_sessions.delete_one({"session_id": session["session_id"]})
        if TMP_ROOT.exists():
            for child in TMP_ROOT.iterdir():
                try:
                    if child.is_dir() and child.stat().st_mtime < cutoff:
                        shutil.rmtree(child, ignore_errors=True)
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"[evidence_vault] stale session cleanup warning: {e}")
