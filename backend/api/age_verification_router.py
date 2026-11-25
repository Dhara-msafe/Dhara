"""
age_verification_router.py — vendor-agnostic age-verification stub.

PRIVACY DESIGN DECISION — AADHAAR NUMBERS ARE NEVER COLLECTED OR STORED.
----------------------------------------------------------------------
The only result ever written to the user's DB record is:
  age_verified:    bool
  age_verified_at: ISO-8601 timestamp

The backend switch EKYC_ENABLED (default: OFF) gates the entire feature.
When OFF every endpoint returns HTTP 503 immediately — no data, no calls.

When ON the stub provider is invoked. A licensed integrator can replace
_call_stub_provider() with a real DigiLocker or offline-eKYC call that
honours the same provider contract:

    Input  → { dob: "YYYY-MM-DD" }  (from the user's own profile; never Aadhaar)
    Output → ProviderResult { age_18_plus_verified: bool, dob_matches: bool | None }

The router stores ONLY the boolean outcome. It never receives, processes,
or passes through Aadhaar numbers.

Registered in server.py as:
    from api.age_verification_router import router as age_verification_router
    api.include_router(age_verification_router)
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from dependencies import db, current_user, logger

router = APIRouter()

# ── Feature flag ──────────────────────────────────────────────────────────────
# Default OFF. Flip EKYC_ENABLED=true in the deployment environment to allow
# the stub / future licensed provider to be called.
_EKYC_ENABLED = os.environ.get("EKYC_ENABLED", "").lower() in ("1", "true", "yes")


# ── Provider contract ─────────────────────────────────────────────────────────

class ProviderResult(BaseModel):
    age_18_plus_verified: bool
    dob_matches: Optional[bool] = None   # vendor may not support DOB cross-check


async def _call_stub_provider(dob: Optional[str]) -> ProviderResult:
    """STUB — replace with a licensed DigiLocker / offline-eKYC SDK call.

    Currently always returns age_18_plus_verified=False so that:
      (a) the routing / storage layer can be tested end-to-end without a
          real provider, and
      (b) no user is accidentally granted age-verified status before a
          real check is in place.

    The integration point: swap out THIS function for the real provider
    call.  Every other part of this module (the flag gate, the storage, the
    API surface) is vendor-agnostic and must not change.
    """
    logger.info("[age_verification] STUB provider invoked — no Aadhaar data received")
    # A real call would be made here, e.g.:
    #   result = await my_ekyc_sdk.verify_age_only(dob=dob)
    #   return ProviderResult(
    #       age_18_plus_verified=result.is_18_plus,
    #       dob_matches=result.dob_matches,
    #   )
    return ProviderResult(age_18_plus_verified=False, dob_matches=None)


# ── API ───────────────────────────────────────────────────────────────────────

@router.post("/age-verification/initiate")
async def initiate_age_verification(user: dict = Depends(current_user)):
    """Begin an age-verification flow for the authenticated user.

    Returns the provider's result (stubbed until a licensed SDK is wired in).
    Stores ONLY the boolean outcome on the user's document.
    Aadhaar numbers are never accepted, processed, or stored.
    """
    if not _EKYC_ENABLED:
        raise HTTPException(
            503,
            {
                "code": "ekyc_disabled",
                "message": (
                    "Age verification is not yet available. "
                    "It will be enabled when a licensed DigiLocker or eKYC "
                    "provider is configured."
                ),
            },
        )

    dob = user.get("dob")   # YYYY-MM-DD from profile; never Aadhaar
    result = await _call_stub_provider(dob)

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "age_verified": result.age_18_plus_verified,
            "age_verified_at": now if result.age_18_plus_verified else None,
        }},
    )

    logger.info(
        "[age_verification] user=%s age_18_plus_verified=%s dob_matches=%s",
        user["id"], result.age_18_plus_verified, result.dob_matches,
    )
    return {
        "ok": True,
        "age_18_plus_verified": result.age_18_plus_verified,
        "dob_matches": result.dob_matches,
    }


@router.get("/age-verification/status")
async def age_verification_status(user: dict = Depends(current_user)):
    """Return the user's current verification state."""
    return {
        "age_verified": bool(user.get("age_verified", False)),
        "age_verified_at": user.get("age_verified_at"),
        "ekyc_enabled": _EKYC_ENABLED,
    }
