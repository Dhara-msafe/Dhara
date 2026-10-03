"""Scan a notice — OCR + plain-language explanation of a photographed document.

Accepts a base64 image, sends it to a vision LLM (via the Emergent universal
key) to (1) transcribe the visible text and (2) explain it simply in the user's
language with a suggested next step. Returns a single structured JSON result.

Model is cost-efficient by default (gpt-4o-mini) and can be changed by the user.
"""
import json
import os
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from dependencies import logger

load_dotenv()

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
SCAN_MODEL = os.environ.get("SCAN_MODEL", "gpt-4o-mini")

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "mr": "Marathi", "ta": "Tamil", "bn": "Bengali",
    "te": "Telugu", "kn": "Kannada", "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi",
}


class ScanIn(BaseModel):
    image_base64: str
    lang: str = "en"
    mode: str = "summary"  # "summary" | "draft"


def _system(lang_name: str, mode: str) -> str:
    task = (
        "draft a short, polite reply or response letter the person could send"
        if mode == "draft"
        else "explain in simple words what this document is and what the person should do next"
    )
    return (
        "You read photographs of Indian legal / official documents (notices, FIRs, "
        "summons, bills, letters). First transcribe the visible text exactly. Then "
        f"{task}, written in {lang_name}. Do NOT invent legal facts, section numbers "
        "or deadlines that are not visible in the document — if something is unclear "
        "or unreadable, say so plainly. Never promise outcomes. "
        'Reply ONLY as compact JSON with keys: {"extracted_text": "...", '
        '"summary": "...", "action": "..."}. extracted_text is the transcription; '
        "summary is the plain-language explanation (or the drafted reply if asked); "
        "action is one short suggested next step."
    )


@router.post("/scan/notice")
async def scan_notice(body: ScanIn):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "Scanning is not configured on this server.")
    img = (body.image_base64 or "").strip()
    if "," in img and img.lower().startswith("data:"):
        img = img.split(",", 1)[1]  # strip a data URL prefix if present
    if len(img) < 100:
        raise HTTPException(400, "No readable image was provided.")

    lang_name = LANG_NAMES.get(body.lang, "English")
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"scan-{os.urandom(6).hex()}",
        system_message=_system(lang_name, body.mode),
    ).with_model("openai", SCAN_MODEL)

    try:
        reply = await chat.send_message(UserMessage(
            text="Read this document and respond as instructed (JSON only).",
            file_contents=[ImageContent(image_base64=img)],
        ))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[scan] vision call failed: {type(e).__name__}: {e}")
        raise HTTPException(502, "Could not read the document. Please try a clearer photo.")

    text = reply if isinstance(reply, str) else str(reply)
    # Pull the JSON object out of the reply (models sometimes wrap it in prose/fences).
    data = None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = None
    if not isinstance(data, dict):
        data = {"extracted_text": text.strip(), "summary": text.strip(), "action": ""}

    return {
        "extracted_text": str(data.get("extracted_text", "")).strip(),
        "summary": str(data.get("summary", "")).strip(),
        "action": str(data.get("action", "")).strip(),
        "mode": body.mode,
    }
