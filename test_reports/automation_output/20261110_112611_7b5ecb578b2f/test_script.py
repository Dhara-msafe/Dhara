async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    results = []

    # Language
    await page.locator('[data-testid="lang-en"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="language-continue"]').click(force=True)
    await page.wait_for_timeout(2000)

    # Consent
    await page.locator('[data-testid="consent-age-adult"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-terms-checkbox"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-data-checkbox"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="consent-continue-button"]').click(force=True)
    await page.wait_for_timeout(1500)

    # Login - check what testIDs are on login screen
    all_els = await page.locator('[data-testid]').all()
    for el in all_els:
        tid = await el.get_attribute("data-testid")
        print(f"  login testid: {tid}")

    # Fill using testid or fallback to input
    email_input = page.locator('[data-testid="login-email"]')
    if not await email_input.is_visible():
        email_input = page.locator('input').first
    await email_input.fill("voicetest2026@example.com")

    pwd_input = page.locator('[data-testid="login-password"]')
    if not await pwd_input.is_visible():
        pwd_input = page.locator('input[type="password"]').first
    await pwd_input.fill("TestPass123!")
    await page.wait_for_timeout(200)

    # Find and click login submit
    submit = page.locator('[data-testid="login-submit"]')
    if not await submit.is_visible():
        # Try text match
        submit = page.get_by_text("Sign In", exact=True)
    await submit.click(force=True)
    await page.wait_for_timeout(3000)
    print(f"Post-login URL: {page.url}")

    # Navigate to Head Out
    await page.goto("https://dhara-shield-2.preview.emergentagent.com/women/head-out/destination")
    await page.wait_for_timeout(2000)
    print(f"At destination: {await page.locator('[data-testid=\"headout-destination-search\"]').is_visible()}")
    await page.screenshot(path="/app/test_reports/automation_output/20261110_112611_7b5ecb578b2f/ho_ready.jpeg", type="jpeg", quality=40, full_page=False)

