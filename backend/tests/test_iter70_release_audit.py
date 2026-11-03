# Iteration 70: release-audit quick checks (outbound mode in health, voice upload validation, RTI chat citations)
import os
import struct
import zlib
import pytest
import requests


def _env_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip().strip('"')
    return url.rstrip("/")


BASE_URL = _env_url()
CREDS = [("testpass_alpha@msafe.in", "TestPass456!"), ("voicetest2026@example.com", "TestPass123!")]


def _png_bytes():
    raw = b"\x00" + b"\xff\x00\x00" * 4
    rows = raw * 4
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")) * 20


@pytest.fixture(scope="module")
def token():
    for email, pw in CREDS:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        if r.status_code == 200:
            data = r.json()
            return data.get("token") or data.get("access_token")
    pytest.skip("login failed for all creds")


# Health exposes outbound_mode=simulate
def test_health_outbound_mode():
    r = requests.get(f"{BASE_URL}/api/health", timeout=20)
    assert r.status_code == 200
    assert r.json().get("outbound_mode") == "simulate"


# Voice: PNG labelled audio/m4a must be 415 (never billed / sent to whisper)
def test_voice_png_as_m4a_415(token):
    r = requests.post(f"{BASE_URL}/api/voice/transcribe", headers={"Authorization": f"Bearer {token}"},
                      files={"audio": ("clip.m4a", _png_bytes(), "audio/m4a")}, timeout=30)
    assert r.status_code == 415, r.text
    assert "format" in r.json().get("detail", "").lower()


# Voice: empty file must be 400 'empty or too short'
def test_voice_empty_400(token):
    r = requests.post(f"{BASE_URL}/api/voice/transcribe", headers={"Authorization": f"Bearer {token}"},
                      files={"audio": ("clip.m4a", b"", "audio/m4a")}, timeout=30)
    assert r.status_code == 400, r.text
    assert "empty or too short" in r.json().get("detail", "").lower()


# Voice: unauthenticated rejected
def test_voice_requires_auth():
    r = requests.post(f"{BASE_URL}/api/voice/transcribe",
                      files={"audio": ("clip.m4a", b"", "audio/m4a")}, timeout=30)
    assert r.status_code in (401, 403)
