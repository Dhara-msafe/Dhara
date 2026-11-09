"""Seed/cleanup helper for iteration-97 admin UI test. Usage: seed | cleanup <report_id> <event_id>"""
import sys
from datetime import datetime, timezone

import requests
from bson import ObjectId
from dotenv import dotenv_values
from pymongo import MongoClient

FE = dotenv_values("/app/frontend/.env"); BE = dotenv_values("/app/backend/.env")
API = FE["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
db = MongoClient(BE["MONGO_URL"])[BE["DB_NAME"]]

if sys.argv[1] == "seed":
    tok = requests.post(f"{API}/auth/login", json={"email": "voicetest2026@example.com", "password": "TestPass123!"}).json()["token"]
    r = requests.post(f"{API}/issues", headers={"Authorization": f"Bearer {tok}"}, json={
        "category": "Accessibility", "title": "TEST_it97 UI row",
        "description": "TEST_it97 line one. " + "This is a long description used to verify the expand behaviour. " * 6 + "ENDMARKER",
        "platform": "web", "os_version": "test", "app_version": "1.0.0", "current_screen": "/admin-issues"})
    print("REPORT", r.status_code, r.json().get("id"))
    ev = db.error_events.insert_one({"route": "/api/__TEST_it97_ui__", "method": "POST", "error_type": "TEST_KeyError",
                                     "traceback": "Traceback (most recent call last):\n  TEST frame\nKeyError: 'x'",
                                     "status_code": 500, "created_at": datetime.now(timezone.utc)})
    print("EVENT", ev.inserted_id)
else:
    print(db.issue_reports.delete_one({"id": sys.argv[2]}).deleted_count,
          db.error_events.delete_one({"_id": ObjectId(sys.argv[3])}).deleted_count)
