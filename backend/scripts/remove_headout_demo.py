"""
remove_headout_demo.py — removes every document seeded by seed_headout_demo.py.

Deletes all records where  seed_tag == 'headout_demo_19nov'  from:
  • db.users
  • db.safety_saved_places
  • db.trusted_circle_links

Requires --i-understand-this-is-production on the CLI (same as the seed script)
to prevent accidental runs.

Usage:
  cd /app/backend
  python3 scripts/remove_headout_demo.py --i-understand-this-is-production
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

if "--i-understand-this-is-production" not in sys.argv:
    print(
        "ERROR: Requires explicit confirmation.\n"
        "Re-run with:  python3 scripts/remove_headout_demo.py --i-understand-this-is-production"
    )
    sys.exit(1)

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME   = os.environ.get("DB_NAME", "gandhikar_db")
SEED_TAG  = "headout_demo_19nov"

COLLECTIONS = [
    "users",
    "safety_saved_places",
    "trusted_circle_links",
]


async def main() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"\n  DB       : {DB_NAME}")
    print(f"  SEED_TAG : {SEED_TAG}\n")

    total_deleted = 0
    for coll_name in COLLECTIONS:
        coll = db[coll_name]
        count = await coll.count_documents({"seed_tag": SEED_TAG})
        if count == 0:
            print(f"  [{coll_name}]  nothing to delete")
            continue
        result = await coll.delete_many({"seed_tag": SEED_TAG})
        print(f"  [{coll_name}]  deleted {result.deleted_count} document(s)")
        total_deleted += result.deleted_count

    client.close()
    print(f"\nDone. Total deleted: {total_deleted} document(s).")


if __name__ == "__main__":
    asyncio.run(main())
