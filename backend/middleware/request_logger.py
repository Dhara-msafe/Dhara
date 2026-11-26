"""
middleware/request_logger.py
============================
ASGI middleware that logs every HTTP request + response to MongoDB.

Feature flags (both default OFF in production):
  DEBUG_LOG_ENABLED=true   — activate the middleware at all; without this
                             every request passes through with zero overhead
  DEBUG_LOG_BODIES=true    — also store scrubbed req/res bodies; without this
                             only ts, method, path, full_path, status,
                             duration_ms, user_id, user_email, error_msg and
                             stack_trace are written (no user content at all)

Design principles:
  * NEVER raises.  Any error inside the logger is caught and logged to
    stderr; the original request/response is always delivered intact.
  * Non-blocking.  The MongoDB write fires with asyncio.create_task
    AFTER the response body has been fully sent.
  * Bodies (when captured) are scrubbed before storage — see
    services/log_scrubber.py for the full redaction list.
  * Routes under /api/admin/logs are excluded to avoid circular log spam.
  * Binary content types (multipart, octet-stream, image/*, audio/*)
    have their bodies recorded as '<binary body not captured>'.

MongoDB collection: debug_logs
TTL index (7 days) is created by the server startup hook in server.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import traceback
from datetime import datetime, timezone

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from services.log_scrubber import scrub, truncate_bytes

logger = logging.getLogger("dhara.request_logger")

# ── Feature flags ─────────────────────────────────────────────────────────────
_LOG_ENABLED = os.environ.get("DEBUG_LOG_ENABLED", "").lower() in ("1", "true", "yes")
_LOG_BODIES  = os.environ.get("DEBUG_LOG_BODIES",  "").lower() in ("1", "true", "yes")

# Skip logging for the debug-dashboard routes (avoid circular log spam)
_SKIP_PREFIXES = ("/api/admin/logs",)

# Skip capturing body for binary content types
_BINARY_TYPES = (
    "multipart/", "application/octet-stream",
    "image/", "audio/", "video/",
)


def _is_binary(content_type: str) -> bool:
    ct = (content_type or "").lower()
    return any(ct.startswith(b) for b in _BINARY_TYPES)


def _safe_json(raw: bytes) -> object:
    """Best-effort JSON parse; returns a string snippet on failure."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        snippet = raw[:200].decode("utf-8", errors="replace")
        return f"<non-JSON: {snippet}>"


def _extract_user(headers: dict[str, str]) -> tuple[str | None, str | None]:
    """Try to decode the JWT and return (user_id, email) without raising."""
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None, None
    try:
        import jwt as _jwt
        from config.settings import JWT_SECRET, JWT_ALG
        raw_token = auth.split(" ", 1)[1]
        payload = _jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub"), payload.get("email")
    except Exception:
        return None, None


class RequestLoggerMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Pass through immediately when logging is disabled — zero overhead.
        if not _LOG_ENABLED or scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        start_ms = time.monotonic() * 1000

        # ── Collect request headers ───────────────────────────────────────────
        headers: dict[str, str] = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        content_type = headers.get("content-type", "")
        capture_body = _LOG_BODIES and not _is_binary(content_type)

        # ── Buffer request body (only when _LOG_BODIES is on) ─────────────────
        req_body_chunks: list[bytes] = []

        async def buffered_receive() -> Message:
            message = await receive()
            if capture_body and message["type"] == "http.request":
                chunk = message.get("body", b"")
                if chunk:
                    req_body_chunks.append(chunk)
            return message

        # ── Capture response status + body ────────────────────────────────────
        status_code = 500
        res_body_chunks: list[bytes] = []
        res_content_type = ""

        async def capturing_send(message: Message) -> None:
            nonlocal status_code, res_content_type
            if message["type"] == "http.response.start":
                status_code = message.get("status", 500)
                for k, v in message.get("headers", []):
                    if k.lower() == b"content-type":
                        res_content_type = v.decode("latin-1", errors="replace")
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                # Always capture response body when status >= 400 (for error_msg),
                # or when full body logging is enabled.
                if chunk and (status_code >= 400 or (_LOG_BODIES and not _is_binary(res_content_type))):
                    res_body_chunks.append(chunk)
            await send(message)

        # ── Run the actual request ─────────────────────────────────────────────
        exc_text: str | None = None
        try:
            await self.app(scope, buffered_receive, capturing_send)
        except Exception:
            exc_text = traceback.format_exc()
            raise
        finally:
            asyncio.create_task(
                _write_log(
                    scope=scope,
                    headers=headers,
                    status_code=status_code,
                    start_ms=start_ms,
                    req_raw=truncate_bytes(b"".join(req_body_chunks)) if capture_body else None,
                    res_raw=truncate_bytes(b"".join(res_body_chunks)) if res_body_chunks else None,
                    exc_text=exc_text,
                    binary_body=_is_binary(content_type),
                    store_bodies=_LOG_BODIES,
                )
            )


async def _write_log(
    *,
    scope: Scope,
    headers: dict[str, str],
    status_code: int,
    start_ms: float,
    req_raw: bytes | None,
    res_raw: bytes | None,
    exc_text: str | None,
    binary_body: bool,
    store_bodies: bool,
) -> None:
    try:
        from dependencies import db as _db

        duration_ms = round(time.monotonic() * 1000 - start_ms, 1)
        user_id, user_email = _extract_user(headers)

        method = scope.get("method", "?")
        path   = scope.get("path", "/")
        qs     = scope.get("query_string", b"").decode("latin-1", errors="replace")
        full_path = f"{path}{'?' + qs if qs else ''}"

        # ── Build body fields (only when DEBUG_LOG_BODIES=true) ───────────────
        req_body_obj: object = None
        res_body_obj: object = None
        if store_bodies:
            if binary_body:
                req_body_obj = "<binary body not captured>"
            elif req_raw:
                req_body_obj = scrub(_safe_json(req_raw))

            if res_raw and not _is_binary(""):
                res_body_obj = scrub(_safe_json(res_raw))

        # ── Extract error_msg (always, even without body storage) ─────────────
        error_msg: str | None = None
        if exc_text:
            error_msg = exc_text.splitlines()[-1][:300]
        elif res_raw:
            # We always capture error response bodies for error_msg extraction
            try:
                res_obj = json.loads(res_raw)
                if isinstance(res_obj, dict):
                    error_msg = str(res_obj.get("detail", ""))[:300] or None
            except Exception:
                pass

        doc = {
            "ts":          datetime.now(timezone.utc),
            "user_id":     user_id,
            "user_email":  user_email,
            "method":      method,
            "path":        path,
            "full_path":   full_path,
            "status":      status_code,
            "duration_ms": duration_ms,
            # Bodies: None unless DEBUG_LOG_BODIES=true
            "req_body":    req_body_obj,
            "res_body":    res_body_obj,
            "error_msg":   error_msg,
            "stack_trace": exc_text,
        }
        await _db.debug_logs.insert_one(doc)
    except Exception as e:
        logger.debug("[request_logger] write failed (non-fatal): %s", e)
