"""E2/A2 legacy migration: stamp user_id on evidence_anchors / evidence_backups /
evidence_upload_sessions rows that predate the user_id field.

Rules (owner-approved):
  * Dry-run by default. Writes ONLY with --apply, and only after owner approval.
  * Before any write, the full contents of every evidence collection are saved
    to backend/data/migration_backups/evidence_<timestamp>.json.
  * Sets user_id = scope ONLY where scope matches an existing users.id.
  * Rows whose scope matches no user are LISTED, never modified or deleted.
  * This script never deletes anything.

Usage:  python scripts/migrate_evidence_user_id.py            # dry-run
        python scripts/migrate_evidence_user_id.py --apply    # after approval
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
COLLECTIONS = ["evidence_anchors", "evidence_backups", "evidence_upload_sessions"]
MISSING = {"user_id": {"$exists": False}}


async def main(apply: bool) -> None:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    print(f"Mode: {'APPLY' if apply else 'DRY-RUN (no writes)'}")

    if apply:
        backup_dir = ROOT / "data" / "migration_backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        snapshot = {c: await db[c].find({}).to_list(length=None) for c in COLLECTIONS}
        path = backup_dir / f"evidence_{ts}.json"
        path.write_text(json_util.dumps(snapshot, indent=1))
        print(f"Backup written: {path} ({sum(len(v) for v in snapshot.values())} rows)")

    for c in COLLECTIONS:
        scopes = await db[c].distinct("scope", MISSING)
        known = set(await db.users.distinct("id", {"id": {"$in": scopes}}))
        orphans = [s for s in scopes if s not in known]
        to_stamp = await db[c].count_documents({**MISSING, "scope": {"$in": list(known)}})
        orphan_rows = await db[c].count_documents({**MISSING, "scope": {"$in": orphans}})
        print(f"{c}: rows to stamp={to_stamp}, orphan rows (listed only)={orphan_rows}")
        for s in orphans:
            print(f"    orphan scope: {s}")
        if apply and known:
            res = await db[c].update_many(
                {**MISSING, "scope": {"$in": list(known)}},
                [{"$set": {"user_id": "$scope"}}],
            )
            print(f"    stamped: {res.modified_count}")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv[1:]))
