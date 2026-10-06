"""Scan a notice — OCR + plain-language explanation of a photographed document.

Accepts a base64 image, sends it to a vision LLM (via the Emergent universal
key) to (1) transcribe the visible text and (2) explain it simply in the user's
language with a suggested next step. Returns a single structured JSON result.

Model is cost-efficient by default (gpt-4o-mini) and can be changed by the user.

Logged-in users (including guests, who also get a token) get their scan
persisted — summary + photo — to the "Documents" tab (scan_history
collection). Anonymous calls (no token) still work exactly as before, just
without history.
"""
import json
import os
import re
import uuid
import base64 as b64
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from dotenv import load_dotenv

from dependencies import db, logger, current_user, current_user_optional
from services.ai_gateway import send_vision_with_fallback, SCAN_SPEC
from fir_storage import upload_evidence, download_evidence

load_dotenv()

router = APIRouter()

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "mr": "Marathi", "ta": "Tamil", "bn": "Bengali",
    "te": "Telugu", "kn": "Kannada", "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi",
}

# Mirrors the field keys in frontend/src/drafts.ts — kept in sync by hand since
# the two run on different stacks. Used so the vision model can offer to
# pre-fill the matching "ready notice" template with whatever it could read
# off the scanned document, instead of only giving a generic free-text reply.
TEMPLATE_FIELDS = {
    "cheque_bounce": [
        "sender_name", "sender_address", "receiver_name", "receiver_address",
        "cheque_no", "cheque_date", "amount", "bank_name", "return_date",
        "return_reason", "liability",
    ],
    "deposit_refund": [
        "sender_name", "sender_address", "landlord_name", "landlord_address",
        "premises", "rent", "deposit", "vacate_date", "dues",
    ],
    "unpaid_salary": [
        "sender_name", "sender_address", "employer_name", "employer_address",
        "designation", "joining_date", "monthly_wage", "period", "amount", "exit_status",
    ],
    "sp_complaint": [
        "sender_name", "sender_address", "station_name", "incident_date",
        "incident_place", "offence_desc", "refusal_date", "officer_name",
    ],
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
    template_catalog = (
        "cheque_bounce (a bounced/dishonoured cheque, Section 138 NI Act), "
        "deposit_refund (landlord not returning a rental security deposit), "
        "unpaid_salary (employer withholding wages), "
        "sp_complaint (a police station refusing to register an FIR)"
    )
    fields_hint = "; ".join(f'{k}: [{", ".join(v)}]' for k, v in TEMPLATE_FIELDS.items())
    return (
        "You read photographs of Indian legal / official documents (notices, FIRs, "
        "summons, bills, letters). First transcribe the visible text exactly. Then "
        f"{task}, written in {lang_name}. Do NOT invent legal facts, section numbers "
        "or deadlines that are not visible in the document — if something is unclear "
        "or unreadable, say so plainly. Never promise outcomes. "
        "Separately, decide if this document matches one of DHARA's ready-made notice "
        f"templates: {template_catalog}. If it clearly matches one, set "
        '"suggested_template" to that exact key and fill "prefill" with ONLY the values '
        "you can confidently read from the document for that template's fields (leave "
        "any you are unsure of out entirely — never guess a name, amount or date). If no "
        'template matches, set "suggested_template" to null and "prefill" to {}. Field keys '
        f"per template: {fields_hint}. "
        'Reply ONLY as compact JSON with keys: {"extracted_text": "...", '
        '"summary": "...", "action": "...", "suggested_template": "..."|null, "prefill": {}}. '
        "extracted_text is the transcription; summary is the plain-language explanation "
        "(or the drafted reply if asked); action is one short suggested next step."
    )


@router.post("/scan/notice")
async def scan_notice(body: ScanIn, user: Optional[dict] = Depends(current_user_optional)):
    img = (body.image_base64 or "").strip()
    if "," in img and img.lower().startswith("data:"):
        img = img.split(",", 1)[1]  # strip a data URL prefix if present
    if len(img) < 100:
        raise HTTPException(400, "No readable image was provided.")

    lang_name = LANG_NAMES.get(body.lang, "English")
    reply_text, err, error_id = await send_vision_with_fallback(
        session_id=f"scan-{os.urandom(6).hex()}",
        system_message=_system(lang_name, body.mode),
        user_text="Read this document and respond as instructed (JSON only).",
        image_base64=img,
        spec=SCAN_SPEC,
        caller="scan.notice",
    )
    if err or not reply_text:
        logger.warning(f"[scan] vision call failed: ref {error_id}")
        raise HTTPException(502, "Could not read the document. Please try a clearer photo.")

    text = reply_text
    # Pull the JSON object out of the reply (models sometimes wrap it in prose/fences).
    data = None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = None
    if not isinstance(data, dict):
        data = {"extracted_text": text.strip(), "summary": text.strip(), "action": "", "suggested_template": None, "prefill": {}}

    suggested = data.get("suggested_template")
    suggested = suggested if suggested in TEMPLATE_FIELDS else None
    raw_prefill = data.get("prefill") if isinstance(data.get("prefill"), dict) else {}
    # Only keep keys that actually belong to the matched template, and only
    # non-empty strings — never pass through a guess we didn't ask for.
    prefill = {}
    if suggested:
        for k in TEMPLATE_FIELDS[suggested]:
            v = raw_prefill.get(k)
            if isinstance(v, (str, int, float)) and str(v).strip():
                prefill[k] = str(v).strip()

    result = {
        "extracted_text": str(data.get("extracted_text", "")).strip(),
        "summary": str(data.get("summary", "")).strip(),
        "action": str(data.get("action", "")).strip(),
        "mode": body.mode,
        "suggested_template": suggested,
        "prefill": prefill,
    }

    # Persist to "Documents" history for logged-in users (guests included —
    # they get a token too). Anonymous (no token) calls keep working exactly
    # as before, just without history. Best-effort: a storage hiccup must
    # never fail the scan response the user is actively waiting on.
    if user:
        scan_id = str(uuid.uuid4())
        photo_storage_path = None
        try:
            photo_meta = await upload_evidence(
                user_id=user["id"], session_id="scan",
                filename=f"{scan_id}.jpg", data=b64.b64decode(img), content_type="image/jpeg",
            )
            photo_storage_path = photo_meta.get("storage_path")
        except Exception as e:
            logger.warning(f"[scan] photo upload failed, saving history without photo: {e}")
        try:
            await db.scan_history.insert_one({
                "id": scan_id,
                "user_id": user["id"],
                **result,
                "lang": body.lang,
                "photo_storage_path": photo_storage_path,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            result["scan_id"] = scan_id
        except Exception as e:
            logger.warning(f"[scan] history save failed: {e}")

    return result


@router.get("/scan/history/{user_id}")
async def scan_history_list(user_id: str, user: Optional[dict] = Depends(current_user_optional)):
    """List a user's saved scans (most recent first) for the Documents tab.
    Metadata only — no photo bytes, same pattern as /fir/sessions/{user_id}."""
    if user is None:
        raise HTTPException(401, "Authentication required")
    if user_id != user["id"]:
        raise HTTPException(403, "Access denied")
    cursor = db.scan_history.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(100)
    items = await cursor.to_list(length=100)
    for it in items:
        it["has_photo"] = bool(it.pop("photo_storage_path", None))
    return items


@router.get("/scan/history/detail/{scan_id}")
async def scan_history_detail(scan_id: str, user: dict = Depends(current_user)):
    """Full detail for one saved scan, including the photo as base64 (simplest
    way to show it in an authenticated RN <Image> without a separate blob
    fetch + object-URL dance for a single on-demand image)."""
    doc = await db.scan_history.find_one({"id": scan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Scan not found")
    if doc.get("user_id") != user["id"]:
        raise HTTPException(403, "Access denied")
    photo_base64 = None
    path = doc.get("photo_storage_path")
    if path:
        try:
            photo_bytes, _ct = await download_evidence(path)
            photo_base64 = b64.b64encode(photo_bytes).decode("ascii")
        except Exception as e:
            logger.warning(f"[scan] photo download failed for {scan_id}: {e}")
    doc["photo_base64"] = photo_base64
    doc.pop("photo_storage_path", None)
    return doc
