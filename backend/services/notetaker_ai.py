"""
notetaker_ai.py — AI services for the Advocate Consultation Notetaker.

Two responsibilities:
1. generate_note_draft   — calls Claude Sonnet 5.5 to extract structured
   facts, instructions, advice, uncertainties and actions from a transcript.
2. transcribe_audio      — calls Whisper (via existing stt_engine.py and the
   Emergent OpenAI proxy) to produce a text transcript from an audio file.

Neither function touches HTTP or FastAPI; callers translate errors to
HTTP responses.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid

from openai import AsyncOpenAI
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

from engine.stt_engine import transcribe_with_retry

logger = logging.getLogger("notetaker_ai")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
_OAI_BASE_URL = "https://integrations.emergentagent.com/llm/openai/v1"

# ── System prompt for note generation ────────────────────────────────────────

_NOTE_SYSTEM = """\
You are DHARA's legal consultation notetaker AI, assisting registered advocates
to create structured, auditable records of consultations.

Your task: given a consultation transcript or notes, extract information into
these five sections. Never infer or fabricate — include only what participants
explicitly stated.

Sections:
1. facts_stated         — Facts stated directly by a participant.
2. client_instructions  — What the client has asked the advocate to do.
3. advice_given         — Legal advice explicitly given by the advocate.
4. open_uncertainties   — Things stated as uncertain, unknown, or pending.
5. proposed_actions     — Specific next steps or tasks mentioned, with an
                          assignee ("advocate", "client", "both", or "other").

For every item, include source_ref: a short verbatim quote from the transcript
that supports it (max 120 chars), prefixed by the approximate line or turn.

Optionally populate statute_citations only when a statute, section or case is
explicitly mentioned by name (e.g. BNS Section 74, IPC 498A, CrPC 161).

Return ONLY valid JSON — no markdown fences, no commentary outside the JSON:
{
  "sections": {
    "facts_stated": [{"text": "...", "source_ref": "..."}],
    "client_instructions": [{"text": "...", "source_ref": "..."}],
    "advice_given": [{"text": "...", "source_ref": "..."}],
    "open_uncertainties": [{"text": "...", "source_ref": "..."}],
    "proposed_actions": [{"text": "...", "source_ref": "...", "assignee": "..."}]
  },
  "statute_citations": [{"statute": "...", "section": "...", "relevance": "..."}]
}
"""


def _extract_json(raw: str) -> str:
    """Strip markdown code fences if the model wrapped the JSON."""
    raw = raw.strip()
    # Remove ```json ... ``` or ``` ... ``` wrappers
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


async def generate_note_draft(
    content: str,
    language: str | None = None,
    input_method: str = "transcript_import",
) -> dict:
    """
    Generate a structured note draft from the given transcript/notes.

    Parameters
    ----------
    content:
        The reviewed transcript text or manual notes.
    language:
        Optional language hint (e.g. "hi", "en"). Added to the prompt.
    input_method:
        "manual", "transcript_import", or "audio_import" — contextualises prompt.

    Returns
    -------
    Parsed dict matching the JSON schema above.

    Raises
    ------
    ValueError — JSON could not be parsed from the model response.
    Any OpenAI / network exception — propagated to the caller.
    """
    lang_note = f" The content is in {language}." if language else ""
    input_note = {
        "manual": "typed notes by the advocate",
        "transcript_import": "an imported text transcript",
        "audio_import": "a transcript produced by audio transcription",
    }.get(input_method, "consultation notes")

    prompt = (
        f"The following consultation content is {input_note}.{lang_note}\n"
        f"Please extract the structured note as instructed.\n\n"
        f"---BEGIN CONTENT---\n{content}\n---END CONTENT---"
    )

    chat = (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"notetaker-note-{uuid.uuid4().hex[:12]}",
            system_message=_NOTE_SYSTEM,
        )
        .with_model("anthropic", "claude-sonnet-5-5")
    )

    # Accumulate the full stream — we need complete JSON before parsing.
    full_text = ""
    async for event in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(event, TextDelta):
            full_text += event.content
        elif isinstance(event, StreamDone):
            break

    try:
        return json.loads(_extract_json(full_text))
    except json.JSONDecodeError as e:
        logger.error("[notetaker_ai] JSON parse failed: %s — raw: %.200s", e, full_text)
        raise ValueError(f"Model returned invalid JSON: {e}") from e


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    language: str | None = None,
) -> str:
    """
    Transcribe audio bytes via Whisper (Emergent OpenAI proxy).

    Parameters
    ----------
    audio_bytes:
        Raw audio data.
    filename:
        Original filename (passed to Whisper file tuple).
    content_type:
        MIME type (e.g. ``"audio/mp3"``).
    language:
        Optional ISO-639-1 language code hint.

    Returns
    -------
    Transcript text string.

    Raises
    ------
    Any exception from the Whisper API propagates unchanged.
    """
    client = AsyncOpenAI(api_key=EMERGENT_LLM_KEY, base_url=_OAI_BASE_URL)
    result = await transcribe_with_retry(
        audio_bytes=audio_bytes,
        filename=filename,
        content_type=content_type,
        language=language,
        openai_client=client,
    )
    return result["text"]
