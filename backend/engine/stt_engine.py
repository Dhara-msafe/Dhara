"""
stt_engine.py — Whisper transcription core, extracted for testability.

Production entry point is ``transcribe_with_retry``; the FastAPI route
handler in ``chat_router.py`` remains the only caller in production.

Isolation contract
------------------
* ``openai_client`` is injected by the caller — tests supply a mock.
* ``_script_check`` is injected by the caller — tests supply a no-op.
* No FastAPI types (UploadFile, HTTPException) enter this module.
  Callers translate domain errors to HTTP responses.

WHISPER_HINT_SET policy (V1-A, 2026-10-30)
-------------------------------------------
EVIDENCE BASIS — two distinct groups:

  PROBE-VERIFIED (confirmed via live Emergent Whisper proxy tests,
  test_voice_transcribe.py::TestWhisperSupportedSetMismatch):
    en, hi, ta, mr, kn, ur, ne

  CARRIED FORWARD — present in the original set from the integration
  playbook; NOT individually probed against the Emergent proxy.
  Retained because there is no evidence of rejection for them, and
  removing them without evidence would be overcorrection.  If a future
  probe rejects any of these, remove it at that point:
    fr, de, es, pt, it, ja, ko, zh, ar, ru

REMOVED — nine Indian-language codes rejected by the Emergent proxy
  with HTTP 400 "Language '<code>' is not supported.":
    bn, te, gu, ml, pa, or, as, sa, sd
  Those languages are still available to users — they receive
  transcription via auto-detect (no hint sent on first attempt).
  The retry-without-hint path remains as a safety net for any code
  that may be added without a fresh probe.

DO NOT claim a code is "proxy-verified" unless a live probe result
  is recorded in tests/test_voice_transcribe.py.
"""
from __future__ import annotations

import re
import logging

logger = logging.getLogger(__name__)

# ── Language normalisation ────────────────────────────────────────────────────

# See evidence-basis comment in module docstring before changing this set.
WHISPER_HINT_SET: frozenset[str] = frozenset({
    # PROBE-VERIFIED Indian/Indic codes
    "en", "hi", "ta", "mr", "kn", "ur", "ne",
    # CARRIED-FORWARD international codes (not individually probe-tested)
    "fr", "de", "es", "pt", "it", "ja", "ko", "zh", "ar", "ru",
})


def normalize_language(language: str | None) -> str | None:
    """Strip BCP-47 subtag ('ta-IN' → 'ta') and lower-case.

    Returns ``None`` for empty / None input so callers can use a simple
    ``if lang:`` guard.
    """
    if not language:
        return None
    return re.split(r"[-_]", language.strip())[0].lower() or None


def _should_retry_without_hint(err_msg: str) -> bool:
    """True when the error is a language-hint rejection that merits a retry.

    Permanent failures (audio_too_short, network error, 500 without
    'language') intentionally return False so they propagate immediately.
    """
    m = err_msg.lower()
    return (
        "unsupported_language" in m
        or "unsupported language" in m
        or "invalid_language" in m
        or "invalid language" in m
        or ("400" in m and "language" in m)
        or ("422" in m and "language" in m)
        or ("language" in m and ("not supported" in m or "not valid" in m))
    )


# ── Core transcription with language-hint fallback ───────────────────────────

async def transcribe_with_retry(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    language: str | None,
    openai_client,
    script_check_fn=None,
) -> dict:
    """Attempt Whisper transcription with an optional language hint.

    Parameters
    ----------
    audio_bytes:
        Raw audio data already read from the upload.
    filename:
        Original filename (used in the Whisper file tuple).
    content_type:
        MIME type (e.g. ``"audio/m4a"``).
    language:
        Raw language code from the client (may be BCP-47 e.g. ``"ta-IN"``).
    openai_client:
        An ``AsyncOpenAI``-compatible client.  Tests inject a mock.
    script_check_fn:
        Optional ``(text, language) -> dict`` called on the transcript.
        Defaults to a no-op returning ``{}``.

    Returns
    -------
    dict with at minimum ``"text"`` key; may also carry ``script_mismatch``
    and ``detected_script`` from *script_check_fn*.

    Raises
    ------
    Any exception that is not a recognisable language-hint rejection
    propagates unchanged so callers (e.g. the FastAPI route) can map it to
    the right HTTP response.
    ``asyncio.CancelledError`` is never swallowed.
    """
    import asyncio

    if script_check_fn is None:
        script_check_fn = lambda text, lang: {}  # noqa: E731

    lang = normalize_language(language)

    base_kwargs: dict = {
        "model": "whisper-1",
        "file": (filename, audio_bytes, content_type),
    }
    lang_hint = lang if (lang and lang in WHISPER_HINT_SET) else None

    # First attempt — with language hint when available.
    try:
        kwargs = {**base_kwargs, **({"language": lang_hint} if lang_hint else {})}
        result = await openai_client.audio.transcriptions.create(**kwargs)
        return {"text": result.text, **script_check_fn(result.text, lang)}

    except asyncio.CancelledError:
        # Never retry a cancellation — propagate immediately.
        raise

    except Exception as first_err:
        err_msg = str(first_err)
        if lang_hint and _should_retry_without_hint(err_msg):
            logger.info(
                "Whisper rejected language hint %r — retrying without hint",
                lang_hint,
            )
            result = await openai_client.audio.transcriptions.create(**base_kwargs)
            return {"text": result.text, **script_check_fn(result.text, lang)}
        raise
