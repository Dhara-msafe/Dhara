async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    # LANGUAGE
    await page.locator('[data-testid="lang-en"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="language-continue"]').click(force=True)
    await page.wait_for_timeout(2000)
    print(f"URL: {page.url}")

    # CONSENT
    await page.locator('[data-testid="consent-age-adult"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="consent-terms-checkbox"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="consent-data-checkbox"]').click(force=True)
    await page.wait_for_timeout(500)
    await page.locator('[data-testid="consent-continue-button"]').click(force=True)
    await page.wait_for_timeout(2000)
    print(f"URL after consent: {page.url}")

    # LOGIN
    await page.wait_for_timeout(1000)
    email = page.locator('[data-testid="login-email"]')
    if not await email.is_visible():
        email = page.locator('input[type="email"]').first
    await email.fill("voicetest2026@example.com")
    pwd = page.locator('[data-testid="login-password"]')
    if not await pwd.is_visible():
        pwd = page.locator('input[type="password"]').first
    await pwd.fill("TestPass123!")
    submit = page.locator('[data-testid="login-submit"]')
    if not await submit.is_visible():
        submit = page.get_by_text("Sign in").first
    await submit.click(force=True)
    await page.wait_for_timeout(3000)
    print(f"URL after login: {page.url}")

    # Navigate to Head Out destination
    await page.goto("https://dhara-shield-2.preview.emergentagent.com/women/head-out/destination")
    await page.wait_for_timeout(2000)
    print(f"URL after navigate: {page.url}")

    dest_input = page.locator('[data-testid="headout-destination-search"]')
    dest_visible = await dest_input.is_visible()
    print(f"Destination input visible: {dest_visible}")

    await page.screenshot(path="/app/test_reports/automation_output/20261110_112425_47c151164af4/ho_at_dest.jpeg", type="jpeg", quality=40, full_page=False)

