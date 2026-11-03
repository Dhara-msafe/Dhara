"""Outbound Guard — the single place that decides whether any real external
dispatch (dialler, SMS, password-reset email, push, scheduled reminder, ops
alert, guardian/trusted-circle message, external share) actually leaves the
server, per the active release PROFILE.

Two layered controls:

OUTBOUND_MODE  (global master switch — unchanged, fail-closed)
  "live"      → the master switch is ON; individual channels may still be
                restricted by the active profile below.
  "simulate"  → nothing leaves the server; every attempt is recorded in the
                `qa_outbox` collection of the current database.
  Anything else is treated as "simulate" at call time, and
  validate_outbound_config() refuses to let the server start.

OUTBOUND_PROFILE  (per-channel policy — NEW)
  "internal_qa"    → everything simulated; push/reminders/guardian disabled.
  "closed_testing" → dialler/SMS/reset-email/ops/external-share may go live
                     (user-initiated); push, reminders and guardian disabled.
  "production"      → all channels live.
  When unset it is DERIVED for backward-compatibility: live→production,
  simulate→internal_qa.

Golden rule: the profile can only ever RESTRICT a send, never enable one that
OUTBOUND_MODE has not already allowed. A channel sends for real only when
should_send(channel) is True, i.e. OUTBOUND_MODE=="live" AND the active
profile marks that channel "live".
"""
import os
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger("dhara.outbound_guard")

VALID_MODES = ("live", "simulate")
VALID_PROFILES = ("internal_qa", "closed_testing", "production")

# ── Channels ─────────────────────────────────────────────────────────────────
DIALLER = "dialler"
SMS = "sms"
RESET_EMAIL = "reset_email"
EMAIL = "email"              # generic transactional email (alias of reset path)
PUSH = "push"
REMINDER = "reminder"
EXTERNAL_SHARE = "external_share"
GUARDIAN = "guardian"
OPS_ALERT = "ops_alert"

CHANNELS = (
    DIALLER, SMS, RESET_EMAIL, EMAIL, PUSH, REMINDER,
    EXTERNAL_SHARE, GUARDIAN, OPS_ALERT,
)

# Decision values
LIVE = "live"
SIMULATE = "simulate"
DISABLED = "disabled"

# ── Policy matrix: (profile, channel) → decision ─────────────────────────────
_POLICY = {
    "internal_qa": {
        DIALLER: SIMULATE, SMS: SIMULATE, RESET_EMAIL: SIMULATE, EMAIL: SIMULATE,
        EXTERNAL_SHARE: SIMULATE, OPS_ALERT: SIMULATE,
        PUSH: DISABLED, REMINDER: DISABLED, GUARDIAN: DISABLED,
    },
    "closed_testing": {
        DIALLER: LIVE, SMS: LIVE, RESET_EMAIL: LIVE, EMAIL: LIVE,
        EXTERNAL_SHARE: LIVE, OPS_ALERT: LIVE,
        PUSH: DISABLED, REMINDER: DISABLED, GUARDIAN: DISABLED,
    },
    "production": {
        DIALLER: LIVE, SMS: LIVE, RESET_EMAIL: LIVE, EMAIL: LIVE,
        EXTERNAL_SHARE: LIVE, OPS_ALERT: LIVE,
        PUSH: LIVE, REMINDER: LIVE, GUARDIAN: LIVE,
    },
}


def outbound_mode() -> str:
    return "live" if os.environ.get("OUTBOUND_MODE") == "live" else "simulate"


def outbound_live() -> bool:
    return outbound_mode() == "live"


def outbound_profile() -> str:
    """Active release profile. Explicit OUTBOUND_PROFILE wins; otherwise derived
    from the master switch for backward-compatibility."""
    raw = os.environ.get("OUTBOUND_PROFILE")
    if raw in VALID_PROFILES:
        return raw
    return "production" if outbound_live() else "internal_qa"


def channel_decision(channel: str) -> str:
    """Return the configured decision ('live'|'simulate'|'disabled') for a
    channel under the active profile — ignoring the master switch."""
    return _POLICY.get(outbound_profile(), _POLICY["internal_qa"]).get(channel, SIMULATE)


def should_send(channel: str) -> bool:
    """True only when a real dispatch on this channel is permitted: the master
    switch is live AND the active profile marks the channel live. The profile
    can only restrict, never enable."""
    return outbound_live() and channel_decision(channel) == LIVE


def channel_effective(channel: str) -> str:
    """What will actually happen for this channel right now: 'live' only if
    should_send is True; otherwise 'disabled' when the profile disables it, else
    'simulate'."""
    if should_send(channel):
        return LIVE
    return DISABLED if channel_decision(channel) == DISABLED else SIMULATE


def policy_snapshot() -> dict:
    """Health/debug snapshot — per-channel effective behaviour. No secrets."""
    return {
        "mode": outbound_mode(),
        "profile": outbound_profile(),
        "channels": {c: channel_effective(c) for c in CHANNELS},
    }


def validate_outbound_config() -> str:
    raw = os.environ.get("OUTBOUND_MODE")
    if raw not in VALID_MODES:
        raise RuntimeError(
            "OUTBOUND_MODE must be set explicitly to 'live' or 'simulate' "
            f"(got {raw!r}). Refusing to start."
        )
    prof_raw = os.environ.get("OUTBOUND_PROFILE")
    if prof_raw is not None and prof_raw not in VALID_PROFILES:
        raise RuntimeError(
            "OUTBOUND_PROFILE, when set, must be one of "
            f"{VALID_PROFILES} (got {prof_raw!r}). Refusing to start."
        )
    # Explicit production requires a coherent, complete configuration.
    if prof_raw == "production":
        if raw != "live":
            raise RuntimeError(
                "OUTBOUND_PROFILE=production requires OUTBOUND_MODE=live "
                f"(got {raw!r}) — contradictory config. Refusing to start."
            )
        if not (os.environ.get("EMERGENT_EMAIL_KEY") or "").strip():
            raise RuntimeError(
                "OUTBOUND_PROFILE=production requires EMERGENT_EMAIL_KEY to be "
                "configured. Refusing to start."
            )
    if prof_raw == "closed_testing" and raw != "live":
        logger.warning(
            "[outbound_guard] profile=closed_testing but OUTBOUND_MODE=%s — "
            "enabled channels will still SIMULATE until the master switch is live.",
            raw,
        )
    logger.warning(
        "[outbound_guard] OUTBOUND_MODE=%s profile=%s", raw, outbound_profile()
    )
    return raw


async def record_simulated(kind: str, target: str, payload: dict) -> str:
    """Store a simulated / disabled dispatch in the current DB. Never raises."""
    sim_id = f"simulated-{uuid.uuid4()}"
    try:
        from dependencies import db
        await db.qa_outbox.insert_one({
            "id": sim_id,
            "kind": kind,
            "target": target,
            "payload": payload,
            "profile": outbound_profile(),
            "decision": channel_effective(kind) if kind in _POLICY["production"] else SIMULATE,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:  # recording must never turn into a real send
        logger.warning("[outbound_guard] could not record simulated %s: %s", kind, e)
    logger.info("[outbound_guard] SIMULATED %s → %s (nothing sent)", kind, target)
    return sim_id
