"""Generate MSafe Legal Aid App Summary as .docx and .pdf"""
from datetime import date
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether,
)

BRAND = "#0A1C3A"
GOLD = "#C9A227"

# ---------- Content ----------
title = "MSafe Legal Aid — Complete App Summary"
subtitle = "Dhara · AI Legal Assistant for Indian Citizens"
meta = f"Prepared for MSafe Solutions · © Callistus Moses · {date.today().isoformat()}"

overview = (
    "MSafe Legal Aid (product name: Dhara) is a bilingual (22 Indian languages) AI legal assistant "
    "that helps Indian citizens understand the Bharatiya Nyaya Sanhita (BNS) and the Constitution. "
    "It supports voice input/output for non-literate users, streaming responses from Claude Sonnet 4.5, "
    "and offers a Pro tier that unlocks lawyer-consultation-style deep answers, drafts, action plans "
    "and escalation paths."
)

identity_rows = [
    ["Launcher name (Play Store, home screen)", "MSafe Legal Aid"],
    ["In-app AI persona / product name", "Dhara"],
    ["Company", "MSafe Solutions"],
    ["Copyright", "© Callistus Moses"],
    ["Android package / iOS bundle ID", "com.msafesolutions.legalaid"],
    ["Deep-link scheme", "msafelegalaid://"],
    ["Slug", "msafe-legal-aid"],
    ["Firebase project", "msafelegalaid"],
]

screens_rows = [
    ["#", "Route", "Purpose", "Key features"],
    ["1", "/",               "Auth gate",         "Redirects to login or main app based on JWT"],
    ["2", "/login",          "Login",             "Email + password"],
    ["3", "/signup",         "Signup",            "Email, password, name, phone, mandatory T&C acceptance"],
    ["4", "/(tabs)/index — Ask", "Main chat",     "Streaming Claude 4.5, mic (native STT), TTS, Basic/Pro toggle, sample counter, paywall modal"],
    ["5", "/(tabs)/rights",   "Rights guides",    "Police stop, arrest, FIR, women's safety, traffic, RTI"],
    ["6", "/(tabs)/history",  "Chat history",     "Past sessions, tap to reopen, delete"],
    ["7", "/(tabs)/settings", "Settings",         "Language (22), model picker, Pro status, terms, logout, helplines"],
    ["8", "/session/[id]",    "Reopen old chat",  "Full message history for a past session"],
    ["9", "/upgrade",         "Pro checkout",     "Razorpay ₹50 + Stripe $5 + payment-ID verify modal"],
    ["10-12", "Layouts + HTML host", "Framework", "_layout, tabs/_layout, +html"],
]

routes_by_cat = [
    ["Auth",       "POST /auth/register · POST /auth/login · GET /auth/me · POST /auth/accept-terms"],
    ["Chat",       "POST /chat/stream (SSE) · GET /chat/sessions · GET /chat/sessions/{id}/messages · DELETE /chat/sessions/{id}"],
    ["Voice",      "POST /voice/transcribe · POST /voice/tts"],
    ["Billing",    "POST /billing/checkout (Stripe) · POST /billing/verify · POST /webhooks/stripe · GET /billing/razorpay/config · POST /billing/razorpay/submit-payment-id · POST /webhooks/razorpay · GET /billing/pricing"],
    ["Reference",  "GET /reference/languages · GET /reference/models · GET /reference/topics · GET /reference/topics/{id}"],
    ["Legal",      "GET /legal/terms"],
    ["Health",     "GET /health · GET /"],
]

test_priorities = [
    ("Priority 1 — Core (test first, catch showstoppers)", [
        "Signup with phone + T&C → account created",
        "Login → JWT stored → lands on Ask tab",
        "Basic chat → streaming Claude response with BNS/Constitution citations → counter stays 0",
        "TTS speaker on AI reply → hear voice output",
        "Language switch (Settings → Language) to Hindi → replies + TTS in Hindi",
        "Non-dismissible disclaimer banner visible above tab bar on ALL 4 tabs",
        "Home-screen app icon shows 'MSafe Legal Aid'",
    ]),
    ("Priority 2 — Pro paywall (critical revenue flow)", [
        "Pro toggle OFF → basic suggestions + unlimited chats",
        "Pro toggle ON → Pro suggestions + '5 of 5 samples remaining' badge",
        "5 Pro messages → each returns lawyer-style deep answer + counter decrements",
        "6th Pro message → paywall modal with ₹50 / $5 + Upgrade + Continue-in-Basic",
        "Tap Upgrade → routes to /upgrade screen",
    ]),
    ("Priority 3 — Payments (test mode only)", [
        "Razorpay: browser opens razorpay.me/@calviltech → complete ₹50 UPI → paste Payment ID → Pro activated",
        "Stripe: currently fails (sk_test_emergent placeholder) — replace with real Stripe key before test",
    ]),
    ("Priority 4 — Voice (native STT only works in APK)", [
        "APK: mic → speak Hindi → live partial transcript → release → message sent (on-device, zero cost)",
        "Web / Expo Go: mic → falls back to cloud Whisper (record → upload → transcript)",
    ]),
    ("Priority 5 — Nice-to-have", [
        "Rights tab → expand each category → see structured content",
        "History tab → past sessions → tap → old messages load",
        "Settings → Terms of Service → full legal text visible",
        "Settings → Logout → returns to login",
    ]),
]

credit_tips = [
    "Batch requests: send multiple asks in one message — saves ~40% credits by avoiding repeated context loads.",
    "Test in Preview first, always. Every fix + Publish + bug found = double cost. Preview is free.",
    "Redeploy is free. Batch code changes → single Redeploy → single APK rebuild.",
    "Skip full RAG for now (~200-400 credits). Harden the system prompt to refuse invented citations first (~5 credits) — often 'good enough'.",
    "Do NOT fork. Fork = fresh chat = re-pay to re-establish context. Stay in this project.",
    "Reuse payment flow. Don't add Cashfree/PhonePe/UPI QR until real users validate ₹50 conversions.",
    "Screenshots > descriptions when reporting bugs — 1 tool call vs 3-4 debug calls.",
    "Consider disabling Stripe if all users are Indian. 1-line env-var change, saves user confusion.",
]

credit_cost = [
    ("Summary / status check like this",         "2 – 4 credits"),
    ("Quick fix / config change",                "1 – 3 credits"),
    ("Reading testing_agent report",             "1 – 2 credits"),
    ("Typical feature addition (e.g. Pro paywall)", "15 – 25 credits"),
    ("Big feature (RAG, region gate, i18n)",     "200 – 400 credits"),
    ("Deploy",                                   "~1 credit (Redeploy is free)"),
    ("APK / AAB build",                          "Included in deploy tier"),
]

url_options = [
    ["Option", "URL you'd get", "Setup effort", "Verdict"],
    ["Preview URL (works now)", "https://dhara-shield-2.preview.emergentagent.com", "Zero — already live", "Best for immediate sharing"],
    ["Emergent Deploy (default)", "https://msafe-legal-aid.emergent.host (approx)",  "1 click Publish → Deploy", "Permanent + free redeploy"],
    ["Subdomain (dhara.msafesolutions.com)", "NOT SUPPORTED on Expo/mobile flow", "N/A", "Requires separate Full Stack Web App project"],
    ["Path (msafesolutions.com/dhara)", "NOT POSSIBLE via DNS",                  "Your own web server + reverse proxy", "Out of Emergent's control"],
]

# ---------- DOCX ----------
def build_docx(path):
    doc = Document()

    # ---- Cover ----
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(title)
    r.font.size = Pt(24); r.font.bold = True
    r.font.color.rgb = RGBColor(0x0A, 0x1C, 0x3A)

    st = doc.add_paragraph()
    st.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = st.add_run(subtitle)
    r.font.size = Pt(14); r.font.italic = True
    r.font.color.rgb = RGBColor(0xC9, 0xA2, 0x27)

    m = doc.add_paragraph()
    m.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = m.add_run(meta)
    r.font.size = Pt(10)
    r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    doc.add_paragraph()

    def h(text, level=1):
        p = doc.add_heading(text, level=level)
        for r in p.runs:
            r.font.color.rgb = RGBColor(0x0A, 0x1C, 0x3A)

    def para(text, bold=False, size=11):
        p = doc.add_paragraph()
        r = p.add_run(text); r.font.size = Pt(size); r.bold = bold
        return p

    def table(rows, header=True, col_widths=None):
        tbl = doc.add_table(rows=len(rows), cols=len(rows[0]))
        tbl.style = "Light Grid Accent 1"
        for ri, row in enumerate(rows):
            for ci, cell in enumerate(row):
                c = tbl.rows[ri].cells[ci]
                c.text = str(cell)
                for p in c.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(9)
                        if header and ri == 0:
                            run.bold = True
        if col_widths:
            for ri in range(len(rows)):
                for ci, w in enumerate(col_widths):
                    tbl.rows[ri].cells[ci].width = w

    def bullets(items):
        for it in items:
            p = doc.add_paragraph(style='List Bullet')
            r = p.add_run(it); r.font.size = Pt(10)

    # ---- 1. Overview ----
    h("1. App Overview", 1)
    para(overview)

    h("Brand Identity", 2)
    table([["Field", "Value"]] + identity_rows)

    # ---- 2. Screens ----
    h("2. Screens (12 total)", 1)
    table(screens_rows)

    # ---- 3. Backend ----
    h("3. Backend API (24 endpoints)", 1)
    table([["Category", "Endpoints"]] + routes_by_cat)

    # ---- 4. Features ----
    h("4. Key Features Shipped", 1)
    bullets([
        "JWT auth with mandatory Terms & Conditions acceptance + timestamp",
        "22 Indian languages — Hindi, Bengali, Tamil, Telugu, Marathi, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese, Maithili, Santali, Kashmiri, Nepali, Konkani, Sindhi, Dogri, Manipuri, Bodo, Sanskrit + English",
        "Streaming AI answers via Claude Sonnet 4.5 (Anthropic) — GPT-5.2 / Gemini 3 selectable",
        "On-device native STT (expo-speech-recognition) with auto-fallback to cloud Whisper",
        "Multilingual TTS via expo-speech",
        "Pro paywall — first 5 pro-mode queries free (samples), 6th requires payment",
        "Razorpay ₹50 (India) via razorpay.me hosted link + Payment-ID verification",
        "Stripe $5 USD (International) — hosted checkout + webhook",
        "Non-dismissible legal disclaimer banner on every tab",
        "Rights knowledge tab (police stop, arrest, FIR, women's safety, traffic, RTI)",
        "Emergency helplines (112, 181, 15100, 1098)",
        "Chat history per session with delete",
        "Firebase-matched package name for future push notifications",
    ])

    # ---- 5. Testing checklist ----
    h("5. Functionality Testing Checklist", 1)
    for hd, items in test_priorities:
        h(hd, 2)
        bullets(items)

    # ---- 6. Web / URL options ----
    h("6. Shareable Web URL Options", 1)
    table(url_options)

    # ---- 7. Save credits ----
    h("7. Credit-Saving Suggestions", 1)
    bullets(credit_tips)

    # ---- 8. Credit costs ----
    h("8. Typical Credit Costs", 1)
    table([["Activity", "Estimated cost"]] + credit_cost)

    # ---- Footer ----
    doc.add_paragraph()
    f = doc.add_paragraph()
    f.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = f.add_run("MSafe Legal Aid · © Callistus Moses · MSafe Solutions")
    r.font.size = Pt(9); r.font.italic = True
    r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    doc.save(path)

# ---------- PDF ----------
def build_pdf(path):
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=16*mm, rightMargin=16*mm, topMargin=18*mm, bottomMargin=18*mm)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="H1b", parent=styles["Heading1"], textColor=colors.HexColor(BRAND), fontSize=18, spaceAfter=8))
    styles.add(ParagraphStyle(name="H2b", parent=styles["Heading2"], textColor=colors.HexColor(BRAND), fontSize=13, spaceAfter=4))
    styles.add(ParagraphStyle(name="H3b", parent=styles["Heading3"], textColor=colors.HexColor(GOLD), fontSize=11, spaceAfter=2))
    styles.add(ParagraphStyle(name="Body11", parent=styles["BodyText"], fontSize=10, leading=14))
    styles.add(ParagraphStyle(name="TitleBig", parent=styles["Title"], textColor=colors.HexColor(BRAND), fontSize=26, alignment=1))
    styles.add(ParagraphStyle(name="Sub", parent=styles["BodyText"], fontSize=13, alignment=1, textColor=colors.HexColor(GOLD), spaceAfter=4))
    styles.add(ParagraphStyle(name="MetaCenter", parent=styles["BodyText"], fontSize=9, alignment=1, textColor=colors.grey))
    styles.add(ParagraphStyle(name="BulletX", parent=styles["BodyText"], fontSize=10, leading=13, leftIndent=12, bulletIndent=0))

    story = []

    story.append(Spacer(1, 40))
    story.append(Paragraph(title, styles["TitleBig"]))
    story.append(Paragraph(subtitle, styles["Sub"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(meta, styles["MetaCenter"]))
    story.append(Spacer(1, 24))

    def h1(t): story.append(Paragraph(t, styles["H1b"]))
    def h2(t): story.append(Paragraph(t, styles["H2b"]))
    def h3(t): story.append(Paragraph(t, styles["H3b"]))
    def p(t):  story.append(Paragraph(t, styles["Body11"]))
    def spacer(h=6): story.append(Spacer(1, h))
    def bullets(items):
        for it in items:
            story.append(Paragraph(f"• {it}", styles["BulletX"]))
    def table_block(rows, col_widths=None, header=True):
        t = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
        ts = [
            ("BOX", (0,0), (-1,-1), 0.4, colors.HexColor("#BBBBBB")),
            ("INNERGRID", (0,0), (-1,-1), 0.3, colors.HexColor("#DDDDDD")),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("FONTSIZE", (0,0), (-1,-1), 8.5),
            ("LEFTPADDING", (0,0), (-1,-1), 4),
            ("RIGHTPADDING", (0,0), (-1,-1), 4),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ]
        if header:
            ts += [
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor(BRAND)),
                ("TEXTCOLOR", (0,0), (-1,0), colors.white),
                ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ]
        t.setStyle(TableStyle(ts))
        story.append(t)
        story.append(Spacer(1, 8))

    def para_rows(rows):
        # Wrap each cell string in a Paragraph so text wraps in narrow columns
        return [[Paragraph(str(c), styles["Body11"]) for c in row] for row in rows]

    # 1. Overview
    h1("1. App Overview")
    p(overview)
    spacer()
    h2("Brand Identity")
    ident = [["Field", "Value"]] + identity_rows
    table_block(para_rows(ident), col_widths=[75*mm, 95*mm])

    # 2. Screens
    h1("2. Screens (12 total)")
    table_block(para_rows(screens_rows), col_widths=[8*mm, 32*mm, 26*mm, 100*mm])

    # 3. Backend
    h1("3. Backend API (24 endpoints)")
    table_block(para_rows([["Category", "Endpoints"]] + routes_by_cat), col_widths=[25*mm, 145*mm])

    # 4. Features
    h1("4. Key Features Shipped")
    bullets([
        "JWT auth with mandatory Terms &amp; Conditions acceptance + timestamp",
        "22 Indian languages including Hindi, Bengali, Tamil, Telugu, Marathi, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese and English",
        "Streaming AI answers via Claude Sonnet 4.5 (Anthropic) — GPT-5.2 / Gemini 3 selectable",
        "On-device native STT (expo-speech-recognition) with auto-fallback to cloud Whisper",
        "Multilingual TTS via expo-speech",
        "Pro paywall — first 5 pro-mode queries free (samples), 6th requires payment",
        "Razorpay ₹50 (India) via razorpay.me hosted link + Payment-ID verification",
        "Stripe $5 USD (International) — hosted checkout + webhook",
        "Non-dismissible legal disclaimer banner on every tab",
        "Rights knowledge tab (police stop, arrest, FIR, women's safety, traffic, RTI)",
        "Emergency helplines (112, 181, 15100, 1098)",
        "Chat history per session with delete",
        "Firebase-matched package name for future push notifications",
    ])
    spacer(10)

    # 5. Testing
    h1("5. Functionality Testing Checklist")
    for hd, items in test_priorities:
        h2(hd)
        bullets(items)
        spacer(4)

    # 6. URL options
    h1("6. Shareable Web URL Options")
    table_block(para_rows(url_options), col_widths=[38*mm, 62*mm, 32*mm, 38*mm])

    # 7. Credit tips
    h1("7. Credit-Saving Suggestions")
    bullets(credit_tips)
    spacer(10)

    # 8. Credit costs
    h1("8. Typical Credit Costs")
    table_block(para_rows([["Activity", "Estimated cost"]] + credit_cost), col_widths=[110*mm, 60*mm])

    spacer(20)
    story.append(Paragraph("MSafe Legal Aid · © Callistus Moses · MSafe Solutions", styles["MetaCenter"]))

    doc.build(story)

if __name__ == "__main__":
    build_docx("/app/downloads/MSafe_Legal_Aid_App_Summary.docx")
    build_pdf ("/app/downloads/MSafe_Legal_Aid_App_Summary.pdf")
    print("DONE")
