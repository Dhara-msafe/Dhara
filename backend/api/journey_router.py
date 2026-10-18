"""
S3 Phase 2 — Guardian Journey Status Page
==========================================

Three endpoints:

  POST /api/journey/status           (authenticated)  → create journey record
  GET  /api/journey/status/{token}   (public)         → HTML status page for guardian
  PATCH /api/journey/status/{token}/safe (authenticated) → user marks themselves safe

DPDP-compliance:
  - Only user's first name is stored (no surname, no phone, no email).
  - No GPS coordinates are stored or served.
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

from dependencies import db, current_user

router = APIRouter()

# ── Config ────────────────────────────────────────────────────────────────────
_TOKEN_CHARS = string.ascii_letters + string.digits
_TOKEN_LEN   = 10
_TTL_HOURS   = 24          # records expire after 24 h
_MAX_LABEL   = 120         # destination label max chars

def _new_token() -> str:
    return "".join(secrets.choice(_TOKEN_CHARS) for _ in range(_TOKEN_LEN))


# ── Models ────────────────────────────────────────────────────────────────────

class JourneyIn(BaseModel):
    destination: str = Field(..., min_length=1, max_length=_MAX_LABEL)
    duration_mins: int = Field(..., ge=1, le=1440)   # 1 min – 24 h


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
        "created_at":          now.isoformat(),
        "expires_at":          (now + timedelta(hours=_TTL_HOURS)).isoformat(),
    }
    await db.safety_journeys.insert_one(doc)
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
    now = datetime.now(timezone.utc)
    await db.safety_journeys.update_one(
        {"token": token},
        {"$set": {"status": "safe", "safe_at": now.isoformat()}},
    )
    return {"ok": True, "safe_at": now.isoformat()}


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
    elif is_overdue:
        status_label  = "Check-in overdue — please call them"
        status_colour = "#dc2626"   # red-600
        status_icon   = "🔴"
    else:
        status_label  = "Journey in progress"
        status_colour = "#d97706"   # amber-600
        status_icon   = "🟡"

    return HTMLResponse(content=_status_html(rec, status_label, status_colour, status_icon))


# ── HTML templates ─────────────────────────────────────────────────────────────

def _status_html(rec: dict, label: str, colour: str, icon: str) -> str:
    name   = _escape(rec.get("user_display", "User"))
    dest   = _escape(rec.get("destination", "—"))
    start  = _fmt_dt(rec.get("started_at"))
    checkin = _fmt_dt(rec.get("expected_checkin_at"))
    safe_at = _fmt_dt(rec.get("safe_at")) if rec.get("safe_at") else ""
    status_extra = f"<p style='margin:0 0 4px;font-size:15px;color:#555;'>Arrived: {safe_at}</p>" if safe_at else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
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
