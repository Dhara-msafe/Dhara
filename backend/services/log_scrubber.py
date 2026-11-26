"""
log_scrubber.py
===============
Recursive key-based scrubber used by the request-logger middleware.

Any dict key whose name *contains* a banned substring (case-insensitive)
has its value replaced with '[redacted]'. The key name is preserved so
the log structure stays readable.

Default banned substrings (two groups):

  Credentials / auth:
    password, token, secret, key, authorization, aadhaar, otp, pin, hash

  PII / personally-identifiable and sensitive content:
    phone, mobile, email,
    lat, lng, latitude, longitude, location, coords,
    message, text, transcript, query, question,
    content, address, dob

Extra substrings can be added without a deploy by setting the env variable:
    LOG_SCRUB_EXTRA=cvv,ssn,nid
(comma-separated, appended to the default list)

Bodies larger than MAX_BODY_BYTES (50 KB) are truncated before scrubbing.
"""
from __future__ import annotations

import os
from typing import Any

MAX_BODY_BYTES: int = 50_000  # 50 KB hard cap before we store anything

_DEFAULT_BANNED = [
    # ── credentials / auth ────────────────────────────────────────────────────
    "password", "token", "secret", "key", "authorization",
    "aadhaar", "otp", "pin", "hash",
    # ── PII: contact ──────────────────────────────────────────────────────────
    "phone", "mobile", "email",
    # ── PII: location ─────────────────────────────────────────────────────────
    "lat", "lng", "latitude", "longitude", "location", "coords",
    # ── PII: free-text content (may contain user-entered personal info) ───────
    "message", "text", "transcript", "query", "question",
    "content", "address", "dob",
]


def _banned_substrings() -> list[str]:
    extra = os.environ.get("LOG_SCRUB_EXTRA", "")
    extra_list = [s.strip().lower() for s in extra.split(",") if s.strip()]
    return _DEFAULT_BANNED + extra_list


def scrub(obj: Any, _depth: int = 0) -> Any:
    """Return a scrubbed deep-copy of *obj*.

    Traverses dicts and lists up to 20 levels deep.  Anything deeper is
    replaced with the string '<truncated: depth limit>'.  This prevents
    accidental infinite recursion on pathological payloads.
    """
    if _depth > 20:
        return "<truncated: depth limit>"

    banned = _banned_substrings()

    if isinstance(obj, dict):
        result: dict = {}
        for k, v in obj.items():
            k_lower = str(k).lower()
            if any(b in k_lower for b in banned):
                result[k] = "[redacted]"
            else:
                result[k] = scrub(v, _depth + 1)
        return result

    if isinstance(obj, list):
        return [scrub(item, _depth + 1) for item in obj]

    return obj


def truncate_bytes(raw: bytes) -> bytes:
    """Cap raw bytes at MAX_BODY_BYTES before JSON-parsing."""
    if len(raw) <= MAX_BODY_BYTES:
        return raw
    return raw[:MAX_BODY_BYTES]
