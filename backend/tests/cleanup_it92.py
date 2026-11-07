# Iteration 92 cleanup — revoke only the journeys / circle link created by this run (by id)
import requests

BASE = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("EXPO_PUBLIC_BACKEND_URL=")][0].rstrip("/")
H = {"User-Agent": "Mozilla/5.0 it92-cleanup", "Content-Type": "application/json"}
own = requests.post(f"{BASE}/api/auth/login", json={"email": "voicetest2026@example.com", "password": "TestPass123!"}, headers=H).json()["token"]
A = {**H, "Authorization": f"Bearer {own}"}
for t in ["5UJMYuiLGc", "rGpTsI805q", "sH3uxrRMGQ", "VhQWp9V9QZ"]:
    r = requests.post(f"{BASE}/api/journey/status/{t}/revoke", headers=A)
    print("revoke journey", t, r.status_code)
for lid in ["947494d8-310d-40e9-a677-9e88553bcf41"]:
    r = requests.post(f"{BASE}/api/trusted-circle/invitations/{lid}/revoke", headers=A)
    print("revoke link", lid, r.status_code, r.text[:120])
