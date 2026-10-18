"""Emergent Managed Object Storage client — profile photos only.

Other upload paths in this app (FIR evidence) use local disk via
fir_storage.py and are intentionally left untouched by this module.

Service contract (per Emergent Object Storage playbook):
  POST {STORAGE_URL}/init            -> {"storage_key": ...}
  PUT  {STORAGE_URL}/objects/{path}  -> upload (silently overwrites)
  GET  {STORAGE_URL}/objects/{path}  -> download

`requests` is sync -> every call MUST go through run_in_threadpool so it
never blocks the event loop.
"""
from __future__ import annotations

import logging
import os

import requests
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("object_storage")

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")

# Real app identity — one bucket is shared across every app this Emergent
# user builds, so this prefix is the only thing separating our objects.
APP_NAME = "msafe-legal-aid"

_storage_key: str | None = None


def _init_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_sync()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        # Stale key — reset and retry once.
        global _storage_key
        _storage_key = None
        key = _init_sync()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def _get_sync(path: str) -> tuple[bytes, str]:
    key = _init_sync()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def init_storage() -> str | None:
    """Best-effort startup warm-up — never raises, logs and continues if the
    integration isn't reachable (profile photo upload will fail gracefully
    per-request instead of blocking app startup)."""
    try:
        return await run_in_threadpool(_init_sync)
    except Exception as e:
        logger.warning("[object_storage] init failed at startup (will retry per-request): %s", e)
        return None


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await run_in_threadpool(_put_sync, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await run_in_threadpool(_get_sync, path)
