"""One-time/idempotent seed script for the C0 Journey Registry.

Inserts one generic demo journey ("file-fir") exercising the module types
C1 will implement first: info_card, action_step, document_checklist,
rights_card, helpline_router. Deliberately generic content (not Women's
Shield) — Women's Shield gets its own dedicated seed later in C7.

Run manually:
    cd /app/backend && python seed_journeys.py

Safe to re-run — upserts by journey_id (idempotent), matching the behaviour
of POST /api/admin/journeys/import.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from dependencies import db

FILE_FIR_JOURNEY = {
    "journey_id": "file-fir",
    "title": "How to File an FIR",
    "summary": "Step-by-step guide to report a crime and get your First Information Report registered.",
    "category": "police",
    "tags": ["fir", "police", "criminal"],
    "language": "en",
    "steps": [
        {
            "order": 0,
            "module_type": "info_card",
            "title": "What is an FIR?",
            "body": (
                "An FIR (First Information Report) is the police's written record of a "
                "cognizable crime. Filing one is the first legal step to getting police action."
            ),
            "data": {},
        },
        {
            "order": 1,
            "module_type": "action_step",
            "title": "Where to go",
            "body": "You can file an FIR at any police station — not just the one in your area.",
            "data": {
                "steps": [
                    "Go to the nearest police station (Zero FIR allowed anywhere).",
                    "Ask for the duty officer and state what happened clearly.",
                    "If the officer refuses to file, ask to speak to the Station House Officer (SHO).",
                ]
            },
        },
        {
            "order": 2,
            "module_type": "document_checklist",
            "title": "What to carry",
            "body": "Bring these if you have them — but you can still file without all of them.",
            "data": {
                "items": [
                    "Government ID proof (Aadhaar, Voter ID, etc.)",
                    "Any written note of what happened, with date/time/place",
                    "Names/contact of witnesses, if any",
                    "Photos or evidence, if available",
                ]
            },
        },
        {
            "order": 3,
            "module_type": "rights_card",
            "title": "Your rights",
            "body": "These rights apply to everyone filing an FIR in India.",
            "data": {
                "rights": [
                    "You can file a Zero FIR at any police station, regardless of jurisdiction.",
                    "You are entitled to a free copy of the FIR once it is registered.",
                    "Police refusing to register a cognizable offence is itself an offence.",
                ]
            },
        },
        {
            "order": 4,
            "module_type": "helpline_router",
            "title": "If police refuse to file",
            "body": "Escalate in this order if your FIR is refused.",
            "data": {
                "helplines": [
                    {"name": "Superintendent of Police (in writing)", "number": ""},
                    {"name": "NALSA Legal Aid", "number": "15100"},
                    {"name": "Women Helpline", "number": "181"},
                ]
            },
        },
    ],
}


async def seed():
    now = datetime.now(timezone.utc).isoformat()
    steps = []
    for s in FILE_FIR_JOURNEY["steps"]:
        steps.append({
            "step_id": str(uuid.uuid4()),
            "order": s["order"],
            "module_type": s["module_type"],
            "title": s["title"],
            "body": s["body"],
            "data": s["data"],
        })

    existing = await db.journeys.find_one({"journey_id": FILE_FIR_JOURNEY["journey_id"]})
    if existing:
        await db.journeys.update_one(
            {"journey_id": FILE_FIR_JOURNEY["journey_id"]},
            {
                "$set": {
                    "title": FILE_FIR_JOURNEY["title"],
                    "summary": FILE_FIR_JOURNEY["summary"],
                    "category": FILE_FIR_JOURNEY["category"],
                    "tags": FILE_FIR_JOURNEY["tags"],
                    "language": FILE_FIR_JOURNEY["language"],
                    "steps": steps,
                    "is_active": True,
                    "updated_at": now,
                },
                "$inc": {"version": 1},
            },
        )
        print(f"Updated existing journey: {FILE_FIR_JOURNEY['journey_id']}")
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "journey_id": FILE_FIR_JOURNEY["journey_id"],
            "title": FILE_FIR_JOURNEY["title"],
            "summary": FILE_FIR_JOURNEY["summary"],
            "category": FILE_FIR_JOURNEY["category"],
            "tags": FILE_FIR_JOURNEY["tags"],
            "language": FILE_FIR_JOURNEY["language"],
            "steps": steps,
            "version": 1,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        await db.journeys.insert_one(doc)
        print(f"Created journey: {FILE_FIR_JOURNEY['journey_id']}")


if __name__ == "__main__":
    asyncio.run(seed())
