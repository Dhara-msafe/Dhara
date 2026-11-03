import os
import requests, json, unicodedata, re, sys

BASE = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")

r = requests.post(f"{BASE}/api/auth/login", json={"email":"protest@gandhikar.in","password":"test1234"})
TOKEN = r.json()["token"]

LANGS = requests.get(f"{BASE}/api/reference/languages").json()
INDIAN = [l for l in LANGS if l["code"] != "en"]

# Expected Unicode script ranges per language (compact regexes)
SCRIPT = {
    "hi":  r"[\u0900-\u097F]",   # Devanagari
    "bn":  r"[\u0980-\u09FF]",   # Bengali
    "ta":  r"[\u0B80-\u0BFF]",   # Tamil
    "te":  r"[\u0C00-\u0C7F]",   # Telugu
    "mr":  r"[\u0900-\u097F]",   # Devanagari
    "gu":  r"[\u0A80-\u0AFF]",   # Gujarati
    "kn":  r"[\u0C80-\u0CFF]",   # Kannada
    "ml":  r"[\u0D00-\u0D7F]",   # Malayalam
    "pa":  r"[\u0A00-\u0A7F]",   # Gurmukhi
    "or":  r"[\u0B00-\u0B7F]",   # Odia
    "as":  r"[\u0980-\u09FF]",   # Bengali-Assamese
    "ur":  r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]",  # Arabic (Urdu)
    "sd":  r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]",  # Arabic (Sindhi Perso-Arabic) OR Devanagari — accept both
    "ks":  r"[\u0900-\u097F\u0600-\u06FF]",  # Devanagari OR Perso-Arabic
    "ne":  r"[\u0900-\u097F]",   # Devanagari
    "sa":  r"[\u0900-\u097F]",   # Devanagari
    "kok": r"[\u0900-\u097F]",   # Devanagari
    "mai": r"[\u0900-\u097F]",   # Devanagari (or Mithilakshar)
    "mni": r"[\u0980-\u09FF\uABC0-\uABFF]",  # Bengali OR Meetei Mayek
    "sat": r"[\u1C50-\u1C7F\u0900-\u097F]",  # Ol Chiki OR Devanagari
    "doi": r"[\u0900-\u097F]",   # Devanagari
    "brx": r"[\u0900-\u097F]",   # Devanagari
}

def ask(lang):
    r = requests.post(
        f"{BASE}/api/chat/stream",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={
            "message": "How do I file an FIR?",
            "language": lang["code"],
            "language_name": lang["name"],
            "language_native": lang["native"],
            "model_provider": "anthropic",
            "model_name": "claude-sonnet-4-5-20250929",
        },
        stream=True, timeout=45,
    )
    text = ""
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "): continue
        try:
            d = json.loads(line[6:])
            if d.get("type") == "delta":
                text += d.get("content", "")
        except Exception: pass
    return text

print(f"{'Code':6} {'Name':12} {'Script chars':>13} {'English leak':>12} {'Verdict':>10}")
print("-" * 60)
fails = []
for L in INDIAN:
    try:
        reply = ask(L)
    except Exception as e:
        print(f"{L['code']:6} {L['name']:12} ERROR: {e}")
        fails.append(L["code"])
        continue
    pat = SCRIPT.get(L["code"], "")
    script_count = len(re.findall(pat, reply)) if pat else 0
    # Check if English literal headings still appear
    english_leak = "Answer:" in reply or "What you can do:" in reply
    total_chars = len(reply)
    # Verdict: >=30 script chars AND no English literals
    ok = script_count >= 30 and not english_leak
    print(f"{L['code']:6} {L['name']:12} {script_count:>13} {'YES' if english_leak else 'no':>12} {'OK' if ok else 'FAIL':>10}")
    if not ok:
        fails.append((L["code"], L["name"], reply[:200]))

print()
print(f"PASSED: {len(INDIAN)-len(fails)}/{len(INDIAN)}")
if fails:
    print("\nFAILURES:")
    for f in fails:
        if isinstance(f, tuple):
            print(f"  {f[0]} ({f[1]}): {f[2][:250]}")
        else:
            print(f"  {f}: exception")
