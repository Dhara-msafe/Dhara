"""Isolated QA environment bootstrap (Gate 1).

Seeds ONLY the QA database named by DB_NAME. Refuses to run against the
shared preview database. Idempotent: safe to re-run before every suite.

  DB_NAME=dhara_qa_g1 python tests/qa/seed_qa_env.py
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SHARED_DB_NAMES = {"gandhikar_db", "dhara", "test_database"}
QA_DB = os.environ.get("DB_NAME", "")
if not QA_DB.startswith("dhara_qa_") or QA_DB in SHARED_DB_NAMES:
    sys.exit(f"Refusing to seed DB_NAME={QA_DB!r}: must start with 'dhara_qa_'")
os.environ["OUTBOUND_MODE"] = "simulate"   # seeding must never dispatch anything

from dependencies import db, hash_pw  # noqa: E402

# Synthetic accounts used by the backend suite (passwords mirror test files).
SYNTHETIC_USERS = [
    ("voicetest2026@example.com", "TestPass123!", "9000000001"),
    ("fir-test-user2@example.com", "TestPass456!", "9000000002"),
    ("testpass_alpha@msafe.in", "TestPass456!", "9000000003"),
    ("protest@gandhikar.in", "test1234", "9000000004"),
    ("testuser@gandhikar.in", "test1234", "9000000005"),
]


async def main() -> None:
    import uuid
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    for email, pw, phone in SYNTHETIC_USERS:
        if not await db.users.find_one({"email": email}):
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": email, "name": "QA Synthetic",
                "phone": phone, "password_hash": hash_pw(pw), "created_at": now,
                "terms_accepted": True, "is_pro": False, "qa_synthetic": True,
            })
    # Per-network guest-session limiter: reset so repeated runs on the same
    # day are reproducible (QA DB only).
    r = await db.usage_daily.delete_many({"scope": "guest_ip"})
    # Daily per-user query cap (FREE_DAILY_QUERIES): reset for synthetic users
    # only, so the suite is reproducible when run more than once per day.
    qa_ids = [u["id"] async for u in db.users.find({"email": {"$in": [e for e, _, _ in SYNTHETIC_USERS]}}, {"id": 1})]
    await db.usage_daily.delete_many({"scope": "user", "user_id": {"$in": qa_ids}})
    await db.qa_outbox.delete_many({})
    print(f"[qa-seed] {QA_DB}: users={await db.users.count_documents({})} guest_ip_reset={r.deleted_count}")


asyncio.run(main())
