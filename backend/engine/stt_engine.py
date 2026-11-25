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


# WHISPER PROMPT-BIAS HINTS (V1-B, 2026-11-17, B-106)
# -----------------------------------------------------
# B-106: Telugu audio was coming back transcribed as Tamil. Root cause:
# Telugu's `language` hint is one of the nine codes the Emergent Whisper
# proxy rejects (see WHISPER_HINT_SET policy above), so every Telugu
# request already fell straight to full auto-detect with zero language
# signal — and Whisper has been observed to mislabel Telugu audio as
# Tamil specifically, the two being acoustically close South Dravidian
# languages for the model without a hint to disambiguate them.
#
# The proxy only validates/rejects the `language` field; `prompt` is a
# free-text field it does not check against a language allowlist, and
# Whisper is documented to bias its output toward whichever script the
# prompt text itself is written in. So for a hint-rejected code with a
# verified native-script sample, send that sample as `prompt` on the
# FIRST attempt (never as `language`, which would still 400) — this
# recovers most of the accuracy a real language hint would have given,
# without tripping the proxy's validator.
#
# Only add a code here once there is a REAL, verified native-script
# sample for it — a wrong or invented sample would bias Whisper toward
# the wrong output, which is worse than plain auto-detect. Telugu is the
# only entry today because it is the one this bug was filed against; the
# other eight hint-rejected codes (bn, gu, ml, pa, or, as, sa, sd) still
# get thin auto-detect until someone supplies a verified sample for them.
WHISPER_PROMPT_HINT: dict[str, str] = {
    "te": "ఇది తెలుగు భాషలో ఒక వాక్యం.",  # "This is a sentence in the Telugu language."
}


# NO-SPEECH GUARD (2026-11-25)
# ---------------------------
# Whisper does not return an empty string for a recording with no speech in
# it — it returns a short filler phrase. On the SDK 55 Android build the Ask
# mic uploaded valid-but-silent .m4a files and every one came back as the
# single word "you", which the app then showed in its "We heard" card as if
# the user had said it.
#
# The entries below are phrases Whisper is known to emit for silence AND that
# cannot be a real question to a legal-information assistant on their own.
# Keep this list short and exact-match only: a broad list would start
# rejecting real speech ("thank you" is deliberately NOT here — a user can
# genuinely say it). The app-side level check
# (frontend/src/voice/core/captureCheck.ts) is the primary guard; this is
# the backstop for clients without it.
NO_SPEECH_FILLERS: frozenset[str] = frozenset({
    "you",
    "thanks for watching",
    "thank you for watching",
})


class NoSpeechDetected(Exception):
    """Whisper returned only a known silence filler — nothing was said."""


def is_no_speech_filler(text: str | None) -> bool:
    """True when *text* is empty or is exactly one known silence filler."""
    cleaned = re.sub(r"[^\w\s]", "", (text or "").lower(), flags=re.UNICODE)
    cleaned = " ".join(cleaned.split())
    return cleaned == "" or cleaned in NO_SPEECH_FILLERS


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
    # B-106: only consulted when there's no real `language` hint to send —
    # a prompt bias is a fallback for the hint-rejected codes, never a
    # substitute for an actual supported hint.
    prompt_hint = WHISPER_PROMPT_HINT.get(lang) if (lang and not lang_hint) else None

    # First attempt — with language hint when available, else a prompt
    # bias for the specific hint-rejected codes we have a verified sample
    # for (B-106), else plain auto-detect.
    try:
        kwargs = {**base_kwargs}
        if lang_hint:
            kwargs["language"] = lang_hint
        elif prompt_hint:
            kwargs["prompt"] = prompt_hint
        result = await openai_client.audio.transcriptions.create(**kwargs)
        if is_no_speech_filler(result.text):
            raise NoSpeechDetected()
        return {"text": result.text, **script_check_fn(result.text, lang)}

    except (asyncio.CancelledError, NoSpeechDetected):
        # Never retry a cancellation or a no-speech verdict — propagate
        # immediately.
        raise

    except Exception as first_err:
        err_msg = str(first_err)
        if lang_hint and _should_retry_without_hint(err_msg):
            logger.info(
                "Whisper rejected language hint %r — retrying without hint",
                lang_hint,
            )
            result = await openai_client.audio.transcriptions.create(**base_kwargs)
            if is_no_speech_filler(result.text):
                raise NoSpeechDetected()
            return {"text": result.text, **script_check_fn(result.text, lang)}
        raise
