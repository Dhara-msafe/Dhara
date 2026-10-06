"""AI Gateway — central provider selection, retries, fallback, structured logging.

All LLM calls in the app MUST flow through this module. Never instantiate
`LlmChat(...).with_model(...)` directly in a router — call `build_chat(...)`
here instead. That way:

  • Provider and model IDs are read once from `config/settings.py` (env-driven).
  • A failing primary model transparently falls back to the secondary.
  • Every call gets a stable `error_id` and structured log line, so the same
    trace ID reaches the client and the log analyser.
  • Provider abstraction — swapping Emergent for a company-owned key later
    is a one-line change here, not a search-and-replace across routes.

The gateway keeps a very thin surface (drop-in for existing `.with_model`
callers) so migration from ad-hoc calls is mechanical.

Sprint-brief mapping:
  Part 2  (Centralized AI Model Configuration)     → build_chat / MODEL_REGISTRY
  Part 3  (Provider abstraction / EMERGENT_OFF)    → PROVIDER + api_key resolver
  Part 25 (Graceful AI failure)                    → call_with_fallback / stream_with_fallback
  Part 18 (Observability with error IDs)           → _log_call + error_id return
"""
from __future__ import annotations

import os
import time
import uuid
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, TextDelta, StreamDone

from config.settings import (
    EMERGENT_LLM_KEY,
    SERVER_CHAT_PROVIDER,
    SERVER_CHAT_MODEL,
    SERVER_CHAT_FALLBACK_MODEL,
    TRANSLATE_PROVIDER,
    TRANSLATE_MODEL,
    SCAN_PROVIDER,
    SCAN_MODEL,
)

logger = logging.getLogger("ai_gateway")

# ── Provider registry ─────────────────────────────────────────────────────────
# Adding a new provider is a single-line edit here + a settings-file model ID.

@dataclass(frozen=True)
class ModelSpec:
    provider: str
    model: str
    timeout_s: float = 60.0
    max_retries: int = 1


PRIMARY = ModelSpec(
    provider=SERVER_CHAT_PROVIDER,
    model=SERVER_CHAT_MODEL,
    timeout_s=float(os.getenv("CHAT_TIMEOUT_S", "60")),
    max_retries=int(os.getenv("CHAT_MAX_RETRIES", "1")),
)

FALLBACK = ModelSpec(
    provider=SERVER_CHAT_PROVIDER,          # Same provider, cheaper model.
    model=SERVER_CHAT_FALLBACK_MODEL,
    timeout_s=float(os.getenv("CHAT_FALLBACK_TIMEOUT_S", "45")),
    max_retries=0,
)

# Task-specific specs — still centralised, still env-driven, just a different
# (cheaper, task-tuned) model than the main chat spec above.
TRANSLATE_SPEC = ModelSpec(
    provider=TRANSLATE_PROVIDER,
    model=TRANSLATE_MODEL,
    timeout_s=float(os.getenv("TRANSLATE_TIMEOUT_S", "30")),
    max_retries=0,
)

SCAN_SPEC = ModelSpec(
    provider=SCAN_PROVIDER,
    model=SCAN_MODEL,
    timeout_s=float(os.getenv("SCAN_TIMEOUT_S", "90")),
    max_retries=0,
)

# ── API-key resolver ──────────────────────────────────────────────────────────
# `EMERGENT_OFF=1` flips the app onto a company-owned key (COMPANY_LLM_KEY),
# giving us a smooth exit from the Emergent runtime with zero code changes in
# routes. Defaults to the Emergent key so nothing regresses today.

def _api_key() -> str:
    if os.getenv("EMERGENT_OFF", "").lower() in ("1", "true", "yes"):
        k = os.getenv("COMPANY_LLM_KEY") or ""
        if k:
            return k
        logger.warning("[ai_gateway] EMERGENT_OFF set but COMPANY_LLM_KEY empty; falling back to Emergent key")
    return EMERGENT_LLM_KEY


# ── Public API ────────────────────────────────────────────────────────────────

def build_chat(
    session_id: str,
    system_message: str,
    *,
    spec: ModelSpec = PRIMARY,
) -> LlmChat:
    """Return an LlmChat configured with the gateway's primary provider/model.

    Existing callers can migrate by replacing
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=..., system_message=...) \
            .with_model(SERVER_CHAT_PROVIDER, SERVER_CHAT_MODEL)
    with
        build_chat(session_id=..., system_message=...)
    — same object contract, but the model is picked centrally.
    """
    return LlmChat(
        api_key=_api_key(),
        session_id=session_id,
        system_message=system_message,
    ).with_model(spec.provider, spec.model)


async def send_with_fallback(
    session_id: str,
    system_message: str,
    user_text: str,
    *,
    spec: ModelSpec = PRIMARY,
    fallback_spec: Optional[ModelSpec] = None,
    caller: str = "unknown",
) -> tuple[str, Optional[str], str]:
    """One-shot send with automatic fallback on primary failure.

    `spec`/`fallback_spec` default to the main chat PRIMARY/FALLBACK pair, but
    any caller (e.g. translation) can pass its own task-specific spec pair —
    still centrally defined above, never hard-coded in the router itself.

    Returns: (reply_text, error_message_or_None, error_id)
    On total failure both models fail → returns ("", user-facing_message, error_id).
    """
    fallback_spec = fallback_spec or FALLBACK
    error_id = str(uuid.uuid4())[:8]
    primary_err: Optional[str] = None

    # ── Try primary ──
    try:
        t0 = time.time()
        chat = build_chat(session_id, system_message, spec=spec)
        reply = await chat.send_message(UserMessage(text=user_text))
        _log_call(caller, spec, "ok", time.time() - t0, error_id, None)
        return str(reply or ""), None, error_id
    except Exception as e:
        primary_err = _short(e)
        _log_call(caller, spec, "error", None, error_id, primary_err)

    # ── Try fallback ──
    try:
        t0 = time.time()
        chat = build_chat(session_id, system_message, spec=fallback_spec)
        reply = await chat.send_message(UserMessage(text=user_text))
        _log_call(caller, fallback_spec, "ok_after_fallback", time.time() - t0, error_id, None)
        return str(reply or ""), None, error_id
    except Exception as e2:
        fb_err = _short(e2)
        _log_call(caller, fallback_spec, "error_fallback", None, error_id, fb_err)
        return "", (
            f"The AI explanation service is temporarily unavailable. "
            f"Please try again in a moment. (ref {error_id})"
        ), error_id


async def send_vision_with_fallback(
    session_id: str,
    system_message: str,
    user_text: str,
    image_base64: str,
    *,
    spec: ModelSpec = SCAN_SPEC,
    fallback_spec: Optional[ModelSpec] = None,
    caller: str = "unknown",
) -> tuple[str, Optional[str], str]:
    """Vision variant of send_with_fallback — attaches a base64 image to the
    user message. Falls back to a second attempt (same spec by default, since
    no separate vision fallback model is configured today) on primary failure.

    Returns: (reply_text, error_message_or_None, error_id)
    """
    fallback_spec = fallback_spec or spec
    error_id = str(uuid.uuid4())[:8]

    for attempt_spec, status_ok, status_err in (
        (spec, "ok", "error"),
        (fallback_spec, "ok_after_fallback", "error_fallback"),
    ):
        try:
            t0 = time.time()
            chat = build_chat(session_id, system_message, spec=attempt_spec)
            reply = await chat.send_message(UserMessage(
                text=user_text,
                file_contents=[ImageContent(image_base64=image_base64)],
            ))
            _log_call(caller, attempt_spec, status_ok, time.time() - t0, error_id, None)
            return str(reply or ""), None, error_id
        except Exception as e:
            _log_call(caller, attempt_spec, status_err, None, error_id, _short(e))

    return "", (
        f"The document scanner is temporarily unavailable. "
        f"Please try again in a moment. (ref {error_id})"
    ), error_id


async def stream_with_fallback(
    session_id: str,
    system_message: str,
    user_text: str,
    *,
    caller: str = "unknown",
) -> AsyncIterator[dict]:
    """Async generator yielding dicts:
        {"type":"delta","content":"..."}
        {"type":"error","error":"...","error_id":"..."}
        {"type":"done"}

    Falls back to secondary model only if the primary fails BEFORE emitting
    the first delta. Mid-stream failures cannot be silently retried without
    corrupting the reply, so those surface as an error frame — the caller
    can choose to append a friendly "ref {error_id}" tail to what streamed
    so far.
    """
    error_id = str(uuid.uuid4())[:8]
    first_delta_seen = False

    try:
        t0 = time.time()
        chat = build_chat(session_id, system_message, spec=PRIMARY)
        async for ev in chat.stream_message(UserMessage(text=user_text)):
            if isinstance(ev, TextDelta):
                first_delta_seen = True
                yield {"type": "delta", "content": ev.content}
            elif isinstance(ev, StreamDone):
                break
        _log_call(caller, PRIMARY, "ok_stream", time.time() - t0, error_id, None)
        yield {"type": "done"}
        return
    except Exception as e:
        primary_err = _short(e)
        _log_call(caller, PRIMARY, "stream_error", None, error_id, primary_err)
        if first_delta_seen:
            yield {
                "type": "error",
                "error": f"Reply was cut off — please retry. (ref {error_id})",
                "error_id": error_id,
            }
            return

    # Primary failed before any delta → fallback.
    try:
        t0 = time.time()
        chat = build_chat(session_id, system_message, spec=FALLBACK)
        async for ev in chat.stream_message(UserMessage(text=user_text)):
            if isinstance(ev, TextDelta):
                yield {"type": "delta", "content": ev.content}
            elif isinstance(ev, StreamDone):
                break
        _log_call(caller, FALLBACK, "ok_stream_after_fallback", time.time() - t0, error_id, None)
        yield {"type": "done"}
    except Exception as e2:
        fb_err = _short(e2)
        _log_call(caller, FALLBACK, "stream_error_fallback", None, error_id, fb_err)
        yield {
            "type": "error",
            "error": (
                f"The AI explanation service is temporarily unavailable. "
                f"Please try again in a moment. (ref {error_id})"
            ),
            "error_id": error_id,
        }


# ── Diagnostics ────────────────────────────────────────────────────────────────

def gateway_status() -> dict:
    """Snapshot for /health/ready and admin panels."""
    return {
        "primary": {"provider": PRIMARY.provider, "model": PRIMARY.model},
        "fallback": {"provider": FALLBACK.provider, "model": FALLBACK.model},
        "emergent_off": os.getenv("EMERGENT_OFF", "").lower() in ("1", "true", "yes"),
        "api_key_present": bool(_api_key()),
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _log_call(
    caller: str,
    spec: ModelSpec,
    status: str,
    elapsed: Optional[float],
    error_id: str,
    err: Optional[str],
) -> None:
    line = (
        f"[ai_gateway] caller={caller} provider={spec.provider} model={spec.model} "
        f"status={status} error_id={error_id}"
    )
    if elapsed is not None:
        line += f" elapsed_ms={int(elapsed*1000)}"
    if err:
        line += f" err={err[:200]}"
    if status.startswith("error") or status.startswith("stream_error"):
        logger.warning(line)
    else:
        logger.info(line)


def _short(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"[:300]
