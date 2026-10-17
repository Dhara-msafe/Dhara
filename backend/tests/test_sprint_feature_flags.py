"""
Sprint feature flag regression tests — S1/S2/S4/S5/AQF Phase 1b
Tests: backend health, auth, and chat endpoint (AQF regression)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json().get("token") or resp.json().get("access_token")


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── Health check ────────────────────────────────────────────────────────────

def test_health_returns_200():
    """GET /api/health — verifies chat_router imports (AQF Phase 1b) didn't break backend"""
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"
    print("PASS: /api/health returns 200")


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_login_success():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data or "access_token" in data
    print("PASS: login returns 200 with token")


# ── Women's Shield API endpoints ─────────────────────────────────────────────

def test_trusted_circle_get(auth_headers):
    """GET /api/women/circle — Trusted Circle contacts retrieval"""
    r = requests.get(f"{BASE_URL}/api/women/circle", headers=auth_headers)
    assert r.status_code in (200, 404), f"Unexpected: {r.status_code} {r.text}"
    print(f"PASS: /api/women/circle returns {r.status_code}")


def test_women_flags(auth_headers):
    """GET /api/women/flags — feature flags"""
    r = requests.get(f"{BASE_URL}/api/women/flags", headers=auth_headers)
    assert r.status_code in (200, 404), f"Unexpected: {r.status_code}"
    print(f"PASS: /api/women/flags returns {r.status_code}")


# ── AQF Phase 1b regression: chat sessions list ──────────────────────────────

def test_chat_sessions_list(auth_headers):
    """GET /api/chat/sessions — verifies chat_router loaded correctly (AQF Phase 1b)"""
    r = requests.get(f"{BASE_URL}/api/chat/sessions", headers=auth_headers)
    assert r.status_code == 200, f"Chat sessions failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, list)
    print(f"PASS: /api/chat/sessions returns 200, {len(data)} sessions")
