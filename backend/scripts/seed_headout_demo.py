"""
seed_headout_demo.py — idempotent demo data for the Head Out end-to-end preview.

SAFETY CONTRACT (see STAGE 0 sign-off):
  • Requires --i-understand-this-is-production on the CLI.
  • Writes DIRECTLY to MongoDB — never imports or calls any send_email,
    send_push, SMS helper, or HTTP endpoint.
  • All phone numbers are obviously fake (+9199000000xx).
  • All emails are @example.com.
  • Every document written gets  is_demo: True  AND  seed_tag: 'headout_demo_19nov'
    so remove_headout_demo.py can delete them precisely.

Accounts created
  aditi.demo@example.com   — primary demo traveller
  priya.demo@example.com   — trusted-circle friend  (accepted)
  mom.demo@example.com     — trusted-circle family  (accepted)
  rohan.demo@example.com   — trusted-circle brother (pending)

Saved places (Aditi only — University of Hyderabad, Gachibowli)
  Hostel    University Hostel   17.4617° N, 78.3542° E  200 m
  Main Gate College Main Gate   17.4652° N, 78.3488° E  200 m
  Library   Central Library     17.4603° N, 78.3516° E  200 m
  Cafeteria Food Court          17.4588° N, 78.3505° E  200 m

Usage (must be explicit about the environment):
  cd /app/backend
  python3 scripts/seed_headout_demo.py --i-understand-this-is-production
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ── path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent   # /app/backend
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

# ── SAFETY: require explicit confirmation flag ────────────────────────────────
if "--i-understand-this-is-production" not in sys.argv:
    print(
        "ERROR: This script writes directly to the database that is currently\n"
        "       configured as production (DEPLOYMENT_ENV=production).\n\n"
        "       If you are sure, re-run with:\n"
        "         python3 scripts/seed_headout_demo.py --i-understand-this-is-production\n"
        "\n"
        "       To delete the seeded data later, run:\n"
        "         python3 scripts/remove_headout_demo.py --i-understand-this-is-production"
    )
    sys.exit(1)

# ── Import ONLY db + bcrypt — never any mailer, push or SMS helper ────────────
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME   = os.environ.get("DB_NAME", "gandhikar_db")

SEED_TAG      = "headout_demo_19nov"
DEMO_PASSWORD = "HeadOut#2026"   # ≥8 chars, uppercase, digit, symbol


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── Seed data ──────────────────────────────────────────────────────────────────
USERS_DEF = [
    {"email": "aditi.demo@example.com",  "name": "Aditi Kumar",  "phone": "+919900000000"},
    {"email": "priya.demo@example.com",  "name": "Priya Sharma", "phone": "+919900000001"},
    {"email": "mom.demo@example.com",    "name": "Mom",          "phone": "+919900000002"},
    {"email": "rohan.demo@example.com",  "name": "Rohan Mehta",  "phone": "+919900000003"},
]

PLACES = [
    {"label": "Hostel",    "address": "University Hostel", "lat": 17.4617, "lng": 78.3542, "radius": 200},
    {"label": "Main Gate", "address": "College Main Gate", "lat": 17.4652, "lng": 78.3488, "radius": 200},
    {"label": "Library",   "address": "Central Library",   "lat": 17.4603, "lng": 78.3516, "radius": 200},
    {"label": "Cafeteria", "address": "Food Court",        "lat": 17.4588, "lng": 78.3505, "radius": 200},
]


async def upsert_user(db, defn: dict) -> dict:
    """Insert if not exists; return the final DB record."""
    email = defn["email"].lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        # Ensure seed tag present on re-run
        await db.users.update_one({"email": email}, {"$set": {"seed_tag": SEED_TAG, "is_demo": True}})
        print(f"  [SKIP]   user already exists: {email}")
        return existing

    uid = str(uuid.uuid4())
    now = _now()
    doc = {
        "id": uid,
        "email": email,
        "name": defn["name"],
        "phone": defn["phone"],
        "password_hash": _hash(DEMO_PASSWORD),
        "language": "en",
        "is_pro": False,
        "pro_since": None,
        "pro_samples_used": 0,
        "is_grandfathered": True,
        "state_jurisdiction": "telangana",
        "terms_accepted": True,
        "terms_version": "1.0",
        "terms_accepted_at": now,
        "created_at": now,
        "token_version": 0,
        # Seed markers
        "is_demo": True,
        "seed_tag": SEED_TAG,
    }
    await db.users.insert_one(doc)
    print(f"  [CREATE] user: {email}  id={uid}")
    return doc


async def upsert_saved_place(db, owner_id: str, place: dict) -> None:
    existing = await db.safety_saved_places.find_one(
        {"owner_id": owner_id, "label": place["label"], "deleted_at": None}
    )
    if existing:
        await db.safety_saved_places.update_one(
            {"_id": existing["_id"]},
            {"$set": {"seed_tag": SEED_TAG, "is_demo": True}},
        )
        print(f"  [SKIP]   saved place already exists: {place['label']}")
        return

    place_id = str(uuid.uuid4())
    now = _now()
    doc = {
        "place_id":        place_id,
        "owner_id":        owner_id,
        "label":           place["label"],
        "latitude":        place["lat"],
        "longitude":       place["lng"],
        "radius_meters":   place["radius"],
        "created_at":      now,
        "updated_at":      now,
        "deleted_at":      None,
        "google_place_id": None,
        "coords_source":   "manual",
        "coords_cached_at": None,
        "is_demo": True,
        "seed_tag": SEED_TAG,
    }
    await db.safety_saved_places.insert_one(doc)
    print(f"  [CREATE] saved place: {place['label']} ({place['lat']}, {place['lng']})")


async def upsert_tc_link(
    db, owner_id: str, owner_name: str,
    contact_name: str, contact_phone: str,
    invitee_id: str | None,
    relationship: str, status: str,
) -> None:
    existing = await db.trusted_circle_links.find_one(
        {"owner_id": owner_id, "contact_phone": contact_phone}
    )
    if existing:
        await db.trusted_circle_links.update_one(
            {"_id": existing["_id"]},
            {"$set": {"seed_tag": SEED_TAG, "is_demo": True}},
        )
        print(f"  [SKIP]   trusted-circle link already exists: {contact_name}")
        return

    now = _now()
    doc = {
        "id":             str(uuid.uuid4()),
        "owner_id":       owner_id,
        "owner_name":     owner_name,
        "contact_name":   contact_name,
        "contact_phone":  contact_phone,
        "invitee_user_id": invitee_id,
        "permissions": {
            "journey_status":    True,
            "expected_arrival":  True,
            "missed_checkin":    True,
            "temp_location":     False,
            "emergency_requests": True,
        },
        "relationship": relationship,
        "status":        status,
        "muted":         False,
        "created_at":    now,
        "responded_at":  now if status == "accepted" else None,
        "is_demo": True,
        "seed_tag": SEED_TAG,
    }
    await db.trusted_circle_links.insert_one(doc)
    print(f"  [CREATE] trusted-circle link: {owner_name} → {contact_name} ({status})")


async def main() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"\n  DB : {DB_NAME}  ({MONGO_URL[:40]}…)")
    print(f"  SEED_TAG : {SEED_TAG}  |  all docs get is_demo=True\n")

    # ── 1. Users ───────────────────────────────────────────────────────────────
    print("── Users ─────────────────────────────────────────────────────────────")
    users: dict[str, dict] = {}
    for defn in USERS_DEF:
        users[defn["email"]] = await upsert_user(db, defn)

    aditi_id = users["aditi.demo@example.com"]["id"]
    priya_id = users["priya.demo@example.com"]["id"]
    mom_id   = users["mom.demo@example.com"]["id"]
    rohan_id = users["rohan.demo@example.com"]["id"]

    # ── 2. Saved places (Aditi only) ───────────────────────────────────────────
    print("\n── Saved places (Aditi) ──────────────────────────────────────────────")
    for place in PLACES:
        await upsert_saved_place(db, aditi_id, place)

    # ── 3. Trusted Circle links (Aditi as owner) ───────────────────────────────
    print("\n── Trusted Circle links ──────────────────────────────────────────────")
    aditi_name = users["aditi.demo@example.com"]["name"]
    for contact_name, phone, invitee_id, rel, status in [
        ("Priya Sharma", "+919900000001", priya_id, "Friend",  "accepted"),
        ("Mom",          "+919900000002", mom_id,   "Family",  "accepted"),
        ("Rohan Mehta",  "+919900000003", rohan_id, "Brother", "pending"),
    ]:
        await upsert_tc_link(
            db, owner_id=aditi_id, owner_name=aditi_name,
            contact_name=contact_name, contact_phone=phone,
            invitee_id=invitee_id, relationship=rel, status=status,
        )

    client.close()

    # ── 4. Write README_demo.md ────────────────────────────────────────────────
    readme_path = Path(__file__).parent / "README_demo.md"
    readme_path.write_text(
        f"""# Head Out Demo Credentials

Generated by `scripts/seed_headout_demo.py`.
**seed_tag: `{SEED_TAG}` — delete with `scripts/remove_headout_demo.py --i-understand-this-is-production`**

## Demo login (Aditi — primary traveller)
| Field    | Value                      |
|----------|----------------------------|
| Email    | aditi.demo@example.com     |
| Password | {DEMO_PASSWORD}            |
| Name     | Aditi Kumar                |
| Phone    | +919900000000 (fake)       |

## Supporting accounts (same password: `{DEMO_PASSWORD}`)
| Email                   | Name         | Role in Aditi's circle  |
|-------------------------|--------------|-------------------------|
| priya.demo@example.com  | Priya Sharma | Friend  — **accepted**  |
| mom.demo@example.com    | Mom          | Family  — **accepted**  |
| rohan.demo@example.com  | Rohan Mehta  | Brother — **pending**   |

## Saved places (Aditi — University of Hyderabad, Gachibowli)
| Label     | Address           | Lat (N)   | Lng (E)   | Radius |
|-----------|-------------------|-----------|-----------|--------|
| Hostel    | University Hostel | 17.4617°  | 78.3542°  | 200 m  |
| Main Gate | College Main Gate | 17.4652°  | 78.3488°  | 200 m  |
| Library   | Central Library   | 17.4603°  | 78.3516°  | 200 m  |
| Cafeteria | Food Court        | 17.4588°  | 78.3505°  | 200 m  |

## Demo flow (requires EXPO_PUBLIC_HEADOUT_DEMO=true in frontend env)
1. Log in as Aditi.
2. Head Out → Choose Destination → pick **Hostel** from Saved.
3. Arrival Radius — leave at 200 m → Next.
4. Trusted Circle & Rules — Priya + Mom will be selectable (Accepted) → Start.
5. Active-journey screen shows the **Demo mode** banner with four buttons:
   - **Start route** — simulates GPS moving from Main Gate toward Hostel.
   - **Enter arrival zone** — triggers "Inside arrival zone" screen.
   - **Go off route** — triggers "Route changed" screen.
   - **Miss check-in** — forces "Check-in not received" screen.
""",
        encoding="utf-8",
    )
    print(f"\n── README written → {readme_path}")

    print(f"""
╔══════════════════════════════════════════════════════════╗
║  Demo login : aditi.demo@example.com / {DEMO_PASSWORD}  ║
║  seed_tag   : {SEED_TAG}                 ║
╚══════════════════════════════════════════════════════════╝
Seed complete. Nothing was sent via SMS, email or push.
""")


if __name__ == "__main__":
    asyncio.run(main())
