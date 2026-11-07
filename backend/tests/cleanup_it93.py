# Iteration 93 cleanup — revoke only the journeys / circle link created by this run (by id)
import requests

BASE = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("EXPO_PUBLIC_BACKEND_URL=")][0].rstrip("/")
H = {"User-Agent": "Mozilla/5.0 it93-cleanup", "Content-Type": "application/json"}
own = requests.post(f"{BASE}/api/auth/login", json={"email": "voicetest2026@example.com", "password": "TestPass123!"}, headers=H).json()["token"]
A = {**H, "Authorization": f"Bearer {own}"}
for t in ["ESJ781L6x9", "AsIJOvlSqQ", "iErUqyGVr1", "bkkJKUKRNr", "8KkeJOPqu2"]:
    r = requests.post(f"{BASE}/api/journey/status/{t}/revoke", headers=A)
    print("revoke journey", t, r.status_code)
for lid in ["245057aa-3cad-454f-8fe7-d4efc17d7df3"]:
    r = requests.post(f"{BASE}/api/trusted-circle/invitations/{lid}/revoke", headers=A)
    print("revoke link", lid, r.status_code, r.text[:120])
