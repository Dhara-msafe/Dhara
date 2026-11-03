"""Voice upload validation for BOTH upload points (/api/voice/transcribe and
/api/advocate/intake/{token}/transcribe): size cap, empty-file rejection,
declared-type allow-list, magic-byte signature check, billing only after
validation. Unit tests — no network, no DB, no Whisper call."""
import asyncio
import io
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api.chat_router as cr  # noqa: E402

PAD = b"\x00" * 2048
SAMPLES = {
    "mp4": (b"\x00\x00\x00\x20ftypM4A " + PAD, "audio/m4a"),
    "webm": (b"\x1a\x45\xdf\xa3" + PAD, "audio/webm;codecs=opus"),
    "ogg": (b"OggS" + PAD, "audio/ogg"),
    "mp3": (b"ID3\x04" + PAD, "audio/mpeg"),
    "wav": (b"RIFF\x00\x00\x00\x00WAVE" + PAD, "audio/wav"),
    "flac": (b"fLaC" + PAD, "audio/flac"),
}


def _upload(data: bytes, ctype: str, name: str = "audio.m4a") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": ctype}))


def _run(data, ctype, name="audio.m4a"):
    return asyncio.run(cr.read_validated_audio(_upload(data, ctype, name)))


@pytest.mark.parametrize("family", list(SAMPLES))
def test_valid_formats_accepted_and_normalised(family):
    data, ctype = SAMPLES[family]
    out, filename, norm_type = _run(data, ctype, name="whatever.bin")
    assert out == data
    assert filename == cr._FAMILY_FILE[family][0] and norm_type == cr._FAMILY_FILE[family][1]


@pytest.mark.parametrize("size,code", [(0, 400), (999, 400), (cr.MAX_AUDIO_BYTES + 1, 413)])
def test_size_limits(size, code):
    data = (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * size)[:size] if size else b""
    with pytest.raises(HTTPException) as e:
        _run(data, "audio/m4a")
    assert e.value.status_code == code


def test_exactly_max_size_accepted():
    data = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * (cr.MAX_AUDIO_BYTES - 12)
    assert len(data) == cr.MAX_AUDIO_BYTES
    assert _run(data, "audio/m4a")[1] == "audio.m4a"


@pytest.mark.parametrize("data,ctype", [
    (b"\x89PNG\r\n\x1a\n" + PAD, "audio/m4a"),          # PNG renamed as audio
    (b"MZ\x90\x00" + PAD, "audio/m4a"),                 # Windows EXE labelled audio
    (b"%PDF-1.7" + PAD, "application/octet-stream"),    # generic type, bad signature
    (SAMPLES["mp4"][0], "image/png"),                    # non-audio declared type
    (SAMPLES["webm"][0], "audio/m4a"),                   # declared vs actual mismatch
])
def test_bad_type_or_signature_rejected_415(data, ctype):
    with pytest.raises(HTTPException) as e:
        _run(data, ctype)
    assert e.value.status_code == 415


def test_generic_declared_type_allowed_when_signature_valid():
    assert _run(SAMPLES["mp4"][0], "application/octet-stream")[1] == "audio.m4a"
    assert _run(SAMPLES["mp4"][0], "")[1] == "audio.m4a"


def test_rejected_upload_is_never_billed(monkeypatch):
    billed = []

    async def _meter(user, kind):
        billed.append(kind)

    async def _no_whisper(*a, **k):
        raise AssertionError("Whisper must not be called for a rejected file")

    monkeypatch.setattr(cr, "meter_llm_use", _meter)
    monkeypatch.setattr(cr, "whisper_transcribe", _no_whisper)
    with pytest.raises(HTTPException) as e:
        asyncio.run(cr.transcribe(audio=_upload(b"\x89PNG" + PAD, "audio/m4a"), language=None, user={"id": "u"}))
    assert e.value.status_code == 415 and billed == []


def test_both_endpoints_validate_before_metering():
    root = Path(__file__).resolve().parent.parent
    chat = (root / "api" / "chat_router.py").read_text(encoding="utf-8")
    srv = (root / "server.py").read_text(encoding="utf-8")
    for src, fn in ((chat, "async def transcribe("), (srv, "async def intake_transcribe(")):
        body = src[src.index(fn):src.index(fn) + 2500]
        assert body.index("read_validated_audio(audio)") < body.index("meter_llm_use(")
