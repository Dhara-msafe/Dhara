"""Answer Quality Framework F2 — one-off backfill script.

NOT executed as part of Phase 1 delivery. NOT imported by server.py,
chat_router.py, pipeline.py, or any other runtime module — importing this
file has zero effect on the running application. Provided only so a
FUTURE, separately-approved phase has a starting point once call sites
are actually switched to engine.models.resolve_jurisdiction_state().

Manual run only (never on app startup), and only after separate approval:
    cd /app/backend && python -m engine.jurisdiction_migration --execute

With no flags (or bare --dry-run) it only REPORTS counts/conflicts and
writes nothing.
"""
from __future__ import annotations

import argparse
import asyncio
import os

from engine.models import resolve_jurisdiction_state


async def backfill_sessions(db, dry_run: bool = True) -> dict:
    """For every session doc, compare legal_query.jurisdiction.state against
    the owning user's profile `state`, and record the resolved value plus a
    conflict flag under a NEW, additive field `jurisdiction_resolution`.

    Never deletes or overwrites either original source field. No-op unless
    dry_run is explicitly set to False by a human operator running this
    script directly (never automatically).
    """
    stats = {"scanned": 0, "conflicts": 0, "updated": 0}
    cursor = db.sessions.find({})
    async for sess in cursor:
        stats["scanned"] += 1
        case_state = sess.get("case_state") or {}
        jur_state = (
            ((case_state.get("legal_query") or {}).get("jurisdiction") or {}).get("state")
        )
        user_id = sess.get("user_id")
        user_doc = await db.users.find_one({"id": user_id}) if user_id else None
        user_state = (user_doc or {}).get("state")
        result = resolve_jurisdiction_state(jur_state, user_state)
        if result["conflict"]:
            stats["conflicts"] += 1
        if not dry_run:
            await db.sessions.update_one(
                {"_id": sess["_id"]},
                {"$set": {"jurisdiction_resolution": result}},
            )
            stats["updated"] += 1
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="F2 jurisdiction backfill (manual run only, not wired into the app)")
    parser.add_argument("--execute", action="store_true", help="Actually write the jurisdiction_resolution field")
    args = parser.parse_args()
    print(
        "This script is NOT invoked by the app and was NOT run as part of "
        "Phase 1 delivery. Re-run with --execute only after separate, "
        "explicit approval to write jurisdiction_resolution to session docs."
    )
