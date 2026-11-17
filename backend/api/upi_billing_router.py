"""UPI Payment Page (outside the app) — Phase 1 of the DHARA Pro UPI plan.

This router backs a standalone web page (app/pay-upi.tsx on the frontend)
that is NOT linked from anywhere inside the shipped mobile app. A user who
receives the link outside the app (chat, SMS, email, a website) can pay via
any UPI app, then sign in and submit their payment reference (UTR) here for manual
confirmation (V-07: sign-in required; the payment is filed under the
signed-in account). Confirming a submission flips the account to Pro
using the same "is_pro" mechanism Stripe/Razorpay already use — no change
to what Pro unlocks.

Collection: upi_payment_submissions
  id, email, user_id (resolved at submit time), utr, note,
  status: pending | confirmed | rejected | expired,
  created_at, reviewed_at, reviewed_note, notified_at

B-124 (D-17, 17 Nov 2026): a pending submission that nobody has reviewed
within UPI_PENDING_EXPIRY_DAYS (default 7) is marked "expired", so the
person is not left waiting with no answer. Expiry only changes what the
person is told: an operator can still confirm (or reject) an expired
submission after checking the UPI history, so a real payment is never lost.
The signed-in person can read their latest submission's status and a plain
message (GET /billing/upi/my-submission), and gets a fixed-template email
after confirm or reject (best effort; QA builds keep it in qa_outbox).

Admin endpoints (list/confirm/reject) reuse the EXISTING X-Admin-Key
mechanism from dependencies.py — no new auth is introduced here.
"""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr

from dependencies import db, logger, check_admin_key, current_user

router = APIRouter()

# ── Config (own copy of the same price env vars server.py reads — kept
#    read-only and duplicated rather than imported, to avoid a circular
#    import between server.py and this router) ──────────────────────────────
PRO_PRICE_INR = int(os.environ.get("PRO_PRICE_INR", "9900"))   # paise
PRO_PRICE_LABEL = os.environ.get("PRO_PRICE_LABEL", "\u20b999")
UPI_VPA = os.environ.get("UPI_VPA", "").strip()
UPI_PAYEE_NAME = os.environ.get("UPI_PAYEE_NAME", "DHARA").strip() or "DHARA"


def _expiry_days() -> int:
    try:
        return max(1, int(os.environ.get("UPI_PENDING_EXPIRY_DAYS", "7")))
    except ValueError:
        return 7


# B-124: what the person is told for each status. Fixed text, no user input.
STATUS_MESSAGES = {
    "pending": ("We have your payment reference. Payments are checked by hand, so this "
                "is not instant. You become Pro as soon as it is confirmed."),
    "confirmed": "Payment confirmed. Your DHARA account is now Pro.",
    "rejected": ("We could not match this payment reference to a payment we received. "
                 "Your account is not Pro yet. Check the reference (UTR) in your UPI app's payment history and submit "
                 "it again, or contact support."),
    "expired": ("We could not confirm this payment in time. If money left your account, "
                "submit the reference (UTR) again or contact support, and we will check it."),
}


def _expires_at(created_at: str) -> str:
    return (datetime.fromisoformat(created_at) + timedelta(days=_expiry_days())).isoformat()


async def _expire_stale() -> None:
    """Mark pending submissions older than the window as expired (lazy; runs
    on reads, so no background job is needed)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_expiry_days())).isoformat()
    await db.upi_payment_submissions.update_many(
        {"status": "pending", "created_at": {"$lt": cutoff}},
        {"$set": {"status": "expired", "expired_at": datetime.now(timezone.utc).isoformat()}},
    )


async def _notify(sub: dict, status: str) -> None:
    """Best effort: tell the person by email. Never fails the admin action."""
    try:
        from mailer import email_configured, send_email, upi_status_email
        if not email_configured() or not sub.get("email"):
            return
        user = await db.users.find_one({"id": sub.get("user_id")}, {"_id": 0, "name": 1}) or {}
        subject, html = upi_status_email(name=user.get("name") or "", status=status,
                                         message=STATUS_MESSAGES[status])
        await send_email(to=sub["email"], subject=subject, html=html)
        await db.upi_payment_submissions.update_one(
            {"id": sub["id"]}, {"$set": {"notified_at": datetime.now(timezone.utc).isoformat()}})
    except Exception as e:  # noqa: BLE001 -- never block confirm/reject on email
        logger.warning(f"[upi_billing] could not notify for {sub.get('id')}: {type(e).__name__}")


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
    # V-07 (D-17, 17 Nov 2026): the account is now the signed-in user. An
    # "email" sent by an older copy of the page is accepted and IGNORED, so
    # it can neither choose the account nor probe which emails exist.
    email: Optional[EmailStr] = None
    utr: str
    note: Optional[str] = None


@router.post("/billing/upi/submit")
async def submit_upi_payment(body: UPISubmitIn, user: dict = Depends(current_user)):
    # V-07 (D-17): sign-in required (401 without a valid token). The payment is
    # filed under the signed-in account only -- there is no lookup by a typed
    # email, so the reply never says whether some other address has an
    # account -- and nothing here logs the email.
    if user.get("is_guest"):
        raise HTTPException(403, "Please create a DHARA account (or sign in) before upgrading to Pro. Guest sessions can't be upgraded.")
    email = (user.get("email") or "").lower().strip()
    utr = body.utr.strip()
    if len(utr) < 6 or len(utr) > 40:
        raise HTTPException(400, "That doesn't look like a valid UPI reference number (UTR). Check your UPI app's payment history and try again.")

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
    logger.info(f"[upi_billing] submission {submission['id']} received")
    return {"ok": True, "submission_id": submission["id"], "status": "pending",
            "message": STATUS_MESSAGES["pending"], "expires_at": _expires_at(submission["created_at"])}


@router.get("/billing/upi/my-submission")
async def my_upi_submission(user: dict = Depends(current_user)):
    """B-124: the signed-in person's latest submission and a plain message."""
    await _expire_stale()
    cursor = db.upi_payment_submissions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(1)
    docs = [d async for d in cursor]
    if not docs:
        return {"submission": None}
    d = docs[0]
    return {"submission": {
        "id": d["id"],
        "status": d["status"],
        "utr": d["utr"],
        "created_at": d["created_at"],
        "reviewed_at": d.get("reviewed_at"),
        "expires_at": _expires_at(d["created_at"]) if d["status"] == "pending" else None,
        "message": STATUS_MESSAGES.get(d["status"], ""),
    }}


# ── Admin review (existing X-Admin-Key mechanism — nothing new) ────────────

@router.get("/billing/upi/submissions")
async def list_upi_submissions(x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    await _expire_stale()
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
        await _notify(sub, "confirmed")
    return {"ok": True}


@router.post("/billing/upi/submissions/{submission_id}/reject")
async def reject_upi_submission(submission_id: str, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    sub = await db.upi_payment_submissions.find_one({"id": submission_id})
    if not sub:
        raise HTTPException(404, "Submission not found.")
    if sub["status"] == "confirmed":
        # B-124: a confirmed payment already made the account Pro; rejecting it
        # now would tell the person one thing while the account says another.
        raise HTTPException(409, "This submission is already confirmed.")
    if sub["status"] == "rejected":
        return {"ok": True}
    now = datetime.now(timezone.utc).isoformat()
    await db.upi_payment_submissions.update_one(
        {"id": submission_id},
        {"$set": {"status": "rejected", "reviewed_at": now}},
    )
    await _notify(sub, "rejected")
    return {"ok": True}
