"""
DHARA FIR Evidence Storage — Emergent Object Storage wrapper.
Handles multipart file uploads for FIR evidence attachments.
"""
from __future__ import annotations

import os
import uuid
import mimetypes
import logging
from concurrent.futures import ThreadPoolExecutor
import asyncio
from dotenv import load_dotenv
import requests

load_dotenv()

logger = logging.getLogger("fir_storage")

APP_NAME = "dhara-legal-aid"

_STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() \
    or "https://integrations.emergentagent.com"
STORAGE_URL = _STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

_storage_key: str | None = None
_executor = ThreadPoolExecutor(max_workers=4)


def _init_storage_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": EMERGENT_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = _storage_key or _init_storage_sync()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        # Stale key — reinit once
        _storage_key = None
        key = _init_storage_sync()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def _get_object_sync(path: str) -> tuple[bytes, str]:
    key = _storage_key or _init_storage_sync()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def init_storage() -> None:
    """Call at startup — initialises the storage key."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(_executor, _init_storage_sync)
        logger.info("[fir_storage] Emergent Object Storage initialised")
    except Exception as e:
        logger.warning(f"[fir_storage] Storage init failed (uploads will retry): {e}")


async def upload_evidence(
    user_id: str,
    session_id: str,
    filename: str,
    data: bytes,
    content_type: str,
) -> dict:
    """
    Upload one evidence file to Emergent Object Storage.
    Returns metadata dict to store in session.evidence_files.
    """
    ext = (mimetypes.guess_extension(content_type) or "").lstrip(".")
    if not ext:
        ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
    file_id = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/uploads/{user_id}/{file_id}.{ext}"

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _executor, _put_object_sync, storage_path, data, content_type
    )
    file_type = _classify_type(content_type)
    return {
        "file_id": file_id,
        "filename": filename,
        "storage_path": result.get("path", storage_path),
        "file_type": file_type,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "caption": "",  # Issue 17: caption field for evidence annex
    }


async def download_evidence(storage_path: str) -> tuple[bytes, str]:
    """Download an evidence file from Emergent Object Storage."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _get_object_sync, storage_path)


def _delete_object_sync(path: str) -> None:
    key = _storage_key or _init_storage_sync()
    try:
        resp = requests.delete(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=30,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"[fir_storage] Delete failed for {path}: {e}")


async def delete_evidence(storage_path: str) -> None:
    """Delete an evidence file from Emergent Object Storage (best-effort)."""
    if not storage_path:
        return
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, _delete_object_sync, storage_path)


def _classify_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type == "application/pdf":
        return "pdf"
    return "document"


# ── Generic path wrappers (S-B5: Evidence Vault) ─────────────────────────────
# Unlike upload_evidence() above (which owns its own user/session path
# layout), these let other modules control the storage path directly —
# used by api/evidence_vault_router.py to store Evidence Locker ciphertext
# under its own namespace. Same storage key + retry logic underneath.

async def put_raw_bytes(path: str, data: bytes, content_type: str) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _put_object_sync, path, data, content_type)


async def get_raw_bytes(path: str) -> tuple[bytes, str]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _get_object_sync, path)


async def delete_raw_object(path: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, _delete_object_sync, path)
