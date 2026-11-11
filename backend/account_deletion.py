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

    # B-19 / GAP-06 (11 Nov 2026): user-linked collections the list above missed.
    # Payment records, grievance tickets, advocate data and consent_log are
    # deliberately NOT here — they wait for owner decisions (retention policy).
    for name, flt in (
        ("safety_journeys",       {"user_id": user_id}),
        ("safety_alerts",         {"$or": [{"owner_id": user_id}, {"recipient_user_id": user_id}]}),
        ("trusted_circle_links",  {"owner_id": user_id}),
        ("safety_saved_places",   {"owner_id": user_id}),
        ("scan_history",          {"user_id": user_id}),
        ("data_export_requests",  {"user_id": user_id}),
        ("account_deletion_otps", {"user_id": user_id}),
        ("issue_reports",         {"user_id": user_id}),   # B-58
    ):
        counts[name] = (await db[name].delete_many(flt)).deleted_count
    # Where this user was SOMEONE ELSE's trusted contact: that link belongs to
    # the other person, so keep it but cut the tie to the deleted account.
    unlinked = await db.trusted_circle_links.update_many(
        {"invitee_user_id": user_id},
        {"$set": {"invitee_user_id": None, "status": "revoked",
                  "responded_at": datetime.now(timezone.utc).isoformat()}},
    )
    counts["trusted_circle_links_unlinked"] = unlinked.modified_count

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
    drafts_result = await db.fir_drafts.update_many(
        {"user_id": user_id}, {"$set": {"account_deleted_at": now_iso}}
    )
    counts["fir_drafts_tombstoned"] = drafts_result.modified_count

    # Evidence Vault (E2/A2) — storage objects first, then rows. Ownership is
    # user_id, or scope for legacy pre-migration rows (scope == user id since E1).
    # Cascade contract (S4 safe-to-rerun):
    #   • 404 from storage = file already gone = success (idempotent).
    #   • Any other storage error = keep the DB row so the cascade can be
    #     retried safely; count the failure, log only the error type.
    import shutil
    from fir_storage import delete_raw_object_strict
    from api.evidence_vault_router import TMP_ROOT
    owner = {"$or": [{"user_id": user_id}, {"scope": user_id}]}
    removed, failed = 0, 0
    async for b in db.evidence_backups.find(owner, {"_id": 1, "storage_path": 1}):
        try:
            await delete_raw_object_strict(b["storage_path"])
        except Exception as _storage_err:
            # Non-404 failure (network, 500, 403, …).  Keep the DB row so the
            # next deletion attempt can find and retry it.  Log only the error
            # type — never the path, item id, or any user content.
            logger.warning(
                "[account_deletion] storage delete non-404 error for user %s: %s — row kept for retry",
                user_id, type(_storage_err).__name__,
            )
            failed += 1
            continue  # Skip row deletion; allow retry
        try:
            await db.evidence_backups.delete_one({"_id": b["_id"]})
            removed += 1
        except Exception:
            failed += 1
    counts["evidence_backups"] = removed
    counts["evidence_backup_files_failed"] = failed
    async for s in db.evidence_upload_sessions.find(owner, {"session_id": 1}):
        shutil.rmtree(TMP_ROOT / s["session_id"], ignore_errors=True)
    counts["evidence_upload_sessions"] = (await db.evidence_upload_sessions.delete_many(owner)).deleted_count
    counts["evidence_anchors"] = (await db.evidence_anchors.delete_many(owner)).deleted_count

    # users — the account record itself, matched by its own "id" field
    # (this codebase's primary key everywhere, not Mongo's _id).
    user_result = await db.users.delete_one({"id": user_id})
    counts["users"] = user_result.deleted_count

    logger.info(f"[account_deletion] hard-deleted user {user_id}: {counts}")
    return counts
