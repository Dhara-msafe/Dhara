"""UPI Payment Page (outside the app) — Phase 1 of the DHARA Pro UPI plan.

This router backs a standalone web page (app/pay-upi.tsx on the frontend)
that is NOT linked from anywhere inside the shipped mobile app. A user who
receives the link outside the app (chat, SMS, email, a website) can pay via
any UPI app, then submit their payment reference (UTR) + account email here
for manual confirmation. Confirming a submission flips the account to Pro
using the same "is_pro" mechanism Stripe/Razorpay already use — no change
to what Pro unlocks.

Collection: upi_payment_submissions
  id, email, user_id (resolved at submit time), utr, note,
  status: pending | confirmed | rejected,
  created_at, reviewed_at, reviewed_note

Admin endpoints (list/confirm/reject) reuse the EXISTING X-Admin-Key
mechanism from dependencies.py — no new auth is introduced here.
"""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr

from dependencies import db, logger, check_admin_key

router = APIRouter()

# ── Config (own copy of the same price env vars server.py reads — kept
#    read-only and duplicated rather than imported, to avoid a circular
#    import between server.py and this router) ──────────────────────────────
PRO_PRICE_INR = int(os.environ.get("PRO_PRICE_INR", "9900"))   # paise
PRO_PRICE_LABEL = os.environ.get("PRO_PRICE_LABEL", "\u20b999")
UPI_VPA = os.environ.get("UPI_VPA", "").strip()
UPI_PAYEE_NAME = os.environ.get("UPI_PAYEE_NAME", "DHARA").strip() or "DHARA"


def _upi_uri(txn_note: str) -> str:
    """Build a standard upi://pay deep link. am is in rupees (2 decimals)."""
    from urllib.parse import quote
    amount_rupees = f"{PRO_PRICE_INR / 100:.2f}"
    return (
        "upi://pay?"
        f"pa={quote(UPI_VPA)}&pn={quote(UPI_PAYEE_NAME)}"
        f"&am={amount_rupees}&cu=INR&tn={quote(txn_note)}"
    )


@router.get("/billing/upi/config")
async def upi_config():
    configured = bool(UPI_VPA)
    txn_note = "DHARA Pro"
    return {
        "configured": configured,
        "vpa": UPI_VPA if configured else None,
        "payee_name": UPI_PAYEE_NAME,
        "amount_paise": PRO_PRICE_INR,
        "amount_label": PRO_PRICE_LABEL,
        "currency": "INR",
        "upi_uri": _upi_uri(txn_note) if configured else None,
    }


@router.get("/billing/upi/qrcode.png")
async def upi_qrcode():
    if not UPI_VPA:
        raise HTTPException(503, "UPI payments are not configured yet.")
    import qrcode
    img = qrcode.make(_upi_uri("DHARA Pro"))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


class UPISubmitIn(BaseModel):
    email: EmailStr
    utr: str
    note: Optional[str] = None


@router.post("/billing/upi/submit")
async def submit_upi_payment(body: UPISubmitIn):
    email = body.email.lower().strip()
    utr = body.utr.strip()
    if len(utr) < 6 or len(utr) > 40:
        raise HTTPException(400, "That doesn't look like a valid UPI reference number (UTR). Check your UPI app's payment history and try again.")

    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(404, "No DHARA account found with that email. Please sign up in the app first with this email, then submit again.")

    submission = {
        "id": str(uuid.uuid4()),
        "email": email,
        "user_id": user["id"],
        "utr": utr,
        "note": (body.note or "").strip()[:500] or None,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "reviewed_note": None,
    }
    await db.upi_payment_submissions.insert_one(submission)
    logger.info(f"[upi_billing] submission received for {email}")
    return {"ok": True, "submission_id": submission["id"]}


# ── Admin review (existing X-Admin-Key mechanism — nothing new) ────────────

@router.get("/billing/upi/submissions")
async def list_upi_submissions(x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    cursor = db.upi_payment_submissions.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
    return {"submissions": [doc async for doc in cursor]}


@router.post("/billing/upi/submissions/{submission_id}/confirm")
async def confirm_upi_submission(submission_id: str, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    sub = await db.upi_payment_submissions.find_one({"id": submission_id})
    if not sub:
        raise HTTPException(404, "Submission not found.")
    now = datetime.now(timezone.utc).isoformat()
    if sub["status"] != "confirmed":
        await db.users.update_one(
            {"id": sub["user_id"]},
            {"$set": {
                "is_pro": True,
                "pro_since": now,
                "pro_provider": "upi",
                "pro_payment_ref": sub["utr"],
            }},
        )
        await db.upi_payment_submissions.update_one(
            {"id": submission_id},
            {"$set": {"status": "confirmed", "reviewed_at": now}},
        )
        logger.info(f"[upi_billing] confirmed {submission_id} -> user {sub['user_id']} is now Pro")
    return {"ok": True}


@router.post("/billing/upi/submissions/{submission_id}/reject")
async def reject_upi_submission(submission_id: str, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    sub = await db.upi_payment_submissions.find_one({"id": submission_id})
    if not sub:
        raise HTTPException(404, "Submission not found.")
    now = datetime.now(timezone.utc).isoformat()
    await db.upi_payment_submissions.update_one(
        {"id": submission_id},
        {"$set": {"status": "rejected", "reviewed_at": now}},
    )
    return {"ok": True}
