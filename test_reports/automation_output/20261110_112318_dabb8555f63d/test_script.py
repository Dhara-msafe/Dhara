async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    async def handle_language():
        lang_en = page.locator('[data-testid="lang-en"]')
        if await lang_en.is_visible():
            await lang_en.click(force=True)
            await page.wait_for_timeout(500)
            confirm = page.locator('[data-testid="lang-confirm"]')
            if await confirm.is_visible():
                await confirm.click(force=True)
                await page.wait_for_timeout(1000)
            print("Language set")

    async def handle_consent():
        # Scroll down and check for age selector / continue
        await page.wait_for_timeout(1000)
        # Try clicking age option
        for testid in ["consent-age-18", "consent-age-adult", "age-18-plus", "age-adult"]:
            btn = page.locator(f'[data-testid="{testid}"]')
            if await btn.is_visible():
                await btn.click(force=True)
                await page.wait_for_timeout(500)
                print(f"Clicked {testid}")
                break

        # Check for "To continue, select your age above" text - find age selectors
        # Try looking at all pressable buttons on screen
        age_btns = page.locator('text="18+"')
        if await age_btns.count() > 0:
            await age_btns.first.click(force=True)
            await page.wait_for_timeout(500)
            print("Clicked 18+ text")

        # Click Continue
        continue_btn = page.locator('[data-testid="consent-proceed"]')
        if not await continue_btn.is_visible():
            continue_btn = page.get_by_text("Continue")
        if await continue_btn.is_visible():
            await continue_btn.click(force=True)
            await page.wait_for_timeout(1500)
            print("Consent continued")

    async def handle_login():
        await page.wait_for_timeout(1500)
        email = page.locator('[data-testid="login-email"]')
        if not await email.is_visible():
            # Try alternative selectors
            email = page.locator('input[placeholder*="email" i], input[type="email"]').first
        if await email.is_visible():
            await email.fill("voicetest2026@example.com")
            pwd = page.locator('[data-testid="login-password"]')
            if not await pwd.is_visible():
                pwd = page.locator('input[type="password"]').first
            await pwd.fill("TestPass123!")
            submit = page.locator('[data-testid="login-submit"]')
            if not await submit.is_visible():
                submit = page.get_by_text("Sign in").first
            await submit.click(force=True)
            await page.wait_for_timeout(2500)
            print(f"Login done, URL: {page.url}")

    # Initial setup
    await handle_language()
    # Check for consent
    if "consent" in page.url:
        await handle_consent()
    await handle_login()

    print(f"After setup URL: {page.url}")
    await page.screenshot(path="/app/test_reports/automation_output/20261110_112318_dabb8555f63d/ho_setup.jpeg", type="jpeg", quality=40, full_page=False)

