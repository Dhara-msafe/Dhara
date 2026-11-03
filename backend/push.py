"""
Emergent-managed push notifications (SuprSend relay). This is the ONLY push
provider used anywhere in this codebase — no OneSignal/FCM-direct/SNS/Expo
Push API. See the Emergent push playbook for the full contract; this module
implements exactly its "Backend Integration" section.

EMERGENT_PUSH_KEY is a placeholder until the deployer sets the real value at
build time — never edit it by hand, never log it, never send it to the client.
"""
import os
import logging
import httpx

from services.outbound_guard import outbound_live, record_simulated

logger = logging.getLogger("push")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)


async def register_device(user_id: str, platform: str, device_token: str) -> dict:
    """Upsert a device token with the relay. Called by POST /api/register-push."""
    if not outbound_live():
        await record_simulated("push_register", user_id, {"platform": platform})
        return {"status": "simulated"}
    resp = await _client.post(
        "/api/v1/push/users/register",
        json={"user_id": user_id, "platform": platform, "device_token": device_token},
    )
    if resp.status_code == 401:
        raise RuntimeError("EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise RuntimeError("Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def unregister_device(user_id: str) -> None:
    """Tells the relay to forget this user_id's device-token mapping —
    called on account deletion so no orphaned token/user_id record is left
    behind on the relay side once the account no longer exists in our own
    DB. Same contract as register_device/send_push: callers MUST wrap this
    in try/except — a relay hiccup must never block the deletion itself.
    """
    if not outbound_live():
        await record_simulated("push_unregister", user_id, {})
        return
    resp = await _client.post(
        "/api/v1/push/users/unregister",
        json={"user_id": user_id},
    )
    if resp.status_code == 401:
        raise RuntimeError("EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise RuntimeError("Push provider unavailable")
    resp.raise_for_status()


async def send_push(recipients: list[str], data: dict, idempotency_key: str | None = None) -> None:
    """Trigger a push to up to 100 user_ids (chunks larger audiences — the
    relay's own cap). Tokens are resolved server-side by SuprSend from
    `recipients`; this app never stores device tokens itself.

    Callers MUST wrap this in try/except (see playbook) — a push failure must
    never block whatever real action triggered it (saving a message, running
    a nightly job, etc).
    """
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    if not outbound_live():
        await record_simulated("push", ",".join(recipients), {"data": data, "idempotency_key": idempotency_key})
        return
    for i in range(0, len(recipients), 100):
        chunk = recipients[i : i + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = f"{idempotency_key}:{i // 100}"
        resp = await _client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code == 401:
            raise RuntimeError("EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise RuntimeError("Push provider unavailable")
        resp.raise_for_status()
