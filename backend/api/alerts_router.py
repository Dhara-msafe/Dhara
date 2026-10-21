"""Safety Alerts — recipient inbox (Part B/P3+P4).

Collection: safety_alerts
  id, type (invitation|journey_started|journey_status|missed_checkin|
       help_requested|arrival_confirmed|journey_completed|
       location_unavailable|sharing_ended),
  owner_id, owner_name, recipient_user_id, link_id (-> trusted_circle_links),
  journey_token (-> safety_journeys, optional),
  payload: {destination, eta, journey_status, last_location{lat,lng,accuracy,age_minutes}},
  state: CREATED|QUEUED|FAILED|OPENED|ACKNOWLEDGED|EXPIRED|ACCESS_REVOKED
  idempotency_key (unique-ish, used to dedupe retried creations),
  created_at, read_at, acknowledged_at

Note on delivery state: send_push() here is fire-and-forget (SuprSend relay
gives no delivery receipt back to this app), so we deliberately do NOT claim
a "DELIVERED" state we can't prove — alerts move CREATED -> QUEUED (push
attempted) and then rely on the client reporting OPENED/ACKNOWLEDGED itself.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends

from dependencies import db, current_user, logger

try:
    from push import send_push
except Exception:   # pragma: no cover
    async def send_push(*a, **kw):  # type: ignore
        return None

router = APIRouter()

_TITLES = {
    "invitation":            "Trusted Circle invitation",
    "journey_started":       "Journey started",
    "journey_status":        "Journey update",
    "missed_checkin":        "Missed check-in",
    "help_requested":        "Help requested",
    "arrival_confirmed":     "Arrived safely",
    "journey_completed":     "Journey completed",
    "location_unavailable":  "Location temporarily unavailable",
    "sharing_ended":         "Location sharing has ended",
}


def _sanitize_location(payload: dict, link: Optional[dict], journey: Optional[dict] = None) -> dict:
    """Server-side enforcement (do not rely on the frontend to hide this).

    Strips every location-bearing field from the alert payload unless the
    OWNER'S CURRENT permission record on `link` explicitly grants
    `temp_location` to this recipient on an accepted link. Fails closed:
    a missing link, a non-accepted link, or missing/unsupported permission
    metadata are all treated as "not permitted" — never assume sharing is
    allowed. Scoped narrowly to the `last_location` sub-object (lat, lng,
    accuracy, area, age_minutes, and any other nested fields it carries).

    ALSO fails closed once the related journey (`journey`, the LIVE
    safety_journeys record for the alert's journey_token) is CLOSED —
    either status "safe" (student arrived) or the owner has explicitly
    revoked sharing via POST .../revoke (`sharing_revoked_at` set): once
    either happens, continued exact-location access serves no safety
    purpose, so last_location is removed regardless of the recipient's
    permission grant — this is a stricter, additional gate on top of the
    permission check, not a replacement for it.
    """
    sanitized = dict(payload or {})
    permissions = (link or {}).get("permissions") or {}
    is_accepted = bool(link) and link.get("status") == "accepted"
    temp_location_granted = is_accepted and permissions.get("temp_location") is True
    journey_is_closed = bool(journey) and (
        journey.get("status") == "safe" or bool(journey.get("sharing_revoked_at"))
    )
    if not temp_location_granted or journey_is_closed:
        sanitized.pop("last_location", None)
    return sanitized


def _public_alert(a: dict, link: Optional[dict] = None, journey: Optional[dict] = None) -> dict:
    """`link` is the LIVE trusted_circle_links record for a["link_id"],
    looked up fresh on every read — never trust a value cached at alert
    creation time, since revocation/permission changes must take effect
    immediately for all historical alerts too. `journey` is the LIVE
    safety_journeys record for a["journey_token"] (may be None if the
    alert has no journey_token, or the journey was deleted) — see
    _sanitize_location for why its "safe" status also strips location."""
    revoked = (not link) or link.get("status") != "accepted"
    return {
        "id": a["id"],
        "type": a["type"],
        "title": _TITLES.get(a["type"], "Safety alert"),
        "owner_name": a.get("owner_name"),
        "link_id": a.get("link_id"),
        "journey_token": a.get("journey_token"),
        "payload": {} if revoked else _sanitize_location(a.get("payload", {}), link, journey),
        "state": "ACCESS_REVOKED" if revoked else a.get("state", "CREATED"),
        "created_at": a["created_at"],
        "read_at": a.get("read_at"),
        "acknowledged_at": a.get("acknowledged_at"),
        "access_revoked": revoked,
    }


async def create_alert_and_notify(
    *, type_: str, owner_id: str, owner_name: str, link: dict,
    payload: dict, journey_token: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> Optional[dict]:
    """Shared helper used by journey_router.py and trusted_circle_router.py.
    Only ever creates an alert for an ACCEPTED, non-muted link — enforced
    here so callers can't accidentally notify someone without consent.
    Idempotent: a repeated call with the same idempotency_key is a no-op.
    """
    if not link or link.get("status") != "accepted" or not link.get("invitee_user_id"):
        return None
    if idempotency_key:
        existing = await db.safety_alerts.find_one({"idempotency_key": idempotency_key})
        if existing:
            return existing

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "type": type_,
        "owner_id": owner_id,
        "owner_name": owner_name,
        "recipient_user_id": link["invitee_user_id"],
        "link_id": link["id"],
        "journey_token": journey_token,
        "payload": payload,
        "state": "CREATED",
        "idempotency_key": idempotency_key,
        "created_at": now,
        "read_at": None,
        "acknowledged_at": None,
    }
    await db.safety_alerts.insert_one(doc)

    if not link.get("muted"):
        try:
            await send_push(
                recipients=[link["invitee_user_id"]],
                data={
                    "title": _TITLES.get(type_, "Safety alert"),
                    # Deliberately generic on a locked screen — no destination/location text here.
                    "message": f"{owner_name} has an update for you in DHARA.",
                    "action_url": f"/alerts/{doc['id']}",
                },
                idempotency_key=idempotency_key or doc["id"],
            )
            await db.safety_alerts.update_one({"id": doc["id"]}, {"$set": {"state": "QUEUED"}})
            doc["state"] = "QUEUED"
        except Exception as e:
            logger.warning("[alerts] push failed (alert still saved): %s", e)
            await db.safety_alerts.update_one({"id": doc["id"]}, {"$set": {"state": "FAILED"}})
            doc["state"] = "FAILED"
    return doc


@router.get("/alerts/unread-count")
async def unread_count(user: dict = Depends(current_user)):
    n = await db.safety_alerts.count_documents({"recipient_user_id": user["id"], "read_at": None})
    pending_invites = await db.trusted_circle_links.count_documents({"invitee_user_id": user["id"], "status": "pending"})
    return {"count": n + pending_invites}


@router.get("/alerts")
async def list_alerts(filter: str = "all", user: dict = Depends(current_user)):
    q: dict = {"recipient_user_id": user["id"]}
    if filter == "active":
        q["type"] = {"$in": ["journey_started", "journey_status", "missed_checkin", "help_requested", "location_unavailable"]}
    elif filter == "completed":
        q["type"] = {"$in": ["arrival_confirmed", "journey_completed", "sharing_ended"]}
    alerts = [a async for a in db.safety_alerts.find(q).sort("created_at", -1).limit(200)]

    # Server-side enforcement: fetch the LIVE link/permission record for
    # every alert in this page before serializing — list results must get
    # identical protection to the detail endpoint (previously this endpoint
    # returned raw, unsanitized payloads with no revocation/permission
    # check at all). Batched to avoid N+1 queries.
    link_ids = {a["link_id"] for a in alerts if a.get("link_id")}
    links_by_id: dict = {}
    if link_ids:
        async for l in db.trusted_circle_links.find({"id": {"$in": list(link_ids)}}):
            links_by_id[l["id"]] = l

    # P1 follow-up: also fetch the LIVE journey record for every alert so a
    # journey marked "safe" SINCE the alert was created strips location on
    # every subsequent read here too — not just on the Guardian page.
    journey_tokens = {a["journey_token"] for a in alerts if a.get("journey_token")}
    journeys_by_token: dict = {}
    if journey_tokens:
        async for j in db.safety_journeys.find({"token": {"$in": list(journey_tokens)}}):
            journeys_by_token[j["token"]] = j

    return [
        _public_alert(a, links_by_id.get(a.get("link_id")), journeys_by_token.get(a.get("journey_token")))
        for a in alerts
    ]


@router.get("/alerts/{alert_id}")
async def get_alert(alert_id: str, user: dict = Depends(current_user)):
    a = await db.safety_alerts.find_one({"id": alert_id})
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["recipient_user_id"] != user["id"]:
        raise HTTPException(403, "Not your alert")

    # Live re-check: if the link was revoked/left/declined SINCE this alert
    # was created, or the owner's permissions changed, this always reflects
    # the CURRENT record — never a value cached at alert-creation time.
    link = await db.trusted_circle_links.find_one({"id": a.get("link_id")})
    journey = await db.safety_journeys.find_one({"token": a.get("journey_token")}) if a.get("journey_token") else None
    out = _public_alert(a, link, journey)
    if not out["access_revoked"]:
        out["permissions"] = (link.get("permissions") if link else {}) or {}
        owner = await db.users.find_one({"id": a["owner_id"]}, {"_id": 0, "phone": 1})
        out["owner_phone"] = (owner or {}).get("phone")
    return out


@router.post("/alerts/{alert_id}/read")
async def mark_read(alert_id: str, user: dict = Depends(current_user)):
    a = await db.safety_alerts.find_one({"id": alert_id})
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["recipient_user_id"] != user["id"]:
        raise HTTPException(403, "Not your alert")
    if not a.get("read_at"):
        now = datetime.now(timezone.utc).isoformat()
        await db.safety_alerts.update_one(
            {"id": alert_id},
            {"$set": {"read_at": now, "state": "OPENED" if a.get("state") == "QUEUED" else a.get("state", "OPENED")}},
        )
    return {"ok": True}


@router.post("/alerts/{alert_id}/ack")
async def acknowledge(alert_id: str, user: dict = Depends(current_user)):
    """Records ONLY that this recipient acknowledged the alert — never
    implies the student is safe, and never auto-closes their journey."""
    a = await db.safety_alerts.find_one({"id": alert_id})
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["recipient_user_id"] != user["id"]:
        raise HTTPException(403, "Not your alert")
    now = datetime.now(timezone.utc).isoformat()
    await db.safety_alerts.update_one(
        {"id": alert_id}, {"$set": {"acknowledged_at": now, "state": "ACKNOWLEDGED"}},
    )
    return {"ok": True, "acknowledged_at": now}
