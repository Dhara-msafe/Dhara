"""Authentication, OTP, and account-management routes.

Extracted from server.py (Phase 1 Modularization).
Depends on: dependencies.py, config/settings.py
"""
import uuid
import secrets
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel, EmailStr, Field

from dependencies import db, current_user, hash_pw, check_pw, make_token, public_user, logger
from config.settings import (
    JWT_EXP_DAYS, FREE_DAILY_QUERIES, PRO_FREE_SAMPLES, DRAFTS_FREE,
)
from corpus_db import STATE_CODE_TO_JURISDICTION
from legal import TERMS_VERSION
from states import is_valid_state, state_name
from mailer import send_email, password_reset_otp_email, account_deletion_otp_email, email_configured
from account_deletion import hard_delete_user
from push import unregister_device
from services.login_guard import (
    check_lock, register_failure, clear_attempts, lock_detail,
    normalize_email, client_ip,
)

router = APIRouter()

# ── Pydantic models ───────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)
    phone: str = Field(min_length=6, max_length=20)
    state: Optional[str] = None
    terms_accepted: bool
    terms_version: str = TERMS_VERSION

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class GuestStartIn(BaseModel):
    language: str = "en"

class ForgotPasswordIn(BaseModel):
    email: EmailStr

class ResetPasswordIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=6)

class DeleteAccountIn(BaseModel):
    password: str

class RequestDeletionOTPIn(BaseModel):
    email: EmailStr

class VerifyDeletionOTPIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)

class AuthOut(BaseModel):
    token: str
    user: dict

class AcceptTermsIn(BaseModel):
    terms_version: str = TERMS_VERSION

class GoogleSessionIn(BaseModel):
    session_id: str

# ── OTP / rate-limit state ────────────────────────────────────────────────────
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
_RESET_SENDS: dict[str, list[datetime]] = {}
_RESET_MAX_SENDS = 3
_RESET_SEND_WINDOW = timedelta(hours=1)
_RESET_MIN_GAP = timedelta(seconds=60)
_DELETE_SENDS: dict[str, list[datetime]] = {}
_USED_GOOGLE_SESSIONS: set[str] = set()

# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn):
    if not body.terms_accepted:
        raise HTTPException(400, "You must accept the Terms & Conditions to register")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(400, "Email already registered")
    uid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": uid,
        "email": body.email.lower(),
        "name": body.name,
        "phone": body.phone,
        "password_hash": hash_pw(body.password),
        "language": "en",
        "is_pro": False,
        "pro_since": None,
        "pro_samples_used": 0,
        "is_grandfathered": True,
        "state_jurisdiction": STATE_CODE_TO_JURISDICTION.get((body.state or "").upper(), ""),
        "terms_accepted": True,
        "terms_version": body.terms_version,
        "terms_accepted_at": now,
        "created_at": now,
    }
    await db.users.insert_one(doc)
    # Persist terms acknowledgement in a separate audit collection too
    await db.terms_acknowledgements.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "email": body.email.lower(),
        "name": body.name,
        "phone": body.phone,
        "terms_version": body.terms_version,
        "accepted_at": now,
        "source": "register",
    })
    return {"token": make_token(uid), "user": public_user(doc)}

@router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn, request: Request):
    # B-16 — login attempt protection. The lock is checked BEFORE any password
    # hashing, so a locked attacker burns no CPU. Counters live in MongoDB
    # (services/login_guard.py), never in process memory.
    email_key = normalize_email(body.email)
    ip = client_ip(request)

    wait = await check_lock(db, email_key, ip)
    if wait:
        raise HTTPException(429, lock_detail(wait), headers={"Retry-After": str(max(1, wait))})

    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not check_pw(body.password, user.get("password_hash", "")):
        # Counted for unknown emails too — otherwise the attempt counter itself
        # would leak which addresses are registered. The 401 stays identical.
        wait = await register_failure(db, email_key, ip)
        if wait:
            raise HTTPException(429, lock_detail(wait), headers={"Retry-After": str(max(1, wait))})
        raise HTTPException(401, "Invalid credentials")

    await clear_attempts(db, email_key, ip)
    return {"token": make_token(user["id"]), "user": public_user(user)}


# ---- Guest Mode: anonymous trial, no email/phone/password ----
# A guest is a real `users` document (is_guest=True) that mints a normal JWT
# via the SAME make_token()/current_user() used by everyone else — the core
# auth code path below is completely untouched. The 5-question quota and 24h
# expiry are enforced server-side in chat_router.chat_stream(), keyed off the
# fields written here. IP rate-limiting (reusing the existing usage_daily
# counter pattern) stops someone farming unlimited 5-question sessions by
# repeatedly refreshing the app.
GUEST_SESSION_HOURS = 24
GUEST_QUESTION_LIMIT = 5
GUEST_IP_DAILY_LIMIT = 15


@router.post("/auth/guest", response_model=AuthOut)
async def start_guest(body: GuestStartIn, request: Request):
    ip = (request.client.host if request.client else "unknown") or "unknown"
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    throttle = await db.usage_daily.find_one_and_update(
        {"scope": "guest_ip", "day": day, "ip": ip},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=True,
    )
    if int(throttle.get("count", 0)) > GUEST_IP_DAILY_LIMIT:
        raise HTTPException(
            429,
            "Too many guest sessions started from this network today. "
            "Please create a free account to continue.",
        )

    now = datetime.now(timezone.utc)
    uid = f"guest_{uuid.uuid4().hex[:16]}"
    doc = {
        "id": uid,
        "email": f"{uid}@guest.dhara.local",
        "name": "Guest",
        "phone": "",
        "password_hash": "",
        "language": (body.language or "en"),
        "is_pro": False,
        "pro_samples_used": 0,
        "drafts_used": 0,
        "is_grandfathered": False,
        "is_guest": True,
        "guest_created_at": now.isoformat(),
        "guest_expires_at": (now + timedelta(hours=GUEST_SESSION_HOURS)).isoformat(),
        "guest_question_count": 0,
        "guest_question_limit": GUEST_QUESTION_LIMIT,
        "terms_accepted": True,
        "terms_version": TERMS_VERSION,
        "terms_accepted_at": now.isoformat(),
        "created_at": now.isoformat(),
    }
    await db.users.insert_one(doc)
    out = public_user(doc)
    out["is_guest"] = True
    out["guest_question_count"] = 0
    out["guest_question_limit"] = GUEST_QUESTION_LIMIT
    out["guest_expires_at"] = doc["guest_expires_at"]
    return {"token": make_token(uid), "user": out}


# ---- Google Sign-In via Emergent OAuth ----
# Guard: prevent replaying the same session_id twice (deep links can fire twice on Android)

@router.post("/auth/session", response_model=AuthOut)
async def google_auth_session(body: GoogleSessionIn):
    """Exchange an Emergent OAuth session_id for a Dhara JWT.

    The frontend never calls Emergent directly — it only sends the session_id
    here. We call demobackend.emergentagent.com once, upsert the user by email
    (so existing email/password accounts are linked), and return our own JWT.
    """
    sid = body.session_id.strip()
    if sid in _USED_GOOGLE_SESSIONS:
        raise HTTPException(401, "Session already used")
    _USED_GOOGLE_SESSIONS.add(sid)
    # Keep the in-memory guard from growing unboundedly
    if len(_USED_GOOGLE_SESSIONS) > 5000:
        _USED_GOOGLE_SESSIONS.clear()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": sid},
            )
    except Exception:
        raise HTTPException(502, "Could not reach auth service")

    if r.status_code != 200:
        raise HTTPException(401, "Invalid or expired Google session")

    data = r.json()
    email = (data.get("email") or "").lower().strip()
    name  = (data.get("name")  or "").strip() or (email.split("@")[0] if email else "User")

    if not email:
        raise HTTPException(401, "Google did not return an email address")

    now = datetime.now(timezone.utc).isoformat()

    # Upsert: reuse existing account if the email is already registered
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        uid  = existing["id"]
        user = existing
    else:
        uid  = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "id":               uid,
            "email":            email,
            "name":             name,
            "phone":            "",
            "language":         "en",
            "is_pro":           False,
            "pro_since":        None,
            "pro_samples_used": 0,
            "is_grandfathered":  True,
            "state":            None,
            "state_jurisdiction": "",
            "terms_accepted":   True,
            "terms_version":    TERMS_VERSION,
            "terms_accepted_at": now,
            "auth_provider":    "google",
            "created_at":       now,
        }
        await db.users.insert_one(user)

    return {"token": make_token(uid), "user": public_user(user)}


# ---- Password reset via emailed one-time code (OTP) ----
# The old flow accepted an email + registered phone number and immediately issued
# a JWT. Anyone who knew a user's email and mobile number could take the account
# over, so it was replaced: the code is delivered to the mailbox on the account,
# is hashed at rest, expires in 10 minutes, is single-use, and is rate limited.


def _prune_sends(email: str) -> list[datetime]:
    cutoff = datetime.now(timezone.utc) - _RESET_SEND_WINDOW
    kept = [t for t in _RESET_SENDS.get(email, []) if t > cutoff]
    _RESET_SENDS[email] = kept
    return kept


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Step 1 — email a 6-digit one-time code to the address on the account.

    Always returns the same generic response so the endpoint cannot be used to
    discover which email addresses are registered.
    """
    if not email_configured():
        raise HTTPException(503, "Password reset by email is not configured on this server.")

    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)
    sends = _prune_sends(email)
    if sends and (now - sends[-1]) < _RESET_MIN_GAP:
        raise HTTPException(429, "Please wait a minute before requesting another code.")
    if len(sends) >= _RESET_MAX_SENDS:
        raise HTTPException(429, "Too many reset requests. Please try again in an hour.")

    generic = {
        "sent": True,
        "message": "If that email is registered, we've sent a 6-digit code to it. It expires in 10 minutes.",
        "expires_in_minutes": OTP_TTL_MINUTES,
    }

    user = await db.users.find_one({"email": email})
    # Count the request either way so a missing account cannot be probed cheaply.
    _RESET_SENDS.setdefault(email, []).append(now)
    if not user:
        return generic

    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.password_resets.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "user_id": user["id"],
            "code_hash": hash_pw(code),
            "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
            "attempts": 0,
            "used": False,
            "created_at": now.isoformat(),
        }},
        upsert=True,
    )

    subject, html = password_reset_otp_email(
        name=user.get("name") or "", code=code, minutes=OTP_TTL_MINUTES
    )
    # Fail closed: if the mail cannot be delivered, the user must not be told to
    # go looking for a code that will never arrive.
    await send_email(to=email, subject=subject, html=html)
    logger.info(f"password reset code emailed to {email}")
    return generic


@router.post("/auth/reset-password", response_model=AuthOut)
async def reset_password(body: ResetPasswordIn):
    """Step 2 — verify the emailed code, set the new password, sign the user in."""
    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)
    rec = await db.password_resets.find_one({"email": email})
    invalid = HTTPException(400, "That code is not valid or has expired. Please request a new one.")
    if not rec or rec.get("used"):
        raise invalid
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong codes. Please request a new one.")
    try:
        expired = datetime.fromisoformat(rec["expires_at"]) < now
    except Exception:
        expired = True
    if expired:
        await db.password_resets.delete_one({"email": email})
        raise invalid

    if not check_pw(body.code.strip(), rec["code_hash"]):
        await db.password_resets.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise invalid

    user = await db.users.find_one({"id": rec["user_id"]})
    if not user:
        raise invalid

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(body.new_password), "password_reset_at": now.isoformat()}},
    )
    await db.password_resets.delete_one({"email": email})
    _RESET_SENDS.pop(email, None)
    updated = await db.users.find_one({"id": user["id"]})
    return {"token": make_token(user["id"]), "user": public_user(updated)}

# ---- Account deletion (Google Play "Account deletion" requirement) ----
# Two paths, one shared underlying hard_delete_user() (see account_deletion.py)
# so they can never drift apart:
#   1. In-app (authenticated, Settings → Delete account) — re-auth by password.
#   2. Public web page, no login required (for users who already uninstalled
#      the app) — proves identity via emailed OTP instead of a session, same
#      pattern as /auth/forgot-password + /auth/reset-password.
# Both permanently erase the account and every user-linked collection — there
# is no soft-delete and no recovery window.


def _prune_delete_sends(email: str) -> list[datetime]:
    cutoff = datetime.now(timezone.utc) - _RESET_SEND_WINDOW
    kept = [t for t in _DELETE_SENDS.get(email, []) if t > cutoff]
    _DELETE_SENDS[email] = kept
    return kept


async def _finish_deletion(user_id: str) -> None:
    """Shared tail of both deletion paths: hard-delete every collection,
    then best-effort tell the push relay to forget this user. A relay
    hiccup must never stop the account from actually being deleted."""
    await hard_delete_user(db, user_id)
    try:
        await unregister_device(user_id)
    except Exception as e:
        logger.warning(f"[account_deletion] push unregister failed for {user_id}: {type(e).__name__}: {e}")


@router.post("/account/delete")
async def delete_account_in_app(body: DeleteAccountIn, user: dict = Depends(current_user)):
    """In-app path. Requires re-entering the account password as proof of
    intent — a bare button tap is not enough for an irreversible action."""
    if not check_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect password.")
    await _finish_deletion(user["id"])
    return {"deleted": True}


@router.post("/account-deletion/request-otp")
async def request_deletion_otp(body: RequestDeletionOTPIn):
    """Public web page, step 1 — email a 6-digit one-time code. Always
    returns the same generic response so the endpoint cannot be used to
    discover which email addresses are registered."""
    if not email_configured():
        raise HTTPException(503, "Account deletion by email is not configured on this server.")

    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)
    sends = _prune_delete_sends(email)
    if sends and (now - sends[-1]) < _RESET_MIN_GAP:
        raise HTTPException(429, "Please wait a minute before requesting another code.")
    if len(sends) >= _RESET_MAX_SENDS:
        raise HTTPException(429, "Too many requests. Please try again in an hour.")

    generic = {
        "sent": True,
        "message": "If that email is registered, we've sent a 6-digit code to it. It expires in 10 minutes.",
        "expires_in_minutes": OTP_TTL_MINUTES,
    }

    user = await db.users.find_one({"email": email})
    _DELETE_SENDS.setdefault(email, []).append(now)
    if not user:
        return generic

    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.account_deletion_otps.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "user_id": user["id"],
            "code_hash": hash_pw(code),
            "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
            "attempts": 0,
            "used": False,
            "created_at": now.isoformat(),
        }},
        upsert=True,
    )

    subject, html = account_deletion_otp_email(name=user.get("name") or "", code=code, minutes=OTP_TTL_MINUTES)
    await send_email(to=email, subject=subject, html=html)
    logger.info(f"account deletion code emailed to {email}")
    return generic


@router.post("/account-deletion/verify")
async def verify_deletion_otp(body: VerifyDeletionOTPIn):
    """Public web page, step 2 — verify the emailed code and permanently
    delete the account. No login required; mailbox ownership IS the proof
    of identity for this one irreversible action."""
    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)
    rec = await db.account_deletion_otps.find_one({"email": email})
    invalid = HTTPException(400, "That code is not valid or has expired. Please request a new one.")
    if not rec or rec.get("used"):
        raise invalid
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong codes. Please request a new one.")
    try:
        expired = datetime.fromisoformat(rec["expires_at"]) < now
    except Exception:
        expired = True
    if expired:
        await db.account_deletion_otps.delete_one({"email": email})
        raise invalid

    if not check_pw(body.code.strip(), rec["code_hash"]):
        await db.account_deletion_otps.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise invalid

    user_id = rec["user_id"]
    await db.account_deletion_otps.delete_one({"email": email})
    _DELETE_SENDS.pop(email, None)
    await _finish_deletion(user_id)
    return {"deleted": True, "message": "Your Dhara account and all associated data have been permanently deleted."}

@router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    out = public_user(user)
    out["is_guest"] = bool(user.get("is_guest"))
    if out["is_guest"]:
        out["guest_question_count"] = int(user.get("guest_question_count", 0))
        out["guest_question_limit"] = int(user.get("guest_question_limit", GUEST_QUESTION_LIMIT))
        out["guest_expires_at"] = user.get("guest_expires_at")
    # Today's LLM allowance. Free users share ONE 30-query/day bucket across
    # both text and voice — voice is an accessibility floor, not a premium
    # feature. Pro users are unlimited (no per-user cap).
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    is_pro = bool(user.get("is_pro"))
    if is_pro:
        # Unlimited — surface None so UI knows to hide the meter
        out["daily_queries_cap"] = None
        out["daily_queries_left"] = None
        # Backward-compat fields (some older clients may still read these)
        out["daily_questions_cap"] = None
        out["daily_questions_left"] = None
        out["daily_voice_cap"] = None
        out["daily_voice_left"] = None
    else:
        cap = FREE_DAILY_QUERIES
        q_doc = await db.usage_daily.find_one({"scope": "user", "user_id": user["id"], "day": day, "kind": "query"})
        used = int((q_doc or {}).get("count", 0))
        left = max(0, cap - used)
        out["daily_queries_cap"] = cap
        out["daily_queries_left"] = left
        # Backward-compat fields kept so older clients don't break
        out["daily_questions_cap"] = cap
        out["daily_questions_left"] = left
        out["daily_voice_cap"] = cap
        out["daily_voice_left"] = left
    return out

@router.patch("/auth/language")
async def update_language(payload: dict, user: dict = Depends(current_user)):
    lang = payload.get("language", "en")
    await db.users.update_one({"id": user["id"]}, {"$set": {"language": lang}})
    return {"ok": True, "language": lang}

@router.patch("/auth/state")
async def update_state(payload: dict, user: dict = Depends(current_user)):
    """Set the user's state / UT so state-specific rules (rent, liquor, traffic
    compounding, stamp duty) can be served alongside the central law."""
    code = (payload.get("state") or "").upper()
    if code and not is_valid_state(code):
        raise HTTPException(400, "Unknown state code")
    await db.users.update_one({"id": user["id"]}, {"$set": {"state": code or None}})
    return {"ok": True, "state": code or None, "state_name": state_name(code)}

@router.post("/auth/accept-terms")
async def accept_terms(body: AcceptTermsIn, user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"terms_accepted": True, "terms_version": body.terms_version, "terms_accepted_at": now}},
    )
    await db.terms_acknowledgements.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "name": user.get("name"),
        "phone": user.get("phone"),
        "terms_version": body.terms_version,
        "accepted_at": now,
        "source": "in_app",
    })
    return {"ok": True, "terms_version": body.terms_version, "accepted_at": now}