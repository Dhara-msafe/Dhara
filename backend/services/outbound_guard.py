"""QA Outbound Guard — single fail-closed switch for every real external
dispatch the backend can make (push relay, email, ops Slack/email).

OUTBOUND_MODE:
  "live"      → providers are called exactly as before (production).
  "simulate"  → nothing leaves the server; each attempt is recorded in the
                `qa_outbox` collection of the CURRENT database (the isolated
                QA database when DB_NAME points at it).
Anything else (missing, empty, misspelt, different case) is treated as
"simulate" at call time, and `validate_outbound_config()` refuses to let the
server start, so production cannot boot without an explicit approved value.
"""
import os
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger("dhara.outbound_guard")

VALID_MODES = ("live", "simulate")


def outbound_mode() -> str:
    return "live" if os.environ.get("OUTBOUND_MODE") == "live" else "simulate"


def outbound_live() -> bool:
    return outbound_mode() == "live"


def validate_outbound_config() -> str:
    raw = os.environ.get("OUTBOUND_MODE")
    if raw not in VALID_MODES:
        raise RuntimeError(
            "OUTBOUND_MODE must be set explicitly to 'live' or 'simulate' "
            f"(got {raw!r}). Refusing to start."
        )
    logger.warning("[outbound_guard] OUTBOUND_MODE=%s", raw)
    return raw


async def record_simulated(kind: str, target: str, payload: dict) -> str:
    """Store a simulated dispatch in the current DB. Never raises."""
    sim_id = f"simulated-{uuid.uuid4()}"
    try:
        from dependencies import db
        await db.qa_outbox.insert_one({
            "id": sim_id,
            "kind": kind,
            "target": target,
            "payload": payload,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:  # recording must never turn into a real send
        logger.warning("[outbound_guard] could not record simulated %s: %s", kind, e)
    logger.info("[outbound_guard] SIMULATED %s → %s (nothing sent)", kind, target)
    return sim_id
