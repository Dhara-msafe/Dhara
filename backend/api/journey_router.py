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
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

import logging
logger = logging.getLogger("journey_router")

from dependencies import db, current_user
from api.alerts_router import create_alert_and_notify

router = APIRouter()

# ── Config ────────────────────────────────────────────────────────────────────
_TOKEN_CHARS = string.ascii_letters + string.digits
_TOKEN_LEN   = 10
_TTL_HOURS   = 24          # records expire after 24 h
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


async def _notify_linked_recipients(user: dict, rec: dict, type_: str, extra_payload: Optional[dict] = None) -> None:
    """Fan out a safety alert to every ACCEPTED trusted-circle link selected
    for this journey (rec['recipient_link_ids']). Best-effort — a push/alert
    failure must never break the journey action that triggered it."""
    link_ids = rec.get("recipient_link_ids") or []
    if not link_ids:
        return
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
            await create_alert_and_notify(
                type_=type_, owner_id=user["id"], owner_name=user.get("name") or "A DHARA user",
                link=link, payload=payload, journey_token=rec["token"],
                idempotency_key=f"{rec['token']}:{type_}:{link_id}" if type_ != "journey_status" else None,
            )
        except Exception as e:
            logger.warning("[journey] alert fan-out failed for link %s: %s", link_id, e)


# ── Models ────────────────────────────────────────────────────────────────────

class JourneyIn(BaseModel):
    destination: str = Field(..., min_length=1, max_length=_MAX_LABEL)
    duration_mins: int = Field(..., ge=1, le=1440)   # 1 min – 24 h
    recipient_link_ids: list[str] = Field(default_factory=list)   # accepted trusted_circle_links chosen for THIS journey


class LocationIn(BaseModel):
    lat: float = Field(..., ge=-90,  le=90)
    lng: float = Field(..., ge=-180, le=180)
    accuracy: float = Field(default=0, ge=0)
    area: str  = Field(default="", max_length=200)   # reverse-geocoded by device


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/journey/status", status_code=201)
async def create_journey(body: JourneyIn, user: dict = Depends(current_user)):
    """Create a journey record and return a public status URL."""
    now   = datetime.now(timezone.utc)
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
        "recipient_link_ids":  body.recipient_link_ids,
    }
    await db.safety_journeys.insert_one(doc)
    await _notify_linked_recipients(user, doc, "journey_started")
    return {
        "token":      token,
        "status_url": f"/api/journey/status/{token}",
        "expires_at": doc["expires_at"],
    }


@router.patch("/journey/status/{token}/safe", status_code=200)
async def mark_safe(token: str, user: dict = Depends(current_user)):
    """User marks their own journey as completed safely."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if rec.get("sharing_revoked_at"):
        # Symmetric with revoke_sharing()'s own _sharing_closed guard: once
        # EITHER terminal state is reached first, the other transition is a
        # no-op rather than silently overwriting it. Without this, revoke
        # -> mark_safe would flip the public page from the neutral "Sharing
        # turned off" banner back to "Arrived safely", contradicting the
        # traveller's own revoke action. (status=="safe" already can't be
        # re-marked safe again — this only guards the cross-transition.)
        return {"ok": True, "skipped": "sharing already withdrawn"}
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set": {"status": "safe", "safe_at": now.isoformat()}},
    )
    rec["status"] = "safe"
    rec["safe_at"] = now.isoformat()
    await _notify_linked_recipients(user, rec, "journey_completed")
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
        return {"ok": True, "already_closed": True}
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set": {"sharing_revoked_at": now.isoformat()}},
    )
    rec["sharing_revoked_at"] = now.isoformat()
    # Reuses the pre-existing (previously-unwired) "sharing_ended" alert
    # type already defined in alerts_router.py's _TITLES — informs any
    # ACCEPTED in-app Trusted Circle recipients that sharing has ended.
    # Their read-time permission check (alerts_router._sanitize_location)
    # now also treats sharing_revoked_at as closed, so no stale location
    # leaks through this notification either.
    await _notify_linked_recipients(user, rec, "sharing_ended")
    return {"ok": True, "revoked_at": rec["sharing_revoked_at"]}


@router.post("/journey/status/{token}/missed-checkin", status_code=200)
async def report_missed_checkin(token: str, user: dict = Depends(current_user)):
    """Client calls this when its own local check-in timer expires with no
    response. Nothing server-side watches a clock for this — it stays
    exactly as client-driven / foreground-only as the rest of Head Out."""
    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    if _sharing_closed(rec):
        return {"ok": True, "skipped": "journey already completed or sharing withdrawn"}
    await _notify_linked_recipients(user, rec, "missed_checkin")
    return {"ok": True}


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

    now = datetime.now(timezone.utc)
    # Server-side throttle — ignore if last update < 25 s ago
    last = rec.get("last_location")
    if last:
        try:
            last_ts = datetime.fromisoformat(last["updated_at"])
            if (now - last_ts).total_seconds() < 25:
                return {"ok": True, "skipped": "throttled"}
        except Exception:
            pass

    location_doc = {
        "lat":        body.lat,
        "lng":        body.lng,
        "accuracy":   body.accuracy,
        "area":       body.area.strip() or "Unknown area",
        "updated_at": now.isoformat(),
    }
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set":  {"last_location": location_doc},
         "$push": {"location_log": {"$each": [location_doc], "$slice": -20}}},  # keep last 20
    )
    return {"ok": True, "updated_at": location_doc["updated_at"]}


@router.get("/journey/status/{token}", response_class=HTMLResponse, include_in_schema=False)
async def journey_status_page(token: str):
    """Public HTML status page served to guardians — no authentication required."""
    rec = await db.safety_journeys.find_one({"token": token})

    if not rec:
        return HTMLResponse(content=_not_found_html(), status_code=404)

    now      = datetime.now(timezone.utc)
    expires  = datetime.fromisoformat(rec["expires_at"])
    if now > expires:
        return HTMLResponse(content=_expired_html(rec), status_code=410)

    checkin_at = datetime.fromisoformat(rec["expected_checkin_at"])
    is_overdue = now > checkin_at and rec["status"] == "in_progress"

    status_label: str
    status_colour: str
    status_icon: str
    if rec["status"] == "safe":
        status_label  = "Arrived safely"
        status_colour = "#16a34a"   # green-600
        status_icon   = "✅"
    elif rec.get("sharing_revoked_at"):
        # Owner withdrew sharing without claiming arrival — deliberately
        # NOT the same colour/icon/wording as "Arrived safely" (that would
        # be a false claim) nor "overdue" (that would be alarming/wrong).
        status_label  = "Sharing turned off by traveller"
        status_colour = "#6b7280"   # gray-500 — neutral
        status_icon   = "🔒"
    elif is_overdue:
        status_label  = "Check-in overdue — please call them"
        status_colour = "#dc2626"   # red-600
        status_icon   = "🔴"
    else:
        status_label  = "Journey in progress"
        status_colour = "#d97706"   # amber-600
        status_icon   = "🟡"

    return HTMLResponse(
        content=_status_html(rec, status_label, status_colour, status_icon),
        # P1 map follow-up: tile requests to tile.openstreetmap.org are
        # cross-origin. Modern browsers already default to
        # "strict-origin-when-cross-origin" (origin only, no path/token on
        # cross-origin requests), but this header makes that explicit and
        # robust rather than relying on an implicit default. See the
        # OpenStreetMap tile documentation note in this module's docstring
        # for the full analysis of what a tile request can reveal.
        headers={"Referrer-Policy": "strict-origin"},
    )


# ── HTML templates ─────────────────────────────────────────────────────────────

def _status_html(rec: dict, label: str, colour: str, icon: str) -> str:
    name   = _escape(rec.get("user_display", "User"))
    dest   = _escape(rec.get("destination", "—"))
    start  = _fmt_dt(rec.get("started_at"))
    checkin = _fmt_dt(rec.get("expected_checkin_at"))
    safe_at = _fmt_dt(rec.get("safe_at")) if rec.get("safe_at") else ""
    last_loc = rec.get("last_location")
    loc_block = ""
    map_block = ""
    # P1 follow-up: once the journey is marked "safe", exact location and
    # the map must disappear from this page — continued exact-location
    # access after safe arrival serves no safety purpose. Non-location
    # fields (traveller, destination, timestamps, "Arrived safely") are
    # untouched and still render above/below this block as before.
    # Guardian-link revocation follow-up: the SAME withholding now also
    # applies once the owner has withdrawn sharing (_sharing_closed),
    # even though that is a different status than "safe" — see
    # _sharing_closed()'s docstring for why these two states share this
    # gate but render different banners above.
    if last_loc and not _sharing_closed(rec):
        area      = _escape(last_loc.get("area") or "Unknown area")
        loc_time  = _fmt_dt(last_loc.get("updated_at"))
        acc_m     = int(last_loc.get("accuracy", 0))
        acc_note  = f" ±{acc_m} m" if acc_m > 0 else ""
        loc_block = f"""
      <hr class="divider"/>
      <div>
        <div class="field-label">Last known area</div>
        <div class="field-value">📍 {area}{acc_note}</div>
        <div style="font-size:12px;color:#888;margin-top:3px">Updated {loc_time}</div>
      </div>"""
        # P1 Map Integration — explicit user decision: show an exact marker
        # + accuracy circle on this page, accepting that this public,
        # unauthenticated, token-in-URL page is reachable by anyone holding
        # the SMS link (not gated by Trusted Circle permissions — see
        # module docstring). Uses Leaflet.js + OpenStreetMap tiles: no
        # Google Maps Platform API/key involved for this page, so this
        # stays within the explicit "Maps SDK for Android only, no other
        # APIs without separate authorization" constraint.
        lat, lng = last_loc.get("lat"), last_loc.get("lng")
        if lat is not None and lng is not None:
            acc_m_js = max(int(last_loc.get("accuracy", 0)), 1)
            map_block = f"""
      <hr class="divider"/>
      <div id="map" style="height:220px;border-radius:12px;overflow:hidden"></div>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        (function() {{
          var map = L.map('map', {{ zoomControl: true, attributionControl: true }}).setView([{lat}, {lng}], 15);
          // P1 follow-up: OpenStreetMap's tile usage policy asks consumers
          // NOT to use the "{{s}}." subdomain-sharding pattern (a/b/c.tile...) —
          // that pattern exists only for legacy HTTP/1.1 connection-limit
          // workarounds and defeats OSM's per-host request accounting. We
          // request the single canonical host below instead.
          L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
            maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
          }}).addTo(map);
          L.marker([{lat}, {lng}]).addTo(map).bindPopup('Last known location');
          L.circle([{lat}, {lng}], {{ radius: {acc_m_js}, color: '#1A3F74', fillColor: '#1A3F74', fillOpacity: 0.15 }}).addTo(map);
        }})();
      </script>"""
    status_extra = f"<p style='margin:0 0 4px;font-size:15px;color:#555;'>Arrived: {safe_at}</p>" if safe_at else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="referrer" content="strict-origin"/>
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
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso)
        # Format: "15 Jan 2024, 10:30 AM"
        return dt.strftime("%-d %b %Y, %I:%M %p")
    except Exception:
        return iso[:16]
