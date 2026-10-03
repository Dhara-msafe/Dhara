"""C0 — Journey Registry: server-driven workflow definitions.

A "journey" is a versioned, ordered sequence of UI "steps" (modules) that the
app can render without a client update — e.g. "File an FIR", later
"Women's Shield quick exit". Steps are typed (module_type) so the frontend's
C1 module library can pick the right renderer for each one.

Public endpoints (no auth) list/read ACTIVE journeys only — unauthenticated
and guest users must be able to see "what to do" content, same spirit as
the existing Emergency Helplines / Know Your Rights routes.

Admin endpoints (X-Admin-Key header) create/update/deactivate journeys and
support bulk import for seeding. This reuses the SAME admin-key mechanism
already protecting /api/admin/export/*.csv and /api/admin/stats in
server.py (see dependencies.check_admin_key) — no new auth concept.

Extracted as its own router (Phase 1 modularization pattern, same as
api/fir_router.py, api/chat_router.py, api/auth_router.py).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

from dependencies import db, logger, check_admin_key

router = APIRouter()

# Module types the C1 module library will implement first. Not enforced as a
# hard enum (new types will be added as C1/C7 grow) — documented here so seed
# content and future endpoints/components agree on the vocabulary.
KNOWN_MODULE_TYPES = {
    "info_card", "action_step", "document_checklist", "helpline_router",
    "rights_card", "form_step",
}


class JourneyStepIn(BaseModel):
    step_id: Optional[str] = None
    order: int = 0
    module_type: str
    title: str
    body: str = ""
    data: dict = Field(default_factory=dict)


class JourneyIn(BaseModel):
    journey_id: str = Field(min_length=2, max_length=80)
    title: str
    summary: str = ""
    category: str = "generic"
    tags: List[str] = Field(default_factory=list)
    language: str = "en"
    steps: List[JourneyStepIn] = Field(default_factory=list)


class JourneyUpdateIn(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    steps: Optional[List[JourneyStepIn]] = None
    is_active: Optional[bool] = None


def _normalise_steps(steps: List[JourneyStepIn]) -> list[dict]:
    out = []
    for i, s in enumerate(steps):
        out.append({
            "step_id": s.step_id or str(uuid.uuid4()),
            "order": s.order if s.order is not None else i,
            "module_type": s.module_type,
            "title": s.title,
            "body": s.body,
            "data": s.data,
        })
    return out


def _public_summary(doc: dict) -> dict:
    return {
        "journey_id": doc["journey_id"],
        "title": doc["title"],
        "summary": doc.get("summary", ""),
        "category": doc.get("category", "generic"),
        "tags": doc.get("tags", []),
        "language": doc.get("language", "en"),
        "version": doc.get("version", 1),
        "step_count": len(doc.get("steps", [])),
        "updated_at": doc.get("updated_at"),
    }


def _public_full(doc: dict) -> dict:
    out = _public_summary(doc)
    out["steps"] = sorted(doc.get("steps", []), key=lambda s: s.get("order", 0))
    return out


# ── Public read endpoints ───────────────────────────────────────────────────

@router.get("/journeys")
async def list_journeys(category: Optional[str] = None, tag: Optional[str] = None):
    """List active journeys, lightweight (no step bodies) — for home-screen
    shelves / hub cards. Call GET /journeys/{id} to open one."""
    q: dict = {"is_active": True}
    if category:
        q["category"] = category
    if tag:
        q["tags"] = tag
    cursor = db.journeys.find(q, {"_id": 0}).sort("updated_at", -1).limit(100)
    docs = await cursor.to_list(length=100)
    return {"count": len(docs), "journeys": [_public_summary(d) for d in docs]}


@router.get("/journeys/{journey_id}")
async def get_journey(journey_id: str):
    doc = await db.journeys.find_one({"journey_id": journey_id, "is_active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Journey not found")
    return _public_full(doc)


# ── Admin write endpoints (X-Admin-Key, shared with server.py admin routes) ───

@router.post("/admin/journeys")
async def create_journey(body: JourneyIn, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    existing = await db.journeys.find_one({"journey_id": body.journey_id})
    if existing:
        raise HTTPException(400, f"journey_id '{body.journey_id}' already exists — use PUT to update")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "journey_id": body.journey_id,
        "title": body.title,
        "summary": body.summary,
        "category": body.category,
        "tags": body.tags,
        "language": body.language,
        "steps": _normalise_steps(body.steps),
        "version": 1,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    await db.journeys.insert_one(doc)
    logger.info(f"[journeys] created journey_id={body.journey_id} steps={len(doc['steps'])}")
    return _public_full(doc)


@router.put("/admin/journeys/{journey_id}")
async def update_journey(journey_id: str, body: JourneyUpdateIn, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    existing = await db.journeys.find_one({"journey_id": journey_id})
    if not existing:
        raise HTTPException(404, "Journey not found")
    update: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.title is not None:
        update["title"] = body.title
    if body.summary is not None:
        update["summary"] = body.summary
    if body.category is not None:
        update["category"] = body.category
    if body.tags is not None:
        update["tags"] = body.tags
    if body.is_active is not None:
        update["is_active"] = body.is_active
    if body.steps is not None:
        update["steps"] = _normalise_steps(body.steps)
    update["version"] = int(existing.get("version", 1)) + 1
    await db.journeys.update_one({"journey_id": journey_id}, {"$set": update})
    doc = await db.journeys.find_one({"journey_id": journey_id}, {"_id": 0})
    logger.info(f"[journeys] updated journey_id={journey_id} -> v{update['version']}")
    return _public_full(doc)


@router.delete("/admin/journeys/{journey_id}")
async def deactivate_journey(journey_id: str, x_admin_key: Optional[str] = Header(None)):
    """Soft-delete — flips is_active False. Journeys are never hard-deleted so
    a client caching an old journey_id degrades to a clean 404 instead of a
    dangling reference that could quietly resurrect later."""
    check_admin_key(x_admin_key)
    existing = await db.journeys.find_one({"journey_id": journey_id})
    if not existing:
        raise HTTPException(404, "Journey not found")
    await db.journeys.update_one(
        {"journey_id": journey_id},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    logger.info(f"[journeys] deactivated journey_id={journey_id}")
    return {"ok": True, "journey_id": journey_id, "is_active": False}


@router.post("/admin/journeys/import")
async def bulk_import_journeys(body: List[JourneyIn], x_admin_key: Optional[str] = Header(None)):
    """Idempotent bulk import — upserts by journey_id, bumping version on
    existing docs. Built for seeding content in batches without needing one
    API call per journey (admin tooling / future CMS import)."""
    check_admin_key(x_admin_key)
    now = datetime.now(timezone.utc).isoformat()
    results = []
    for item in body:
        steps = _normalise_steps(item.steps)
        existing = await db.journeys.find_one({"journey_id": item.journey_id})
        if existing:
            await db.journeys.update_one(
                {"journey_id": item.journey_id},
                {
                    "$set": {
                        "title": item.title, "summary": item.summary, "category": item.category,
                        "tags": item.tags, "language": item.language, "steps": steps,
                        "is_active": True, "updated_at": now,
                    },
                    "$inc": {"version": 1},
                },
            )
            results.append({"journey_id": item.journey_id, "action": "updated"})
        else:
            doc = {
                "id": str(uuid.uuid4()), "journey_id": item.journey_id, "title": item.title,
                "summary": item.summary, "category": item.category, "tags": item.tags,
                "language": item.language, "steps": steps, "version": 1, "is_active": True,
                "created_at": now, "updated_at": now,
            }
            await db.journeys.insert_one(doc)
            results.append({"journey_id": item.journey_id, "action": "created"})
    logger.info(f"[journeys] bulk_import: {len(results)} journeys processed")
    return {"count": len(results), "results": results}
