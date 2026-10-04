"""
Account deletion — hard-delete a user and every collection that carries a
user_id, in one place so both the in-app path (POST /api/account/delete)
and the public web OTP path (POST /api/account-deletion/verify) call the
exact same logic and can never drift apart.

Scope verified by a full `list_collection_names()` scan of the database
(June 2026): collections WITHOUT a user_id field — refusal_events (aggregate
refusal analytics, deliberately not user-linked, by design a privacy
feature — logs what got refused without recording who asked) and
push_job_runs (job/day bookkeeping only) — are NOT touched here; there is
nothing to delete from them per-user.

fir_sessions is intentionally NOT in the simple hard-delete list below.
Per the published retention policy (/api/user/my-data →
"fir_drafts: until account deletion + 30 days"), FIR drafts get a 30-day
grace period instead of being wiped the instant the account is deleted —
see hard_delete_user()'s fir_sessions tombstone step and
server.py::run_retention_purge_loop() for the matching 30-day sweep.

usage_daily carries BOTH per-user rows (scope:"user") and app-wide aggregate
rows (scope:"app"); only the former belong to an individual account and are
deleted — the aggregate rows belong to no one and must survive.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger("account_deletion")

# Collections matched by a plain {"user_id": <id>} filter.
_SIMPLE_USER_ID_COLLECTIONS = [
    "sessions",
    "messages",
    "bookmarks",
    "draft_events",
    "password_resets",
    "terms_acknowledgements",
    "client_error_logs",
    "billing_intents",
    "missing_media",
]


async def hard_delete_user(db, user_id: str) -> dict:
    """Deletes the user's own account record plus every row across every
    other user-linked collection. Returns a {collection: deleted_count} map
    for verification/audit logging by the caller — never sent to the client.
    """
    counts: dict[str, int] = {}

    for name in _SIMPLE_USER_ID_COLLECTIONS:
        result = await db[name].delete_many({"user_id": user_id})
        counts[name] = result.deleted_count

    # usage_daily — only the per-user rows, never the app-wide aggregate rows.
    usage_result = await db.usage_daily.delete_many({"user_id": user_id, "scope": "user"})
    counts["usage_daily"] = usage_result.deleted_count

    # fir_sessions — NOT deleted here. Per the published retention policy
    # (/api/user/my-data → "fir_drafts: until account deletion + 30 days"),
    # FIR drafts get a 30-day grace period after account deletion, not an
    # immediate wipe. Stamp them with account_deleted_at so the retention
    # purge job (server.py: run_retention_purge_loop) can find and remove
    # them exactly 30 days from now — see that job for the matching read side.
    now_iso = datetime.now(timezone.utc).isoformat()
    fir_result = await db.fir_sessions.update_many(
        {"user_id": user_id}, {"$set": {"account_deleted_at": now_iso}}
    )
    counts["fir_sessions_tombstoned"] = fir_result.modified_count

    # users — the account record itself, matched by its own "id" field
    # (this codebase's primary key everywhere, not Mongo's _id).
    user_result = await db.users.delete_one({"id": user_id})
    counts["users"] = user_result.deleted_count

    logger.info(f"[account_deletion] hard-deleted user {user_id}: {counts}")
    return counts
