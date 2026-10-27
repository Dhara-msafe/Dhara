"""
P0 containment test — T07 (DHARA-Team-Delivery-Tracker-2026-10-26.xlsx,
Batch B: confirmed privacy defect — unscoped bulk export).

Defect: GET /api/admin/export/messages.csv joined EVERY user's full legal-
conversation content (up to 2000 chars of `content`) with their email, name
and phone number in one unscoped CSV dump — exactly "an unscoped export
that combines users' legal conversations with personal details".

Fix: the export is RESTRICTED (not removed — legitimate operational
debugging value is preserved): it no longer joins against the users
collection for email/name/phone. Only the opaque internal `user_id` is
kept for correlation. GET /api/admin/export/users.csv (profile list only,
no conversation content) is unaffected and still carries the admin's
legitimate user-directory export.

These tests call the real route handler functions directly — no live
server, no real database, no real export is ever written to disk. The
admin-key check is bypassed via monkeypatch (that mechanism itself is
explicitly out of scope — "do not replace a shared admin password with a
new improvised authentication system").
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
from unittest.mock import AsyncMock, MagicMock

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")

import server  # noqa: E402


class _AsyncCursor:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for item in self._items:
            yield item


async def _collect_csv_text(response) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    return b"".join(chunks).decode("utf-8")


_SENSITIVE_MESSAGE = {
    "timestamp": "2026-10-26T00:00:00Z",
    "user_id": "u-001",
    "session_id": "s-001",
    "role": "user",
    "content": "My husband has been threatening me, I need to know how to file a DV complaint under PWDVA",
    "citations": [],
}

_SENSITIVE_SESSION = {"id": "s-001", "user_id": "u-001"}


@pytest.mark.asyncio
class TestBulkMessageExportNoLongerCombinesPiiWithConversation:
    async def test_no_longer_queries_users_collection_at_all(self, monkeypatch):
        # The defect was fundamentally a JOIN against users for email/name/
        # phone. The fix removes that join entirely — assert the endpoint
        # no longer even calls db.users.find for this export.
        monkeypatch.setattr(server, "_check_admin_key", lambda k: None)
        mock_db = MagicMock()
        mock_db.sessions.find.return_value = _AsyncCursor([_SENSITIVE_SESSION])
        mock_db.messages.find.return_value.sort.return_value = _AsyncCursor([_SENSITIVE_MESSAGE])
        mock_db.users.find = MagicMock(side_effect=AssertionError("users collection must not be queried by this export"))
        monkeypatch.setattr(server, "db", mock_db)

        response = await server.export_messages_csv(x_admin_key="whatever")
        text = await _collect_csv_text(response)
        lines = text.splitlines()
        assert "user_id" in lines[0]
        assert "email" not in lines[0].lower()
        assert "phone" not in lines[0].lower()
        assert "name" not in lines[0].lower()

    async def test_output_contains_no_pii_columns_even_with_sensitive_content_present(self, monkeypatch):
        monkeypatch.setattr(server, "_check_admin_key", lambda k: None)
        mock_db = MagicMock()
        mock_db.sessions.find.return_value = _AsyncCursor([_SENSITIVE_SESSION])
        mock_db.messages.find.return_value.sort.return_value = _AsyncCursor([_SENSITIVE_MESSAGE])
        monkeypatch.setattr(server, "db", mock_db)

        response = await server.export_messages_csv(x_admin_key="whatever")
        text = await _collect_csv_text(response)
        # The content itself may legitimately still be present (operational
        # debugging value) — the defect was combining it WITH identifying
        # personal details, not the content existing at all.
        assert "PWDVA" in text
        assert "u-001" in text  # opaque id preserved for correlation
        # No email/phone-shaped tokens anywhere in the export.
        assert "@" not in text

    async def test_admin_key_check_is_still_enforced(self, monkeypatch):
        # Confirms the (unchanged, out-of-scope) auth mechanism is still
        # actually called — this fix must not accidentally bypass it.
        calls = []
        monkeypatch.setattr(server, "_check_admin_key", lambda k: calls.append(k))
        mock_db = MagicMock()
        mock_db.sessions.find.return_value = _AsyncCursor([])
        mock_db.messages.find.return_value.sort.return_value = _AsyncCursor([])
        monkeypatch.setattr(server, "db", mock_db)

        await server.export_messages_csv(x_admin_key="test-key-value")
        assert calls == ["test-key-value"]


@pytest.mark.asyncio
class TestUserDirectoryExportUnaffected:
    """GET /api/admin/export/users.csv is a legitimate, non-conversation
    user-directory export — must remain unchanged by the T07 fix."""

    async def test_users_csv_still_has_email_column(self, monkeypatch):
        monkeypatch.setattr(server, "_check_admin_key", lambda k: None)
        mock_db = MagicMock()
        mock_db.users.find.return_value.sort.return_value = _AsyncCursor([
            {"id": "u-001", "email": "jane@example.com", "name": "Jane", "phone": "+91-1", "created_at": "2026-01-01"},
        ])
        monkeypatch.setattr(server, "db", mock_db)

        response = await server.export_users_csv(x_admin_key="whatever")
        text = await _collect_csv_text(response)
        assert "email" in text.splitlines()[0]
        assert "jane@example.com" in text
