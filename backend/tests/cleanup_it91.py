# Iteration 91 cleanup — revoke only the journeys / circle links created by this run (by id)
import json
import requests

BASE = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("EXPO_PUBLIC_BACKEND_URL=")][0].rstrip("/")
H = {"User-Agent": "Mozilla/5.0 it91-cleanup", "Content-Type": "application/json"}
own = requests.post(f"{BASE}/api/auth/login", json={"email": "voicetest2026@example.com", "password": "TestPass123!"}, headers=H).json()["token"]
A = {**H, "Authorization": f"Bearer {own}"}
for t in ["CAZiC2ZixG", "bwwYg4OwlE", "n7MfmizQ3S"]:
    r = requests.post(f"{BASE}/api/journey/status/{t}/revoke", headers=A)
    print("revoke journey", t, r.status_code)
inv = requests.get(f"{BASE}/api/trusted-circle/invitations", headers=A).json()
items = inv if isinstance(inv, list) else (inv.get("items") or inv.get("invitations") or inv.get("sent") or [])
print("invitations type:", type(inv).__name__, (list(inv.keys()) if isinstance(inv, dict) else len(inv)))
for it in items:
    if isinstance(it, dict) and it.get("name") == "TEST_Guardian91":
        lid = it.get("id") or it.get("link_id")
        r = requests.post(f"{BASE}/api/trusted-circle/invitations/{lid}/revoke", headers=A)
        print("revoke link", lid, r.status_code)
