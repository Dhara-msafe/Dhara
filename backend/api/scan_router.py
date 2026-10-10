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


ALL_DOC_TYPES = {
    "LEGAL_NOTICE", "COURT_DOCUMENT", "POLICE_DOCUMENT", "GOVERNMENT_NOTICE",
    "EMPLOYMENT_NOTICE", "TENANCY_NOTICE", "CONSUMER_BILL", "BANK_NOTICE", "LOAN_DEMAND",
    "INSURANCE_DOCUMENT", "UTILITY_BILL", "TAX_NOTICE", "PRIVATE_LETTER", "CONTRACT",
    "LEGAL_AGREEMENT", "NON_LEGAL_DOCUMENT", "UNKNOWN",
}
LEGAL_DOC_TYPES = {
    "LEGAL_NOTICE", "COURT_DOCUMENT", "POLICE_DOCUMENT", "GOVERNMENT_NOTICE",
    "EMPLOYMENT_NOTICE", "TENANCY_NOTICE", "BANK_NOTICE", "LOAN_DEMAND",
    "CONTRACT", "LEGAL_AGREEMENT",
}
VALID_LTS = {"VERIFIED_DIRECT", "VERIFIED_CONDITIONAL", "FRAMEWORK_VERIFIED", "CANNOT_VERIFY"}
FACT_KEYS = ["issuing_authority", "recipient", "date_of_issue", "reference_number",
             "amount", "deadline", "statutes_cited", "jurisdiction"]
NULL_VALS = {"null", "none", "not found", "n/a", "na", "unknown", ""}


def _system(lang_name: str, mode: str) -> str:
    task = (
        "draft a short, polite reply or response letter the person could send"
        if mode == "draft"
        else "explain in simple words what this document is and what the person should do next"
    )
    all_types_str = ", ".join(sorted(ALL_DOC_TYPES))
    legal_types_str = ", ".join(sorted(LEGAL_DOC_TYPES))
    template_catalog = (
        "cheque_bounce (a bounced/dishonoured cheque, Section 138 NI Act), "
        "deposit_refund (landlord not returning a rental security deposit), "
        "unpaid_salary (employer withholding wages), "
        "sp_complaint (a police station refusing to register an FIR)"
    )
    fields_hint = "; ".join(f'{k}: [{", ".join(v)}]' for k, v in TEMPLATE_FIELDS.items())
    return (
        "You analyze photographs of Indian documents. Follow ALL steps and reply ONLY as "
        "compact JSON — no prose, no markdown fences.\n\n"
        f"STEP 1 — CLASSIFY: Set document_type from: {all_types_str}. "
        "Use NON_LEGAL_DOCUMENT for technical papers, product brochures, business proposals, "
        "articles, presentations, academic content, sports/science documents, personal notes, "
        "or anything that is NOT a legal/official/regulatory communication directed at a person. "
        "Use UNKNOWN only when you genuinely cannot determine type. "
        f"Set is_legal_document=true ONLY if document_type is one of: {legal_types_str}. "
        "Set is_legal_document=false for all others.\n\n"
        "STEP 2 — TRANSCRIBE: extracted_text = the visible text exactly as it appears. "
        "If text is unclear, write [UNCLEAR] at that point.\n\n"
        "STEP 3 — MATERIAL FACTS (only values VISIBLE in the document; null for any missing): "
        "issuing_authority (who issued/sent it), recipient (who it is addressed to), "
        "date_of_issue (date printed on document), reference_number (case/notice/ref number), "
        "amount (monetary value if present), deadline (stated response date if present), "
        "statutes_cited (laws or sections cited), jurisdiction (court name or territory). "
        "NEVER invent a value — use null if not clearly readable.\n\n"
        f"STEP 4 — EXPLAIN: {task.capitalize()}, written in {lang_name}. "
        "For NON_LEGAL_DOCUMENT: describe what the document is about without adding legal interpretation. "
        "Do NOT invent legal facts, section numbers, deadlines or authority names not visible in the document. "
        "Do NOT claim the document is legally binding unless you can verify it.\n\n"
        "STEP 5 — LEGAL TRUTH STATE: "
        "FRAMEWORK_VERIFIED if confident about the general legal framework; "
        "VERIFIED_CONDITIONAL if answer depends on facts not in the document; "
        "CANNOT_VERIFY otherwise.\n\n"
        f"STEP 6 — TEMPLATE: Match one of {template_catalog} only if clearly matching. "
        f"Field keys per template: {fields_hint}. If no clear match, set null.\n\n"
        "Reply ONLY as this JSON (no extra keys, no prose):\n"
        '{"extracted_text":"...","document_type":"...","is_legal_document":false,"summary":"...",'
        '"action":"...","material_facts":{"issuing_authority":null,"recipient":null,'
        '"date_of_issue":null,"reference_number":null,"amount":null,"deadline":null,'
        '"statutes_cited":null,"jurisdiction":null},"legal_truth_state":"CANNOT_VERIFY",'
        '"suggested_template":null,"prefill":{}}'
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
        data = {"extracted_text": text.strip(), "summary": text.strip(), "action": "",
                "document_type": "UNKNOWN", "is_legal_document": False,
                "material_facts": {}, "legal_truth_state": "CANNOT_VERIFY",
                "suggested_template": None, "prefill": {}}

    # ── Template matching (unchanged) ─────────────────────────────────────────
    suggested = data.get("suggested_template")
    suggested = suggested if suggested in TEMPLATE_FIELDS else None
    raw_prefill = data.get("prefill") if isinstance(data.get("prefill"), dict) else {}
    prefill = {}
    if suggested:
        for k in TEMPLATE_FIELDS[suggested]:
            v = raw_prefill.get(k)
            if isinstance(v, (str, int, float)) and str(v).strip():
                prefill[k] = str(v).strip()

    # ── Document classification ───────────────────────────────────────────────
    raw_doc_type = str(data.get("document_type", "")).strip().upper()
    document_type = raw_doc_type if raw_doc_type in ALL_DOC_TYPES else "UNKNOWN"

    raw_is_legal = data.get("is_legal_document")
    if isinstance(raw_is_legal, bool):
        is_legal_document = raw_is_legal
    else:
        is_legal_document = document_type in LEGAL_DOC_TYPES

    # ── Material facts — only clean, confirmed values ─────────────────────────
    raw_facts = data.get("material_facts") if isinstance(data.get("material_facts"), dict) else {}
    material_facts: dict = {}
    for k in FACT_KEYS:
        v = raw_facts.get(k)
        if isinstance(v, str) and v.strip() and v.strip().lower() not in NULL_VALS:
            material_facts[k] = v.strip()

    # ── Legal truth state ─────────────────────────────────────────────────────
    raw_lts = str(data.get("legal_truth_state", "")).strip().upper()
    legal_truth_state = raw_lts if raw_lts in VALID_LTS else "CANNOT_VERIFY"

    result = {
        "extracted_text": str(data.get("extracted_text", "")).strip(),
        "document_type": document_type,
        "is_legal_document": is_legal_document,
        "summary": str(data.get("summary", "")).strip(),
        "action": str(data.get("action", "")).strip(),
        "material_facts": material_facts,
        "legal_truth_state": legal_truth_state,
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
