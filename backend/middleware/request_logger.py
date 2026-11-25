"""
middleware/request_logger.py
============================
ASGI middleware that logs every HTTP request + response to MongoDB.

Design principles:
  * NEVER raises.  Any error inside the logger is caught and logged to
    stderr; the original request/response is always delivered intact.
  * Non-blocking.  The MongoDB write is fired with asyncio.create_task
    AFTER the response body has been fully sent.
  * Bodies are scrubbed (sensitive keys redacted) and truncated at 50 KB.
  * Routes under /api/admin/logs are excluded to avoid log spam.
  * Binary content types (multipart, octet-stream, image/*, audio/*)
    have their bodies recorded as '<binary body not captured>'.

MongoDB collection: debug_logs
TTL index (7 days) is created by the server startup hook.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from datetime import datetime, timezone
from typing import Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from services.log_scrubber import scrub, truncate_bytes

logger = logging.getLogger("dhara.request_logger")

# Skip logging for the debug dashboard itself
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
    """Best-effort parse; returns a string snippet on failure."""
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
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        # Skip the admin-logs dashboard to avoid circular log spam
        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        start_ms = time.monotonic() * 1000

        # ── Collect request headers ────────────────────────────────────────
        headers: dict[str, str] = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        content_type = headers.get("content-type", "")
        binary_body = _is_binary(content_type)

        # ── Buffer request body ────────────────────────────────────────────
        req_body_chunks: list[bytes] = []
        more_body = True

        async def buffered_receive() -> Message:
            nonlocal more_body
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                if chunk and not binary_body:
                    req_body_chunks.append(chunk)
                more_body = message.get("more_body", False)
            return message

        # ── Capture response status + body ────────────────────────────────
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
                if chunk and not _is_binary(res_content_type):
                    res_body_chunks.append(chunk)
            await send(message)

        # ── Run the actual request ────────────────────────────────────────
        exc_text: str | None = None
        try:
            await self.app(scope, buffered_receive, capturing_send)
        except Exception:
            exc_text = traceback.format_exc()
            raise
        finally:
            # Fire-and-forget — never block the caller
            asyncio.create_task(
                _write_log(
                    scope=scope,
                    headers=headers,
                    status_code=status_code,
                    start_ms=start_ms,
                    req_raw=truncate_bytes(b"".join(req_body_chunks)) if not binary_body else None,
                    res_raw=truncate_bytes(b"".join(res_body_chunks)) if not _is_binary(res_content_type) else None,
                    exc_text=exc_text,
                    binary_body=binary_body,
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
) -> None:
    try:
        from dependencies import db as _db

        duration_ms = round(time.monotonic() * 1000 - start_ms, 1)
        user_id, user_email = _extract_user(headers)

        method = scope.get("method", "?")
        path = scope.get("path", "/")
        qs = scope.get("query_string", b"").decode("latin-1", errors="replace")
        full_path = f"{path}{'?' + qs if qs else ''}"

        req_body_obj: object = (
            "<binary body not captured>" if binary_body
            else scrub(_safe_json(req_raw)) if req_raw
            else None
        )
        res_body_obj: object = (
            scrub(_safe_json(res_raw)) if res_raw else None
        )

        # Extract error message for quick search
        error_msg: str | None = None
        if exc_text:
            error_msg = exc_text.splitlines()[-1][:300] if exc_text else None
        elif isinstance(res_body_obj, dict):
            error_msg = str(res_body_obj.get("detail", ""))[:300] or None

        doc = {
            "ts": datetime.now(timezone.utc),   # datetime for TTL
            "user_id": user_id,
            "user_email": user_email,
            "method": method,
            "path": path,
            "full_path": full_path,
            "status": status_code,
            "duration_ms": duration_ms,
            "req_body": req_body_obj,
            "res_body": res_body_obj,
            "error_msg": error_msg,
            "stack_trace": exc_text,
        }
        await _db.debug_logs.insert_one(doc)
    except Exception as e:
        logger.debug("[request_logger] write failed (non-fatal): %s", e)
