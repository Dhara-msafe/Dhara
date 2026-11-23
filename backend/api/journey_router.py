"""
S3 Phase 2 — Guardian Journey Status Page
==========================================

Three endpoints:

  POST /api/journey/status           (authenticated)  → create journey record
  GET  /api/journey/status/{token}   (public)         → HTML status page for guardian
  PATCH /api/journey/status/{token}/safe (authenticated) → user marks themselves safe

DPDP-compliance:
  - Only user's first name is stored (no surname, no phone, no email).
  - No GPS coordinates are stored or displayed in the public HTML page (only area name)
  - Records auto-expire 24 h after creation.
  - The share token is a cryptographically random 10-char string — not guessable.
"""
from __future__ import annotations

import os
import secrets
import string
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import HTMLResponse
from html import escape as html_escape
from pydantic import BaseModel, Field

import logging
logger = logging.getLogger("journey_router")

from dependencies import db, current_user
from api.alerts_router import create_alert_and_notify

router = APIRouter()

# ── Config ────────────────────────────────────────────────────────────────────
_TOKEN_CHARS = string.ascii_letters + string.digits
_TOKEN_LEN   = 10
_TTL_HOURS   = 24          # the share link stops working after 24 h

# ── A12: how long a journey is kept ──────────────────────────────────────────
#
# Three different things, three different lifetimes, following what safety
# apps of this kind do (Life360 keeps precise movement ~30 days and coarse
# data far longer; Google moved Timeline on-device with auto-delete on):
#
#   the live trail        deleted the moment she marks safe or stops sharing
#                         (already the behaviour — mark_safe / revoke_sharing)
#   an ordinary journey   JOURNEY_RETENTION_DAYS after its deadline
#   a journey where her   INCIDENT_RETENTION_DAYS instead: this is the record
#   circle was alerted    that matters if something happened to her
#   anonymous counts      kept, because they name nobody (see _record_journey_stat)
#
# She can also delete a journey, or all of them, at any time — that is
# immediate and does not wait for any of these (DELETE endpoints below).
#
# Both numbers are settings, not constants in code, because the owner is
# taking them to the client for approval.
def _retention_days(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        logger.warning("[journey] %s is not a number; using %d days.", name, default)
        return default


JOURNEY_RETENTION_DAYS  = _retention_days("JOURNEY_RETENTION_DAYS", 30)
INCIDENT_RETENTION_DAYS = _retention_days("INCIDENT_RETENTION_DAYS", 90)
# A migration floor: a record that already exists keeps at least this long
# after the change lands, so turning deletion on never wipes history the same
# minute. Only applies to the one-off backfill.
BACKFILL_MIN_DAYS = 7


def _purge_moment(journey_end: datetime, incident: bool = False, now: datetime | None = None) -> datetime:
    """When this journey should disappear. Measured from the journey's end,
    never from a moment already past."""
    now = now or datetime.now(timezone.utc)
    days = INCIDENT_RETENTION_DAYS if incident else JOURNEY_RETENTION_DAYS
    return max(journey_end, now) + timedelta(days=days)
_MAX_LABEL   = 120         # destination label max chars

def _new_token() -> str:
    return "".join(secrets.choice(_TOKEN_CHARS) for _ in range(_TOKEN_LEN))


def _sharing_closed(rec: dict) -> bool:
    """True once this journey's link must reveal nothing further.

    Two independent ways a journey reaches this state:
      - status == "safe"       — the traveller arrived (existing P1 behaviour).
      - sharing_revoked_at set — the OWNER explicitly withdrew sharing without
        claiming arrival (new). Distinct from "safe" on purpose: the public
        page shows a different, non-alarming-but-not-"arrived" message for
        this case (see journey_status_page), and alerts_router.py applies
        this SAME check so the in-app Alerts channel is closed identically.

    Guardian-link architecture note (read before changing this function):
    a journey today has exactly ONE token shared with every recipient this
    journey was sent to (one SMS, possibly multiple phone numbers, or one
    set of recipient_link_ids) — there is no per-recipient token. So there
    is currently no way to revoke ONE recipient's view while others keep
    seeing live location; "withdraw sharing" always closes the link for
    EVERY current holder of the URL, direct or forwarded. See
    docs in /app/memory/guardian_link_revocation_design.md for the
    per-recipient-token design that would be required to change this.
    """
    return rec.get("status") == "safe" or bool(rec.get("sharing_revoked_at"))


# ── Gate B access level ────────────────────────────────────────────────────────

class GuardianAccessLevel(str, Enum):
    """What an authorized Guardian viewer may see (PR-1B full / Gate B).

    DENY:
        The requesting user is not an accepted recipient for this journey.
        The endpoint raises HTTP 403. Never returned in a successful response.

    HISTORICAL_ONLY:
        Gate A passed (accepted trusted_circle_link matched).
        Returns: traveller display name, destination, started_at,
                 expected_checkin_at, status, safe_at.
        No live location, area name, or exact coordinates at this level.

    HISTORICAL_WITH_APPROVED_CORRESPONDENCE:
        Superset of HISTORICAL_ONLY — adds last-known area name (not
        coordinates) and an in-app messaging channel with the traveller.
        NOT YET ACTIVATED in this batch; defined for forward-compatibility.
    """
    DENY = "DENY"
    HISTORICAL_ONLY = "HISTORICAL_ONLY"
    HISTORICAL_WITH_APPROVED_CORRESPONDENCE = "HISTORICAL_WITH_APPROVED_CORRESPONDENCE"


async def _guardian_access_check(
    token: str,
    user: dict,
) -> "tuple[dict, GuardianAccessLevel, dict]":
    """Gate A + journey_status permission check + token hardening.

    Raises HTTPException on every failure:
      404 — journey not found in DB
      410 — journey record past its expires_at (token hardening)
      403 — requesting user is not an accepted recipient for this journey,
             OR the accepted link does not carry journey_status=True.
             Missing permission dict treated as denied — no silent default.

    On success returns (journey_record, GuardianAccessLevel.HISTORICAL_ONLY, link).
    Caller receives the link record to evaluate further permission flags
    (e.g. temp_location for destination gating).
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")

    # Token hardening: past expires_at → 410 Gone
    expires_at = rec.get("expires_at")
    if expires_at:
        try:
            if datetime.now(timezone.utc) > datetime.fromisoformat(expires_at):
                raise HTTPException(410, "Journey link has expired")
        except HTTPException:
            raise
        except Exception:
            pass   # malformed date — proceed rather than block

    # Gate A: is the requesting user an accepted recipient?
    link_ids = rec.get("recipient_link_ids") or []
    if not link_ids:
        raise HTTPException(403, "Access denied")

    link = await db.trusted_circle_links.find_one(
        {
            "id":               {"$in": link_ids},
            "invitee_user_id":  user["id"],
            "status":           "accepted",
        }
    )
    if not link:
        raise HTTPException(403, "Access denied")

    # Permission check (application-level, on the record returned by the DB
    # query above): journey_status must be explicitly True.
    # A missing permissions dict or a False value denies — no silent default,
    # no legacy grant.
    if not link.get("permissions", {}).get("journey_status", False):
        raise HTTPException(403, "Journey status permission not granted")

    # Gate B: all accepted, permitted recipients start at HISTORICAL_ONLY
    return rec, GuardianAccessLevel.HISTORICAL_ONLY, link


# ── A45/A46: telling a trusted person who has no app ────────────────────────
#
# The app fan-out below reaches people with a DHARA account. These links have
# none: they accepted from an email and are reached the same way. The alert
# record is created either way; this only decides how it leaves the building.

_EMAIL_ALERT_TYPES = {"journey_started", "missed_checkin", "journey_completed"}


def _email_recipient(link: dict) -> Optional[str]:
    """The address to write to, or None when this link is not an email one."""
    if link.get("invitee_user_id"):
        return None                      # reachable in the app
    if link.get("status") != "accepted":
        return None                      # never write to someone who has not agreed
    if link.get("muted"):
        return None
    from services.guardian_email import normalise_email
    return normalise_email(link.get("contact_email"))


async def _email_linked_recipient(link: dict, rec: dict, owner_name: str, type_: str) -> bool:
    """Send one guardian email. Never raises: a mail failure must not break
    the journey action that triggered it."""
    address = _email_recipient(link)
    if not address or type_ not in _EMAIL_ALERT_TYPES:
        return False
    try:
        from services import guardian_email as ge
        from services.outbound_guard import EMAIL
        from mailer import (
            email_configured, send_email,
            guardian_journey_started_email, guardian_missed_checkin_email,
            guardian_journey_safe_email,
        )
        if not email_configured() or not ge.may_email(address):
            return False

        perms = link.get("permissions") or {}
        if type_ == "journey_started" and not perms.get("journey_updates", True):
            return False

        # A46 (option 2): the link shows her last known AREA and nothing more,
        # and only while the journey is open. Sent only to someone she allowed
        # to see her location.
        view_url = None
        if perms.get("temp_location"):
            token = ge.view_token_for(link["id"])
            view_url = ge.guardian_view_url(token) if token else None

        contact_name = link.get("contact_name") or ""
        if type_ == "journey_started":
            subject, html = guardian_journey_started_email(
                owner_name=owner_name, contact_name=contact_name,
                destination=rec.get("destination") or "her destination",
                expected_time=_local_clock(rec.get("expected_checkin_at")),
                view_url=view_url,
            )
        elif type_ == "missed_checkin":
            last = rec.get("last_location") if perms.get("temp_location") else None
            subject, html = guardian_missed_checkin_email(
                owner_name=owner_name, contact_name=contact_name,
                expected_time=_local_clock(rec.get("expected_checkin_at")),
                last_area=(last or {}).get("area"),
                last_seen_mins=_age_seconds((last or {}).get("updated_at"), datetime.now(timezone.utc)) // 60
                if last and (last or {}).get("updated_at") else None,
                view_url=view_url,
            )
        else:
            subject, html = guardian_journey_safe_email(
                owner_name=owner_name, contact_name=contact_name,
            )
        await send_email(to=address, subject=subject, html=html, channel=EMAIL)
        logger.info("[journey] guardian email sent (%s)", type_)
        return True
    except Exception as e:
        logger.warning("[journey] guardian email failed (%s): %s", type_, e)
        return False


def _local_clock(iso: Optional[str]) -> str:
    """A time a person can read. IST, because that is where the pilot is."""
    if not iso:
        return "the time she set"
    try:
        when = datetime.fromisoformat(iso)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        ist = when.astimezone(timezone(timedelta(hours=5, minutes=30)))
        return ist.strftime("%-I:%M %p on %-d %B")
    except Exception:
        return "the time she set"


async def _notify_linked_recipients(
    user: dict, rec: dict, type_: str, extra_payload: Optional[dict] = None,
    idempotency_suffix: Optional[str] = None,
) -> list[str]:
    """Fan out a safety alert to every ACCEPTED trusted-circle link selected
    for this journey (rec['recipient_link_ids']). Best-effort — a push/alert
    failure must never break the journey action that triggered it.

    idempotency_suffix: for alert types that can legitimately fire more than
    once in the same journey, the default per-journey
    idempotency key (token:type:link_id) would wrongly dedupe the SECOND
    episode as "already sent". Callers of such types pass something that
    uniquely identifies the episode (e.g. when it started) so each episode
    gets its own key, while retries of the SAME episode's call still dedupe.

    A31: returns the ids of the links an alert record now exists for (newly
    created or already there from an earlier identical call). A link is left
    out when it is missing, not accepted, lacks the permission this alert type
    needs, or its alert failed to save. This says an alert was RAISED on the
    server; it does not say a push reached the person or that they saw it.
    """
    link_ids = rec.get("recipient_link_ids") or []
    alerted: list[str] = []
    if not link_ids:
        return alerted
    payload = {
        "destination": rec.get("destination"),
        "journey_status": rec.get("status"),
        "expected_checkin_at": rec.get("expected_checkin_at"),
    }
    last_loc = rec.get("last_location")
    if last_loc:
        try:
            age_min = int((datetime.now(timezone.utc) - datetime.fromisoformat(last_loc["updated_at"])).total_seconds() / 60)
        except Exception:
            age_min = None
        payload["last_location"] = {
            "area": last_loc.get("area"), "accuracy": last_loc.get("accuracy"),
            "updated_at": last_loc.get("updated_at"), "age_minutes": age_min,
            # P1 Map Integration: lat/lng now included so an authorized
            # recipient's Alerts screen can render a marker + accuracy
            # circle. Safe to add unconditionally here because the SAME
            # permission check already enforced at read time in
            # alerts_router.py (_sanitize_location) strips this ENTIRE
            # last_location object — lat/lng included — for any recipient
            # whose link is not accepted or does not have temp_location=True.
            # No separate per-field filtering needed; see P0 security hotfix.
            "lat": last_loc.get("lat"), "lng": last_loc.get("lng"),
        }
    if extra_payload:
        payload.update(extra_payload)
    for link_id in link_ids:
        try:
            link = await db.trusted_circle_links.find_one({"id": link_id, "owner_id": user["id"]})
            if not link:
                continue
            base_key = f"{rec['token']}:{type_}:{link_id}" if type_ != "journey_status" else None
            idempotency_key = f"{base_key}:{idempotency_suffix}" if base_key and idempotency_suffix else base_key
            doc = await create_alert_and_notify(
                type_=type_, owner_id=user["id"], owner_name=user.get("name") or "A DHARA user",
                link=link, payload=payload, journey_token=rec["token"],
                idempotency_key=idempotency_key,
            )
            if doc:
                alerted.append(link_id)
            # A45: the same news by email, for a trusted person with no app.
            # Independent of `doc`: an alert record is for the app's own
            # Alerts screen, which an email guardian will never open.
            await _email_linked_recipient(
                link, rec, user.get("name") or "A DHARA user", type_,
            )
        except Exception as e:
            logger.warning("[journey] alert fan-out failed for link %s: %s", link_id, e)
    return alerted


# ── Models ────────────────────────────────────────────────────────────────────

class JourneyIn(BaseModel):
    destination: str = Field(..., min_length=1, max_length=_MAX_LABEL)
    duration_mins: int = Field(..., ge=1, le=1440)   # 1 min – 24 h
    recipient_link_ids: list[str] = Field(default_factory=list)   # accepted trusted_circle_links chosen for THIS journey
    # How many minutes before expected_checkin_at the OWNER (not the circle) gets a
    # reminder push. None = no reminder. Consumed by deadline_worker._run_reminders.
    remind_before_mins: Optional[int] = Field(default=None, ge=1, le=120)
    # Whether deadline_worker should actually notify the trusted circle once the
    # grace period after expected_checkin_at elapses. True preserves the existing
    # (pre-existing) automatic missed-checkin behaviour; False lets the owner opt
    # out of automatic escalation for this journey while the deadline is still tracked.
    auto_notify_on_no_response: bool = True
    # Planned arrival area — stored for the record; not shown on the public page.
    destination_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    destination_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    radius_meters: Optional[int] = Field(default=None, ge=50, le=2000)   # matches safety_router RADIUS_MIN_M/MAX_M
    # A30: a reference the app makes once per journey and sends with every
    # create attempt. If an attempt reached the server but its reply was lost,
    # the retry carries the same reference and gets the SAME journey back
    # instead of a second one (a second one would run its own deadline and
    # alert the circle after the owner had already checked in safe).
    client_ref: Optional[str] = Field(default=None, min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")


class LocationIn(BaseModel):
    lat: float = Field(..., ge=-90,  le=90)
    lng: float = Field(..., ge=-180, le=180)
    accuracy: float = Field(default=0, ge=0)
    area: str  = Field(default="", max_length=200)   # reverse-geocoded by device
    # A07: how long ago the device took this fix, measured on the device at the
    # moment it sent the request. An AGE rather than a clock time, so a wrong
    # phone clock or time zone cannot distort it: the server subtracts it from
    # its own clock. Absent on older app builds (the fix is then treated as
    # taken on arrival, as before). Capped at 24 h, the life of a journey.
    age_seconds: Optional[float] = Field(default=None, ge=0, le=86_400)
    # A07: where the fix came from. Only a real device fix ("gps") may be
    # stored. Absent on older app builds (accepted, recorded as "unknown").
    source: Optional[str] = Field(default=None, max_length=20, pattern=r"^[a-z_]+$")


class ExtendIn(BaseModel):
    additional_mins: int = Field(..., ge=1, le=360)


class ChangeDestinationIn(BaseModel):
    destination: str = Field(..., min_length=1, max_length=_MAX_LABEL)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/journey/status", status_code=201)
async def create_journey(body: JourneyIn, user: dict = Depends(current_user)):
    """Create a journey record and return a public status URL.

    A30: when the app sends a client_ref and this user already has an
    in-progress, unexpired journey with the same reference, that journey is
    returned unchanged: no second record and no second "journey started"
    notification. The reply also carries the server's own clock and the
    deadline it is holding, so the app can show that the alarm is armed.
    """
    now   = datetime.now(timezone.utc)
    if body.client_ref:
        existing = await db.safety_journeys.find_one(
            {"user_id": user["id"], "client_ref": body.client_ref, "status": "in_progress"}
        )
        if existing:
            still_open = True
            try:
                still_open = now <= datetime.fromisoformat(existing["expires_at"])
            except (KeyError, TypeError, ValueError):
                pass
            if still_open:
                return {
                    "token":               existing["token"],
                    "status_url":          f"/api/journey/status/{existing['token']}",
                    "expires_at":          existing.get("expires_at"),
                    "expected_checkin_at": existing.get("expected_checkin_at"),
                    "server_time":         now.isoformat(),
                    "created":             False,
                }
    token = _new_token()
    display_name = (user.get("name") or "").split()[0] or "User"   # first name only

    doc = {
        "token":               token,
        "user_id":             user["id"],
        "user_display":        display_name,
        "destination":         body.destination.strip(),
        "started_at":          now.isoformat(),
        "expected_checkin_at": (now + timedelta(minutes=body.duration_mins)).isoformat(),
        "status":              "in_progress",
        "safe_at":             None,
        "sharing_revoked_at":  None,   # set by POST .../revoke — owner withdraws sharing without claiming arrival
        "created_at":          now.isoformat(),
        "expires_at":          (now + timedelta(hours=_TTL_HOURS)).isoformat(),
        # A12: when this record disappears, as a real BSON date — Mongo's TTL
        # monitor cannot act on the ISO strings this module stores. Pushed out
        # later if her circle is ever alerted for this journey.
        "purge_at":            _purge_moment(now + timedelta(minutes=body.duration_mins), now=now),
        "incident":            False,
        "recipient_link_ids":  body.recipient_link_ids,
        "remind_before_mins":  body.remind_before_mins,
        "reminder_sent_at":    None,
        "auto_notify_on_no_response": body.auto_notify_on_no_response,
        "destination_lat":     body.destination_lat,
        "destination_lng":     body.destination_lng,
        "radius_meters":       body.radius_meters,
        "client_ref":          body.client_ref,
    }
    await db.safety_journeys.insert_one(doc)
    await _notify_linked_recipients(user, doc, "journey_started")
    return {
        "token":               token,
        "status_url":          f"/api/journey/status/{token}",
        "expires_at":          doc["expires_at"],
        "expected_checkin_at": doc["expected_checkin_at"],
        "server_time":         now.isoformat(),
        "created":             True,
    }


@router.patch("/journey/status/{token}/safe", status_code=200)
async def mark_safe(token: str, user: dict = Depends(current_user)):
    """User marks their own journey as completed safely.

    Deliberately INDEPENDENT of `sharing_revoked_at`: a traveller who
    earlier withdrew sharing must still be able to confirm they arrived
    safely — revoking sharing never claimed anything about arrival, so
    there is nothing to "protect" by blocking this transition. The public
    page's location/map withholding is driven solely by `_sharing_closed`
    (status=="safe" OR sharing_revoked_at set) — that gate is unaffected
    by this change and keeps coordinates hidden in every combination.
    See journey_status_page() for how the two flags render together when
    both are set (distinct combined message, not an overwrite)."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if rec["status"] == "safe":
        # PR-2A: clean any legacy location that predates this patch.
        # No notification — the completion alert was already sent on the
        # first safe call; this is idempotent cleanup only.
        await db.safety_journeys.update_one(
            {"token": token},
            {"$set": {"location_log": []}, "$unset": {"last_location": ""}},
        )
        return {"ok": True, "already_safe": True}
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {
            "$set": {
                "status":       "safe",
                "safe_at":      now.isoformat(),
                "location_log": [],           # PR-2A: clear log atomically with status
            },
            "$unset": {"last_location": ""},  # PR-2A: remove last_location atomically
        },
    )
    rec["status"] = "safe"
    rec["safe_at"] = now.isoformat()
    await _notify_linked_recipients(user, rec, "journey_completed")
    # A12: the live trail is already gone (above). One anonymous line stays,
    # so the product can be counted after the journey itself is deleted.
    await _record_journey_stat(rec, "safe")
    return {"ok": True, "safe_at": now.isoformat()}


@router.post("/journey/status/{token}/revoke", status_code=200)
async def revoke_sharing(token: str, user: dict = Depends(current_user)):
    """Owner explicitly withdraws location/status sharing for this
    journey's link — distinct from `mark_safe` (which asserts "I
    arrived"); this says "stop showing anyone anything new from this
    link", with no claim about arrival. Use case: the user changed their
    mind, the plan changed, or they simply no longer want the link live.

    Takes effect IMMEDIATELY for every current holder of the public URL —
    the original recipient(s) and anyone they may have forwarded the link
    to alike — because journey_status_page() re-reads this record on
    every request; there is no cache to invalidate. See _sharing_closed()
    docstring for the current shared-link limitation (this closes the
    link for ALL holders at once; there is no per-recipient granularity
    without per-recipient tokens — see the design doc).

    Idempotent: revoking an already-revoked or already-safe journey is a
    harmless no-op.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        # PR-2A: clean any legacy location without re-firing the notification.
        await db.safety_journeys.update_one(
            {"token": token},
            {"$set": {"location_log": []}, "$unset": {"last_location": ""}},
        )
        return {"ok": True, "already_closed": True}
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {
            "$set": {
                "sharing_revoked_at": now.isoformat(),
                "location_log":       [],          # PR-2A: clear log atomically
            },
            "$unset": {"last_location": ""},        # PR-2A: remove last_location atomically
        },
    )
    rec["sharing_revoked_at"] = now.isoformat()
    # Reuses the pre-existing (previously-unwired) "sharing_ended" alert
    # type already defined in alerts_router.py's _TITLES — informs any
    # ACCEPTED in-app Trusted Circle recipients that sharing has ended.
    # Their read-time permission check (alerts_router._sanitize_location)
    # now also treats sharing_revoked_at as closed, so no stale location
    # leaks through this notification either.
    await _notify_linked_recipients(user, rec, "sharing_ended")
    # A12: the trail is gone (above); the anonymous line stays.
    await _record_journey_stat(rec, "sharing_withdrawn")
    return {"ok": True, "revoked_at": rec["sharing_revoked_at"]}


# ── A12: her own control over her history ────────────────────────────────────
#
# Immediate, not on any timer. Google Play requires an app with accounts to
# offer deletion of the data tied to them, and the DPDP Act requires erasure
# when she withdraws consent. The anonymous counts in journey_stats are not
# touched: they hold no identifier and cannot be traced back to her.

@router.delete("/journey/status/{token}", status_code=200)
async def delete_journey(token: str, user: dict = Depends(current_user)):
    """Delete one of her journeys, now. Also stops any alert for it."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        return {"ok": True, "deleted": 0}          # already gone: nothing to say
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    res = await db.safety_journeys.delete_one({"token": token, "user_id": user["id"]})
    logger.info("[journey] user deleted 1 journey")
    return {"ok": True, "deleted": res.deleted_count}


@router.delete("/journey/history", status_code=200)
async def delete_journey_history(user: dict = Depends(current_user)):
    """Delete every journey of hers that is over.

    A journey still in progress is left alone on purpose: deleting it would
    silently switch off the alarm her circle is relying on. She ends it with
    "I'm safe" or "Stop sharing" first, then deletes.
    """
    res = await db.safety_journeys.delete_many({
        "user_id": user["id"],
        "status": {"$ne": "in_progress"},
    })
    still_running = await db.safety_journeys.count_documents({
        "user_id": user["id"], "status": "in_progress",
    })
    logger.info("[journey] user deleted %d past journeys", res.deleted_count)
    return {"ok": True, "deleted": res.deleted_count, "still_running": still_running}


class MissedCheckinIn(BaseModel):
    # A31: why the app is reporting. "auto" = its own timer ran out;
    # "manual" = the owner tapped "Raise alert now". Older builds send no body.
    trigger: Optional[str] = Field(default=None, pattern=r"^(auto|manual)$")


@router.post("/journey/status/{token}/missed-checkin", status_code=200)
async def report_missed_checkin(
    token: str, body: Optional[MissedCheckinIn] = None, user: dict = Depends(current_user),
):
    """Client calls this when its own local check-in timer expires with no
    response, for the case where the app is in the foreground to notice.
    deadline_worker.py independently watches expected_checkin_at server-side
    (5-min grace) so the same escalation still fires even if the app was
    closed or backgrounded past the deadline. The two paths can race (this
    endpoint doesn't set missed_checkin_notified_at), but create_alert_and_notify
    dedupes on idempotency_key (f"{token}:missed_checkin:{link_id}"), which is
    identical regardless of which path triggered it — so a recipient still
    only ever gets one missed-checkin alert per journey.

    INTENTIONAL CONSEQENCE OF REVOKING SHARING: once `sharing_revoked_at`
    is set, this call becomes a no-op — a missed check-in after the
    traveller has withdrawn sharing will NOT escalate to their Trusted
    Circle. This is a deliberate trade-off (withdrawing a link that can
    show nothing further also withdraws the passive missed-check-in
    safety net tied to that same link), not an oversight. The frontend
    MUST surface this consequence to the user before they tap "Withdraw
    sharing" (see guardian-share.tsx's inline warning next to that
    button) — silently turning off an active safety escalation without
    telling the traveller would itself be a safety regression.
    `report_help_requested` (above) is explicitly NOT gated the same way:
    "Need help" must always reach the Trusted Circle regardless of any
    earlier revoke."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    # A31: the reply now says what actually happened, so the app can stop
    # telling the owner her circle "has been notified" on its own timer.
    selected = len(rec.get("recipient_link_ids") or [])
    if _sharing_closed(rec):
        return {
            "ok": True, "skipped": "journey already completed or sharing withdrawn",
            "skipped_reason": "journey_completed" if rec.get("status") == "safe" else "sharing_withdrawn",
            "alerted_link_ids": [], "selected": selected,
        }
    # The owner chose "Do nothing" for missed check-ins on this journey. An
    # automatic report must respect that (deadline_worker already does). A
    # deliberate "Raise alert now" still goes through.
    if body and body.trigger == "auto" and not rec.get("auto_notify_on_no_response", True):
        return {
            "ok": True, "skipped": "owner chose not to notify automatically",
            "skipped_reason": "auto_notify_off",
            "alerted_link_ids": [], "selected": selected,
        }
    alerted = await _notify_linked_recipients(user, rec, "missed_checkin")
    # A12: her circle was alerted, so this journey is kept for
    # INCIDENT_RETENTION_DAYS instead of the ordinary window, and counted.
    await mark_journey_incident(token)
    if not rec.get("incident"):
        await _record_journey_stat(rec, "missed_checkin")
    return {"ok": True, "alerted_link_ids": alerted, "selected": selected}


@router.post("/journey/status/{token}/heartbeat", status_code=200)
async def record_heartbeat(token: str, user: dict = Depends(current_user)):
    """Owner-only: records last_heartbeat_at without affecting the check-in deadline.

    Heartbeats indicate that the traveller's device is connected and the app
    is in the foreground.  They do NOT reset or extend expected_checkin_at —
    the personal check-in deadline is set once at journey creation and stays
    fixed until mark_safe or revoke_sharing closes the journey.

    F1 invariant: recording a heartbeat neither satisfies nor suppresses the
    server-side deadline worker.  The worker evaluates expected_checkin_at
    against the current clock; last_heartbeat_at is stored for diagnostics
    only and is never read by the deadline worker.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        raise HTTPException(409, "Journey already completed or sharing withdrawn")
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set": {"last_heartbeat_at": now.isoformat()}},
    )
    return {"ok": True, "heartbeat_at": now.isoformat()}


@router.post("/journey/status/{token}/help", status_code=200)
async def report_help_requested(token: str, user: dict = Depends(current_user)):
    """Explicit 'Need help' tap during an active journey — distinct from a
    missed check-in: the student actively asked, rather than just being
    unresponsive."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    await _notify_linked_recipients(user, rec, "help_requested")
    return {"ok": True}


@router.patch("/journey/status/{token}/location", status_code=200)
async def update_location(token: str, body: LocationIn, user: dict = Depends(current_user)):
    """Receive a GPS update from the user's device during an active Head Out session.

    Only lat/lng/accuracy are stored server-side; the human-readable area name
    is reverse-geocoded on the device (privacy-friendly — no third-party geocoding API).
    Throttle: backend silently ignores updates received within 25 s of the last one.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        return {"ok": True, "skipped": "journey already completed or sharing withdrawn"}

    # A07: only a real fix taken by the device may be stored. A made-up point
    # (the app's "demo" fallback) or one re-sent from the server's own copy
    # would put a false or stale place in front of the trusted circle.
    if body.source is not None and body.source != "gps":
        return {"ok": True, "skipped": "not_a_device_fix"}

    now = datetime.now(timezone.utc)
    # Server-side throttle — ignore if the last update ARRIVED < 25 s ago.
    # (Measured on arrival time; records written before A07 only have updated_at.)
    last = rec.get("last_location")
    if last:
        try:
            last_ts = datetime.fromisoformat(last.get("received_at") or last["updated_at"])
            if (now - last_ts).total_seconds() < 25:
                return {"ok": True, "skipped": "throttled"}
        except Exception:
            pass

    # A07: store when the fix was really TAKEN, separately from when it arrived.
    # Before this, every upload was stamped with its arrival time, so a delayed
    # or retried fix looked brand new on the trusted person's screen.
    captured = now - timedelta(seconds=body.age_seconds) if body.age_seconds else now

    # A07: never let an older fix replace a newer one (a delayed upload
    # arriving after a fresher fix has already been stored).
    if last:
        try:
            last_captured = datetime.fromisoformat(last.get("captured_at") or last["updated_at"])
            if captured <= last_captured:
                return {"ok": True, "skipped": "older_than_current"}
        except Exception:
            pass

    location_doc = {
        "lat":         body.lat,
        "lng":         body.lng,
        "accuracy":    body.accuracy,
        "area":        body.area.strip() or "Unknown area",
        # updated_at is what every reader (guardian view, public page, alert
        # payloads, age_minutes) already uses as "when was she here". It now
        # carries the true capture time, so those readers show the real age
        # without each needing a change.
        "updated_at":  captured.isoformat(),
        "captured_at": captured.isoformat(),
        "received_at": now.isoformat(),
        "source":      body.source or "unknown",
    }
    # PR-2A atomic closure guard: filter conditions mirror _sharing_closed() so
    # that if safe/revoke completes between the read-time check above and this
    # write, the update is a no-op and cannot restore location that was just
    # removed. The read-time check handles the common case; this guards the race.
    await db.safety_journeys.update_one(
        {
            "token":              token,
            "status":             {"$ne": "safe"},  # not already marked safe
            "sharing_revoked_at": None,             # sharing not revoked
        },
        {"$set":  {"last_location": location_doc},
         "$push": {"location_log": {"$each": [location_doc], "$slice": -20}}},
    )
    return {
        "ok": True,
        "updated_at":  location_doc["updated_at"],
        "captured_at": location_doc["captured_at"],
        "received_at": location_doc["received_at"],
    }


@router.patch("/journey/status/{token}/extend", status_code=200)
async def extend_checkin(token: str, body: ExtendIn, user: dict = Depends(current_user)):
    """Owner pushes their own check-in deadline forward (Head Out's "Extend
    time" action, shown when the traveller is inside the arrival zone but not
    ready to confirm "I arrived" yet, or just wants more time generally).

    Resets missed_checkin_notified_at / reminder_sent_at so the NEW deadline
    gets its own fresh reminder + missed-checkin cycle from deadline_worker.py
    — without this, extending a journey that already passed its old deadline
    (and already got a missed-checkin alert sent) would leave those flags set,
    so the worker would silently never watch the new deadline at all.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        raise HTTPException(409, "Journey already completed or sharing withdrawn")
    try:
        current_deadline = datetime.fromisoformat(rec["expected_checkin_at"])
    except Exception:
        current_deadline = datetime.now(timezone.utc)
    new_deadline = current_deadline + timedelta(minutes=body.additional_mins)
    now = datetime.now(timezone.utc)
    # A12: the retention window runs from the journey's end, so a later
    # deadline moves the delete date with it. An incident keeps its longer
    # window.
    purge_at = _purge_moment(new_deadline, incident=bool(rec.get("incident")), now=now)
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set": {
            "expected_checkin_at":        new_deadline.isoformat(),
            "missed_checkin_notified_at": None,
            "reminder_sent_at":           None,
            "purge_at":                   purge_at,
        }},
    )
    # A28: server_time rides along so the phone can re-measure how far its own
    # clock is from the server's and keep the countdown on the server's
    # deadline, not the phone's idea of the time.
    return {
        "ok": True,
        "expected_checkin_at": new_deadline.isoformat(),
        "server_time": now.isoformat(),
    }


@router.patch("/journey/status/{token}/destination", status_code=200)
async def change_destination(token: str, body: ChangeDestinationIn, user: dict = Depends(current_user)):
    """Owner changes where they're heading mid-journey (Head Out's "Change
    destination" action, offered when the app detects the traveller moving
    away from / off the route to their original destination).

    Deliberately does NOT fire a new alert type — recipients with
    temp_location already read `destination` live off this same record on
    every guardian/alert view (see get_guardian_view, _notify_linked_recipients),
    so the next time they check, they see the update. No separate
    "destination_changed" notification is sent; this keeps the alert-type
    surface from growing for a cosmetic mid-journey correction.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        raise HTTPException(409, "Journey already completed or sharing withdrawn")
    update: dict = {"destination": body.destination.strip()}
    if body.lat is not None and body.lng is not None:
        update["destination_lat"] = body.lat
        update["destination_lng"] = body.lng
    await db.safety_journeys.update_one({"token": token}, {"$set": update})
    return {"ok": True, "destination": update["destination"]}


# Row 25 (removed 21 Nov 2026, owner decision): POST
# /journey/status/{token}/route-deviation and its RouteDeviationIn model were
# deleted. Route deviation no longer auto-notifies the trusted circle; it is
# an in-app prompt only (head-out/index.tsx). "route_deviation" stays in
# alerts_router's DISPLAY maps only, so alerts of that type already in the
# database keep rendering for recipients.


async def mark_journey_incident(token: str) -> None:
    """A12: her circle was alerted for this journey, so keep it longer.

    Called from both alert paths — the deadline worker and the app's own
    missed-check-in report. Idempotent: the second call finds `incident`
    already true and changes nothing. Never raises: an alert must go out
    even if this bookkeeping fails.
    """
    try:
        rec = await db.safety_journeys.find_one({"token": token})
        if not rec or rec.get("incident"):
            return
        try:
            journey_end = datetime.fromisoformat(rec["expected_checkin_at"])
        except Exception:
            journey_end = datetime.now(timezone.utc)
        await db.safety_journeys.update_one(
            {"token": token},
            {"$set": {
                "incident": True,
                "purge_at": _purge_moment(journey_end, incident=True),
            }},
        )
    except Exception as e:
        logger.warning("[journey] could not extend retention for %s: %s", token, e)


async def _record_journey_stat(rec: dict, outcome: str) -> None:
    """A12: one anonymous line for the product's own counting, written when a
    journey ends.

    It names nobody and locates nobody: no user id, no token, no coordinates,
    no destination, no recipient. Only how long the journey was planned for,
    how long it actually ran, and how it ended. That is what makes it safe to
    keep after the journey itself is deleted.

    Never raises: counting must not be able to break a journey ending.
    """
    try:
        now = datetime.now(timezone.utc)
        started = rec.get("started_at")
        planned = rec.get("expected_checkin_at")
        def _mins(a, b):
            try:
                return int((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() // 60)
            except Exception:
                return None
        await db.journey_stats.insert_one({
            "outcome":          outcome,            # safe | missed_checkin | sharing_withdrawn
            "planned_mins":     _mins(started, planned) if started and planned else None,
            "actual_mins":      _mins(started, now.isoformat()) if started else None,
            "had_alert":        bool(rec.get("incident")) or outcome == "missed_checkin",
            "recipient_count":  len(rec.get("recipient_link_ids") or []),
            "had_live_location": bool(rec.get("last_location")),
            "ended_at":         now,
        })
    except Exception as e:
        logger.warning("[journey] stat not recorded (%s): %s", outcome, e)


async def ensure_journey_ttl_index(database) -> None:
    """A12: let Mongo delete journey records once `purge_at` has passed.

    A journey holds her destination and her last known coordinates. Nothing
    deleted them: an expired journey was refused with 410 but stayed in the
    database for ever. With `expireAfterSeconds=0` Mongo removes each record
    at the moment stored in `purge_at` (a real BSON date — the TTL monitor
    ignores the ISO strings this module stores for its own use).

    Same shape as ensure_error_event_ttl_index in server.py: called once at
    startup, takes the database explicitly so a test can pass a fake, and
    never stops the app from booting.

    Records written before this change have no `purge_at`, so Mongo would
    keep them for ever. backfill_journey_purge_at below gives them one,
    without deleting anything that already exists for at least
    BACKFILL_MIN_DAYS.
    """
    try:
        await database.safety_journeys.create_index(
            "purge_at", expireAfterSeconds=0, name="safety_journeys_ttl",
        )
    except Exception as e:
        logger.warning(f"[startup] safety_journeys TTL index warning: {e}")


async def backfill_journey_purge_at(database) -> int:
    """A12: give older journey records a delete time, once.

    The window runs from each record's own `created_at` (an ISO string, so
    the date is built in the database itself), with a floor of
    BACKFILL_MIN_DAYS from now so nothing already stored disappears the
    moment this is switched on. A record already marked as an incident gets
    the longer window.
    """
    try:
        # The window runs from each record's own creation, plus a floor of
        # BACKFILL_MIN_DAYS from now: turning deletion on must never wipe
        # existing history the same minute, even for records already older
        # than the retention window.
        floor_ms = BACKFILL_MIN_DAYS * 24 * 3600 * 1000
        window_ms = JOURNEY_RETENTION_DAYS * 24 * 3600 * 1000
        incident_ms = INCIDENT_RETENTION_DAYS * 24 * 3600 * 1000
        res = await database.safety_journeys.update_many(
            {"purge_at": {"$exists": False}},
            [{"$set": {"purge_at": {"$max": [
                {"$add": ["$$NOW", floor_ms]},
                {"$add": [
                    {"$ifNull": [
                        {"$dateFromString": {"dateString": "$created_at", "onError": None, "onNull": None}},
                        "$$NOW",
                    ]},
                    {"$cond": [{"$eq": [{"$ifNull": ["$incident", False]}, True]}, incident_ms, window_ms]},
                ]},
            ]}}}],
        )
        if res.modified_count:
            logger.warning("[startup] A12: gave %d older journey record(s) a delete time.", res.modified_count)
        return res.modified_count
    except Exception as e:
        logger.warning(f"[startup] safety_journeys purge_at backfill warning: {e}")
        return 0


def _age_seconds(iso: str | None, now: datetime) -> int | None:
    """A28: seconds between a stored timestamp and the server's own clock.

    None when there is no timestamp or it cannot be read; never negative, so a
    reading stamped slightly in the future reads as "just now" rather than as
    a negative age.
    """
    if not iso:
        return None
    try:
        taken = datetime.fromisoformat(iso)
    except Exception:
        return None
    if taken.tzinfo is None:
        taken = taken.replace(tzinfo=timezone.utc)
    return max(0, int((now - taken).total_seconds()))


@router.get("/journey/{token}/guardian", status_code=200)
async def get_guardian_view(token: str, user: dict = Depends(current_user)):
    """Sign-in-gated Guardian endpoint (PR-1B full).

    Returns journey metadata to an authenticated, authorized recipient.

    Gate A: checks that the requesting user has an accepted trusted_circle_link
            whose id is listed in journey.recipient_link_ids.
            HTTP 403 if no match.

    Token hardening:
        HTTP 410 if the journey is past its expires_at (24-hour window).
        HTTP 403 if the user is not a recipient.

    Gate B (HISTORICAL_ONLY): returns traveller display name, destination,
        timestamps, status. No live location, area, or coordinates.

    Closed journeys (status=safe or sharing_revoked_at set) return a minimal
    response — just the closed state and when it closed — no full data dump.
    """
    rec, access_level, link = await _guardian_access_check(token, user)
    now = datetime.now(timezone.utc)

    # Destination is location data: disclose only when temp_location is True.
    # This is an application-level check on the link record returned by the DB.
    # Omit the key entirely when permission is absent — no placeholder value.
    show_destination: bool = bool(
        link.get("permissions", {}).get("temp_location", False)
    )

    # Closed journey: destination and all location data withheld unconditionally.
    # temp_location does NOT restore disclosure after safe or sharing-revoked.
    # identity, selection, journey_status and expiry are already enforced above.
    if _sharing_closed(rec):
        closed_at = rec.get("safe_at") or rec.get("sharing_revoked_at")
        return {
            "access_level":      access_level,
            "status":            rec.get("status"),
            "closed_at":         closed_at,
            "traveller_display": rec.get("user_display"),
            "server_time":       now.isoformat(),
        }

    # Active journey: gate level determined by temp_location permission.
    # Gate B upgrade: temp_location=True → HISTORICAL_WITH_APPROVED_CORRESPONDENCE.
    # Returns area name (no coordinates/accuracy/timestamp) alongside destination.
    if show_destination:
        access_level = GuardianAccessLevel.HISTORICAL_WITH_APPROVED_CORRESPONDENCE

    body = {
        "access_level":        access_level,
        "traveller_display":   rec.get("user_display"),
        "started_at":          rec.get("started_at"),
        "expected_checkin_at": rec.get("expected_checkin_at"),
        "status":              rec.get("status"),
        "safe_at":             rec.get("safe_at"),
        # A28: the recipient's own phone clock may be wrong too, so the server
        # states its own time. The age below is worked out here, from it.
        "server_time":         now.isoformat(),
    }
    if show_destination:
        body["destination"] = rec.get("destination")
        # Return location data (area name + coordinates) to authorised guardian.
        last_loc = rec.get("last_location")
        if last_loc:
            if last_loc.get("area"):
                body["area"] = last_loc["area"]
            # Include coordinates so the guardian can see a live map link.
            if last_loc.get("lat") is not None and last_loc.get("lng") is not None:
                body["last_location"] = {
                    "lat":        last_loc["lat"],
                    "lng":        last_loc["lng"],
                    "accuracy":   last_loc.get("accuracy"),
                    "area":       last_loc.get("area"),
                    "updated_at": last_loc.get("updated_at"),
                    # A28: how old this reading is, worked out by the server
                    # from the true capture time (A07). Never negative; absent
                    # when the stored time cannot be read.
                    "age_seconds": _age_seconds(last_loc.get("updated_at"), now),
                }
    return body


def _public_details_enabled() -> bool:
    """Owner's decision (read at request time so it can be flipped without a
    code change): show the traveller's name and journey details on the public
    Guardian link, or serve the static privacy notice.

    Even when enabled, live location — coordinates, area name, accuracy and
    any map — stays withheld from this anonymous page. Location is only ever
    released through the signed-in, per-recipient route above.
    """
    return os.environ.get("GUARDIAN_PUBLIC_PAGE_DETAILS", "").strip().lower() in ("1", "true", "yes")


# ── A46 (option 2): what an email guardian can see ──────────────────────────
#
# Deliberately the least that is still useful: her name, that she is on a
# journey or has not checked in, the AREA she was last in, and how long ago.
# No coordinates, no map, no destination, no history, no account.
#
# The address is a capability — anyone holding the link can open it — so it
# is narrow by design: it shows nothing once the journey is over, nothing if
# she never allowed location, and nothing at all for an unknown token. The
# owner can end it by removing that person from her circle, and the whole
# estate can be ended by rotating GUARDIAN_LINK_SECRET.

def _guardian_email_page(title: str, body: str) -> HTMLResponse:
    html = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta name=\"robots\" content=\"noindex,nofollow\">"
        f"<title>{html_escape(title)} · Dhara</title>"
        "<style>body{margin:0;background:#FDFBF7;font-family:system-ui,-apple-system,"
        "Segoe UI,Roboto,Arial,sans-serif;color:#12203A}main{max-width:520px;margin:0 auto;"
        "padding:28px 20px}.card{background:#fff;border-radius:14px;padding:24px;"
        "box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 12px}"
        "p{font-size:16px;line-height:24px;margin:0 0 12px}.area{font-size:26px;"
        "font-weight:800;margin:10px 0 2px}.muted{color:#4A5568;font-size:14px;line-height:21px}"
        "</style></head><body><main><div class=\"card\">"
        f"<h1>{html_escape(title)}</h1>{body}</div>"
        "<p class=\"muted\" style=\"padding:16px 4px\">Dhara · MSafe Solutions. This page "
        "shows an area only, never an exact position, and only while her journey is open."
        "</p></main></body></html>"
    )
    return HTMLResponse(html, headers={"X-Robots-Tag": "noindex, nofollow",
                                       "Cache-Control": "no-store"})


@router.get("/guardian/email/{token}", response_class=HTMLResponse, include_in_schema=False)
async def guardian_email_view(token: str):
    """A46: her last known area, for a trusted person reading an email."""
    from services.guardian_email import hash_token

    nothing = _guardian_email_page(
        "Nothing to show",
        "<p>This link is not active. It may have been for a journey that has ended, or "
        "the person may have changed who she shares with.</p>"
        "<p class=\"muted\">If you were expecting to see something, contact her directly.</p>",
    )

    link = await db.trusted_circle_links.find_one({"view_token_hash": hash_token(token)})
    if not link or link.get("status") != "accepted":
        return nothing
    if not (link.get("permissions") or {}).get("temp_location"):
        return nothing

    rec = await db.safety_journeys.find_one({
        "user_id":            link["owner_id"],
        "status":             "in_progress",
        "sharing_revoked_at": None,
        "recipient_link_ids": link["id"],
    })
    if not rec:
        return nothing

    owner = html_escape(rec.get("user_display") or link.get("owner_name") or "She")
    now = datetime.now(timezone.utc)
    missed = bool(rec.get("missed_checkin_notified_at"))
    last = rec.get("last_location") or {}
    area = last.get("area")
    age_s = _age_seconds(last.get("updated_at"), now) if last.get("updated_at") else None

    if area:
        if age_s is None or age_s < 120:
            when = "just now"
        elif age_s < 3600:
            when = f"about {age_s // 60} minutes ago"
        else:
            when = f"about {age_s // 3600} hours ago"
        where = (f"<p>Last known area</p><p class=\"area\">{html_escape(area)}</p>"
                 f"<p class=\"muted\">Updated {html_escape(when)}. "
                 "An area, not an exact place.</p>")
    else:
        where = ("<p>Dhara has no recent location for her. Her phone may be off, out of "
                 "signal, or the app may be closed.</p>")

    if missed:
        return _guardian_email_page(
            f"{owner} has not checked in",
            f"{where}<p>Please try to contact her. If you cannot reach her and you are "
            "worried, call the police on 112.</p>"
            "<p class=\"muted\">Dhara cannot tell whether she is safe, only that she has "
            "not said so.</p>",
        )
    return _guardian_email_page(
        f"{owner} is on a journey",
        f"{where}<p class=\"muted\">She is expected to check in by "
        f"{html_escape(_local_clock(rec.get('expected_checkin_at')))}. If she does not, "
        "you will get an email.</p>",
    )


@router.get("/journey/status/{token}", response_class=HTMLResponse, include_in_schema=False)
async def journey_status_page(token: str):
    """Public HTML status page — PR-1B1 static privacy notice.

    Returns an identical static response for ALL token values (valid, revoked,
    expired, or random). No database query is performed. No journey metadata,
    traveller name, destination, timestamps, status label, location, or
    auto-refresh behaviour is disclosed to anonymous visitors.

    Intentional semantic changes from pre-PR-1B1 behaviour
    -------------------------------------------------------
    * Previously HTTP 404 for an unknown token → now HTTP 200.
      Rationale: a 404 confirms that the token is not valid, which leaks the
      existence (or non-existence) of a journey. Both valid and invalid tokens
      must receive an identical response.
    * Previously HTTP 410 for an expired journey → now HTTP 200.
      Rationale: a 410 discloses expiry state, which requires a DB lookup and
      confirms the token's validity. No DB query is made here any longer.
    * Previously disclosed: traveller name, a generic destination label
      ("Destination on file"), started-at / check-in / safe-at timestamps,
      status labels (e.g. "Journey in progress", "Arrived safely") and a
      30-second meta-refresh tag. None of these are disclosed after PR-1B1.
    * The PR-1A "Location is unavailable through this shared link." notice
      is superseded by the generic privacy notice below.

    The helper functions _status_html, _expired_html, and _not_found_html are
    retained — they remain valid pure functions tested in
    test_pr1a_guardian_containment.py — but are no longer called from this route.
    Per-recipient, sign-in-gated access to journey metadata is deferred to a
    later batch (PR-1B full) which will bind the signed-in viewer to a selected,
    accepted recipient link with current permissions.

    When GUARDIAN_PUBLIC_PAGE_DETAILS is enabled the owner has chosen to
    disclose the traveller's name, destination and journey timestamps to
    anyone holding the link. Live location, area name and maps remain
    withheld on this anonymous page in every journey state.
    """
    body = _private_html()
    if _public_details_enabled():
        body = await _details_html_for(token)
    # Phase 1 hardening — S3-H1 / S4-H1,2,3,4 (see token_url_exposure_report.md)
    return HTMLResponse(
        content=body,
        headers={
            "Referrer-Policy":        "no-referrer",
            "Cache-Control":          "no-store, no-cache, max-age=0, must-revalidate",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options":        "DENY",
        },
    )


# ── HTML templates ─────────────────────────────────────────────────────────────
# _status_html / _expired_html / _not_found_html are retained as tested helper
# functions (see test_pr1a_guardian_containment.py) but are no longer invoked
# by journey_status_page after PR-1B1.  _private_html() is the only template
# currently called from the route.

async def _details_html_for(token: str) -> str:
    """Render the journey page for a holder of the link.

    Unknown token → the neutral "link not found" page. Past expiry → the
    expired page. Otherwise the status page with name, destination and
    timestamps. HTTP 200 in every case: the status code itself must not
    confirm whether a token exists.
    """
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        return _not_found_html()

    expires_at = rec.get("expires_at")
    if expires_at:
        try:
            if datetime.now(timezone.utc) > datetime.fromisoformat(expires_at):
                return _expired_html(rec)
        except Exception:
            pass   # malformed date — show the journey rather than block

    if rec.get("sharing_revoked_at"):
        # The traveller withdrew sharing: disclose nothing further, not even
        # the name or destination that were visible a moment ago.
        return _private_html()

    if rec.get("status") == "safe":
        label, colour, icon = "Arrived safely", "#15803d", "&#9989;"
    else:
        label, colour, icon = "Journey in progress", "#1A3F74", "&#128694;"
    return _status_html(rec, label, colour, icon)


def _private_html() -> str:
    """PR-1B1: Static generic privacy notice served for every Guardian URL.

    PR-1B full: Client-side JavaScript reads the token from
    window.location.pathname and builds the dhara://guardian/{token}
    deep-link at runtime — the token is NEVER echoed in the server-rendered
    HTML (preserves the test_r11 no-echo contract).

    Discloses nothing: no name, no destination, no status, no timestamps, no
    location, and no auto-refresh. The page is identical for valid, expired,
    revoked, and completely unknown tokens — no existence confirmation of any
    kind is embedded in the response.
    """
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="UTF-8"/>\n'
        '  <meta name="viewport" content="width=device-width,initial-scale=1"/>\n'
        '  <meta name="referrer" content="no-referrer"/>\n'
        "  <title>DHARA</title>\n"
        "  <style>\n"
        "    *{box-sizing:border-box;margin:0;padding:0}\n"
        "    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\n"
        "         background:#f9fafb;color:#111;min-height:100vh;\n"
        "         display:flex;align-items:center;justify-content:center;padding:24px}\n"
        "    .card{background:#fff;border-radius:16px;padding:32px 24px;\n"
        "          max-width:400px;width:100%;text-align:center;\n"
        "          box-shadow:0 1px 6px rgba(0,0,0,.08)}\n"
        "    .icon{font-size:40px;margin-bottom:16px}\n"
        "    h1{font-size:18px;font-weight:700;color:#111;margin-bottom:12px;line-height:1.4}\n"
        "    p{font-size:15px;color:#555;line-height:1.5;margin-bottom:12px}\n"
        "    #open-btn{display:none;margin-top:8px;padding:14px 28px;\n"
        "             background:#1A3F74;color:#fff;font-size:15px;font-weight:600;\n"
        "             border-radius:12px;text-decoration:none;letter-spacing:.2px}\n"
        "    #open-btn:active{opacity:.8}\n"
        "    .footer{font-size:12px;color:#aaa;margin-top:24px}\n"
        "  </style>\n"
        "</head>\n"
        "<body>\n"
        '  <div class="card">\n'
        '    <div class="icon">&#128274;</div>\n'
        "    <h1>Journey details are private.</h1>\n"
        "    <p>Open DHARA and sign in to view information shared with you.</p>\n"
        '    <a id="open-btn" href="#">Open in DHARA app \u2192</a>\n'
        '    <div class="footer">DHARA legal aid app</div>\n'
        "  </div>\n"
        "  <script>\n"
        "    (function(){\n"
        "      var parts=window.location.pathname.split('/');\n"
        "      var tok=parts[parts.length-1]||'';\n"
        "      if(!tok)return;\n"
        "      var btn=document.getElementById('open-btn');\n"
        "      // Universal Link (primary): uses HTTPS + window.location.origin so the\n"
        "      // correct domain is built at runtime without server-side interpolation.\n"
        "      // On iOS/Android with the app installed the OS intercepts this before\n"
        "      // the browser loads the URL.  On desktop / no app: the web guardian\n"
        "      // screen is served instead.\n"
        "      var httpsUrl=window.location.origin+'/guardian/'+encodeURIComponent(tok);\n"
        "      var dharaUrl='dhara://guardian/'+encodeURIComponent(tok);\n"
        "      btn.href=httpsUrl;\n"
        "      btn.onclick=function(e){\n"
        "        e.preventDefault();\n"
        "        window.location=httpsUrl;\n"
        "        // Fallback: if the page is still visible 800ms later (app not\n"
        "        // installed or Universal Links not yet configured), try the\n"
        "        // custom dhara:// scheme so older builds still work.\n"
        "        setTimeout(function(){window.location=dharaUrl;},800);\n"
        "        return false;\n"
        "      };\n"
        "      btn.style.display='inline-block';\n"
        "    })();\n"
        "  </script>\n"
        "</body>\n"
        "</html>"
    )


# ── HTML templates ─────────────────────────────────────────────────────────────

def _status_html(rec: dict, label: str, colour: str, icon: str) -> str:
    name   = _escape(rec.get("user_display", "User"))
    # The owner has chosen (GUARDIAN_PUBLIC_PAGE_DETAILS) to show the
    # destination the traveller typed when starting the journey. Live
    # location — coordinates, area name, accuracy, maps — stays withheld
    # below in every journey state.
    dest   = _escape(rec.get("destination") or "") or "Destination on file"
    start  = _fmt_dt(rec.get("started_at"))
    checkin = _fmt_dt(rec.get("expected_checkin_at"))
    safe_at = _fmt_dt(rec.get("safe_at")) if rec.get("safe_at") else ""
    # PR-1A — Anonymous Guardian page: location withheld unconditionally.
    # The public HTML route carries no authentication mechanism. A journey
    # token, a recipient_link_id query parameter, or a browser-supplied
    # identity does not establish recipient authorization and must not
    # unlock location data. Coordinates, area, accuracy, location
    # timestamp, map markers, tile requests and embedded Leaflet scripts
    # are suppressed here in all journey states (in_progress, safe,
    # revoked). The in-app alert path (alerts_router.py) applies
    # per-recipient permission checks separately and is unaffected.
    loc_block = """
      <hr class="divider"/>
      <div>
        <div class="field-label">Location</div>
        <div class="field-value" style="color:#888">Location is unavailable through this shared link.</div>
      </div>"""
    map_block = ""
    status_extra = f"<p style='margin:0 0 4px;font-size:15px;color:#555;'>Arrived: {safe_at}</p>" if safe_at else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="referrer" content="no-referrer"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="refresh" content="30"/>
  <title>DHARA — {name}'s journey</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          background:#f9fafb;color:#111;min-height:100vh;padding:0}}
    .banner{{background:{colour};color:#fff;padding:18px 20px;text-align:center}}
    .banner-icon{{font-size:32px;margin-bottom:6px}}
    .banner-label{{font-size:20px;font-weight:700;letter-spacing:.2px}}
    .card{{background:#fff;border-radius:16px;margin:20px 16px;padding:20px;
           box-shadow:0 1px 6px rgba(0,0,0,.08)}}
    .card-row{{display:flex;flex-direction:column;gap:12px}}
    .field-label{{font-size:12px;font-weight:600;color:#888;text-transform:uppercase;
                  letter-spacing:.5px;margin-bottom:2px}}
    .field-value{{font-size:17px;font-weight:500;color:#111}}
    .divider{{border:none;border-top:1px solid #eee;margin:16px 0}}
    .footer{{text-align:center;font-size:12px;color:#aaa;padding:20px;}}
    .refresh{{font-size:12px;color:#aaa;text-align:center;margin-top:8px}}
    @media(min-width:480px){{.card{{max-width:420px;margin:20px auto}}}}
  </style>
</head>
<body>
  <div class="banner">
    <div class="banner-icon">{icon}</div>
    <div class="banner-label">{label}</div>
  </div>

  <div class="card">
    <div class="card-row">
      <div>
        <div class="field-label">Traveller</div>
        <div class="field-value">{name}</div>
      </div>
      <hr class="divider"/>
      <div>
        <div class="field-label">Destination</div>
        <div class="field-value">{dest}</div>
      </div>
      <hr class="divider"/>
      <div>
        <div class="field-label">Journey started</div>
        <div class="field-value">{start}</div>
      </div>
      <hr class="divider"/>
      <div>
        <div class="field-label">Expected check-in by</div>
        <div class="field-value">{checkin}</div>
      </div>
      {f'<hr class="divider"/><div><div class="field-label">Marked safe at</div><div class="field-value">{safe_at}</div></div>' if safe_at else ""}
      {loc_block}
      {map_block}
    </div>
  </div>

  <div class="refresh">Page refreshes every 30 seconds</div>
  <div class="footer">
    Shared via <strong>DHARA</strong> legal aid app · For emergencies call 112
  </div>
</body>
</html>"""


def _not_found_html() -> str:
    return """<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DHARA — Page not found</title>
<style>body{font-family:sans-serif;text-align:center;padding:40px;color:#555}
h1{color:#dc2626;margin-bottom:12px}</style></head>
<body><h1>Link not found</h1>
<p>This journey link may have expired or been removed.</p>
<p style="margin-top:16px;font-size:13px;color:#aaa">For emergencies call 112</p>
</body></html>"""


def _expired_html(rec: dict) -> str:
    name = _escape(rec.get("user_display", "User"))
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DHARA — Link expired</title>
<style>body{{font-family:sans-serif;text-align:center;padding:40px;color:#555}}
h1{{color:#d97706;margin-bottom:12px}}</style></head>
<body><h1>Link expired</h1>
<p>{name}'s journey link has expired (links are valid for 24 hours).</p>
<p style="margin-top:16px;font-size:13px;color:#aaa">For emergencies call 112</p>
</body></html>"""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_dt(iso: Optional[str]) -> str:
    """Render a stored UTC timestamp in India Standard Time, labelled.

    Guardians read this page in India; an unlabelled UTC time is read as local
    time and misleads by five and a half hours.
    """
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone(timedelta(hours=5, minutes=30)))
        # Format: "15 Jan 2024, 10:30 AM IST"
        return dt.strftime("%-d %b %Y, %I:%M %p IST")
    except Exception:
        return iso[:16]
