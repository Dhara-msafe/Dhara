"""In-app issue reporter — testers and users report problems from inside DHARA.

ADDITIVE ONLY. Nothing here touches SOS, Family Journey, auth, legal chat or
location behaviour; it only writes to its own `issue_reports` collection.

PRIVACY (this is a safety app):
  * A report stores the reporter's user id and nothing else that identifies
    them — no email, no phone, no name.
  * Free text is length-capped and stripped of control characters. We never ask
    for, and never store, coordinates, message contents or media.
  * The client-captured metadata is limited to build/platform/device/route.
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from dependencies import db, current_user, check_admin_key

logger = logging.getLogger("issues_router")
router = APIRouter()

COLLECTION = "issue_reports"

CATEGORIES = [
    "Installation, Upgrade & Launch",
    "Login & Session",
    "Navigation & UI",
    "Forms & Profile",
    "SOS & Alert Delivery",
    "Guardian Journey & Check-in",
    "Trusted Circle & Guardian Access",
    "Location & Permissions",
    "Audio, Camera & Notifications",
    "Evidence Locker",
    "Voice & Assistant",
    "Legal Intelligence",
    "Network & Offline Recovery",
    "Performance & Device Compatibility",
    "Accessibility",
    "Security & Privacy",
    "Other",
]

STATUSES = ["New", "In progress", "Resolved"]

TITLE_MAX = 120
DESCRIPTION_MAX = 2000
META_MAX = 120
REPORTS_PER_HOUR = 20

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(value: Optional[str], limit: int) -> str:
    """Trim, drop control characters, hard-cap the length."""
    text = _CONTROL_CHARS.sub("", (value or "").replace("\r\n", "\n")).strip()
    return text[:limit]


class ReportIn(BaseModel):
    category: str
    title: str
    description: str
    # Client-captured context — all optional, all short, none identifying.
    app_version: Optional[str] = Field(default=None)
    build: Optional[str] = Field(default=None)
    platform: Optional[str] = Field(default=None)
    os_version: Optional[str] = Field(default=None)
    device_model: Optional[str] = Field(default=None)
    current_screen: Optional[str] = Field(default=None)
    created_at: Optional[str] = Field(default=None)  # device clock, advisory only

    @field_validator("category")
    @classmethod
    def _known_category(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in CATEGORIES:
            raise ValueError("Unknown category.")
        return v

    @field_validator("title", "description")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("This field is required.")
        return v


class StatusIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in STATUSES:
            raise ValueError(f"status must be one of: {', '.join(STATUSES)}")
        return v


@router.get("/issues/categories")
async def list_categories():
    """The one source of truth for the picker, so the app can never submit a
    category the server would reject."""
    return {"categories": CATEGORIES, "statuses": STATUSES}


@router.post("/issues", status_code=201)
async def create_report(body: ReportIn, user: dict = Depends(current_user)):
    title = _clean(body.title, TITLE_MAX)
    description = _clean(body.description, DESCRIPTION_MAX)
    if not title or not description:
        raise HTTPException(400, "A title and a description are required.")

    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = await db[COLLECTION].count_documents({
        "user_id": user["id"],
        "created_at": {"$gte": since.isoformat()},
    })
    if recent >= REPORTS_PER_HOUR:
        raise HTTPException(
            429,
            "You have sent a lot of reports in the last hour. "
            "Please wait a little before sending another one.",
        )

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],          # the ONLY reporter identifier stored
        "category": body.category,
        "title": title,
        "description": description,
        "status": "New",
        "app_version": _clean(body.app_version, META_MAX) or None,
        "build": _clean(body.build, META_MAX) or None,
        "platform": _clean(body.platform, META_MAX) or None,
        "os_version": _clean(body.os_version, META_MAX) or None,
        "device_model": _clean(body.device_model, META_MAX) or None,
        "current_screen": _clean(body.current_screen, META_MAX) or None,
        "device_reported_at": _clean(body.created_at, META_MAX) or None,
        "created_at": now,              # server clock wins
        "updated_at": now,
    }
    await db[COLLECTION].insert_one(dict(doc))
    logger.info("[issues] report %s category=%r", doc["id"], doc["category"])
    return {"id": doc["id"], "status": doc["status"], "created_at": now}


@router.get("/issues")
async def list_reports(
    category: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
    x_admin_key: Optional[str] = Header(None),
):
    """Admin-only. Returns plain JSON, which doubles as the export."""
    check_admin_key(x_admin_key)
    query: dict = {}
    if category:
        if category not in CATEGORIES:
            raise HTTPException(400, "Unknown category.")
        query["category"] = category
    if status:
        if status not in STATUSES:
            raise HTTPException(400, f"status must be one of: {', '.join(STATUSES)}")
        query["status"] = status
    cursor = db[COLLECTION].find(query, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 1000)))
    items = await cursor.to_list(length=1000)
    counts: dict = {}
    for cat in CATEGORIES:
        n = await db[COLLECTION].count_documents({**query, "category": cat})
        if n:
            counts[cat] = n
    return {"items": items, "count": len(items), "by_category": counts}


@router.patch("/issues/{report_id}")
async def set_status(report_id: str, body: StatusIn, x_admin_key: Optional[str] = Header(None)):
    """Admin-only status change."""
    check_admin_key(x_admin_key)
    result = await db[COLLECTION].find_one_and_update(
        {"id": report_id},
        {"$set": {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "No report with that id.")
    return result


@router.get("/admin/error-events")
async def list_error_events(
    route: Optional[str] = None,
    error_type: Optional[str] = None,
    limit: int = 200,
    x_admin_key: Optional[str] = Header(None),
):
    """Admin-only. Server errors captured by the unhandled-exception handler.

    PRIVACY: these records never contain request bodies, headers, tokens,
    query strings, coordinates or message contents — see
    server.py::_record_error_event.
    """
    check_admin_key(x_admin_key)
    query: dict = {}
    if route:
        query["route"] = _clean(route, META_MAX)
    if error_type:
        query["error_type"] = _clean(error_type, META_MAX)
    cursor = (
        db.error_events.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 1000)))
    )
    items = await cursor.to_list(length=1000)
    for it in items:
        created = it.get("created_at")
        if hasattr(created, "isoformat"):
            it["created_at"] = created.isoformat()
    by_route: dict = {}
    by_type: dict = {}
    for field, bucket in (("route", by_route), ("error_type", by_type)):
        rows = await db.error_events.aggregate([
            {"$match": query},
            {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 50},
        ]).to_list(length=50)
        for row in rows:
            bucket[row["_id"] or "?"] = row["n"]
    total = await db.error_events.count_documents(query)
    return {"items": items, "count": len(items), "total": total,
            "by_route": by_route, "by_error_type": by_type}


async def ensure_indexes() -> None:
    """Called once at startup; safe to re-run."""
    try:
        await db[COLLECTION].create_index([("created_at", -1)], name="issue_reports_created")
        await db[COLLECTION].create_index("user_id", name="issue_reports_user")
        await db[COLLECTION].create_index("category", name="issue_reports_category")
    except Exception as exc:  # pragma: no cover - index warnings never block boot
        logger.warning("[issues] index creation warning: %s", exc)
