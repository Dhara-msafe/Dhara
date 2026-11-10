async def run_test(page, output_dir, page_url):

    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    await page.set_viewport_size({"width": 390, "height": 844})

    async def login_flow():
        """Handle language picker, consent, and login"""
        await page.wait_for_timeout(3000)

        # Handle language picker if present
        lang_en = page.locator('[data-testid="lang-en"]')
        if await lang_en.is_visible():
            await lang_en.click(force=True)
            await page.wait_for_timeout(1000)
            confirm = page.locator('[data-testid="lang-confirm"]')
            if await confirm.is_visible():
                await confirm.click(force=True)
                await page.wait_for_timeout(1000)
            print("Language set to English")

        # Handle consent screen
        await page.wait_for_timeout(1500)
        consent_check = page.locator('[data-testid="consent-checkbox"]')
        if await consent_check.is_visible():
            await consent_check.click(force=True)
            await page.wait_for_timeout(500)
            proceed = page.locator('[data-testid="consent-proceed"]')
            if await proceed.is_visible():
                await proceed.click(force=True)
                await page.wait_for_timeout(1000)
            print("Consent accepted")

        # Login
        await page.wait_for_timeout(1500)
        email_field = page.locator('[data-testid="login-email"]')
        if await email_field.is_visible():
            await email_field.fill("voicetest2026@example.com")
            pwd_field = page.locator('[data-testid="login-password"]')
            await pwd_field.fill("TestPass123!")
            login_btn = page.locator('[data-testid="login-submit"]')
            await login_btn.click(force=True)
            await page.wait_for_timeout(2000)
            print("Login submitted")
        else:
            print("Already logged in or no login screen")

    async def navigate_to_headout():
        """Navigate to Head Out wizard from main screen"""
        # Try sidebar/Women's Shield navigation
        await page.wait_for_timeout(1500)

        # Look for Women's Shield / Head Out button
        # Try direct navigation via URL
        await page.goto("https://dhara-shield-2.preview.emergentagent.com/women/head-out/destination")
        await page.wait_for_timeout(2000)

        # Check if we landed on destination page
        dest_input = page.locator('[data-testid="headout-destination-search"]')
        if await dest_input.is_visible():
            print("At destination page")
            return True

        # May have redirected due to no session - check URL
        current_url = page.url
        print(f"Current URL: {current_url}")
        return False

    async def run_headout_attempt(attempt_num: int, destination: str):
        """Complete one full Head Out wizard flow"""
        print(f"\n=== ATTEMPT {attempt_num}: Starting Head Out flow ===")

        # Step 1: Destination
        await page.wait_for_selector('[data-testid="headout-destination-search"]', timeout=8000)
        dest_input = page.locator('[data-testid="headout-destination-search"]')
        await dest_input.fill("")
        await dest_input.fill(destination)
        await page.wait_for_timeout(500)
        print(f"Attempt {attempt_num} - Step 1: Typed destination: {destination}")

        # Tap Next on Step 1
        next_btn = page.locator('[data-testid="headout-dest-next"]')
        is_enabled = not await next_btn.is_disabled()
        print(f"Attempt {attempt_num} - Step 1: Next button enabled: {is_enabled}")
        await next_btn.click(force=True)
        await page.wait_for_timeout(1500)

        # Step 2: Radius
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        await radius_next.wait_for(state="visible", timeout=6000)
        print(f"Attempt {attempt_num} - Step 2: At radius screen")

        # Select a radius preset (200m)
        radius_200 = page.locator('[data-testid="headout-radius-200"]')
        if await radius_200.is_visible():
            await radius_200.click(force=True)
            print(f"Attempt {attempt_num} - Step 2: Selected 200m radius")

        await radius_next.click(force=True)
        await page.wait_for_timeout(1500)

        # Step 3: Circle & Duration
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        await start_btn.wait_for(state="visible", timeout=6000)
        print(f"Attempt {attempt_num} - Step 3: At circle/duration screen")

        # Select 30 min duration
        dur_30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur_30.is_visible():
            await dur_30.click(force=True)
            print(f"Attempt {attempt_num} - Step 3: Selected 30 min duration")

        # Start Journey
        await start_btn.click(force=True)
        await page.wait_for_timeout(3000)

        # Active screen - verify timer
        current_url = page.url
        print(f"Attempt {attempt_num} - After start, URL: {current_url}")

        timer = page.locator('[data-testid="headout-timer"]')
        timer_visible = await timer.is_visible()
        print(f"Attempt {attempt_num} - Active: Timer visible: {timer_visible}")

        if timer_visible:
            timer_text = await timer.text_content()
            print(f"Attempt {attempt_num} - Active: Timer value: {timer_text}")

        # Check session destination displayed
        # The active card shows session.destination as destTxt
        active_card = page.locator('[data-testid="headout-active-card"]')
        if await active_card.is_visible():
            dest_text = await active_card.locator('text=' + destination).is_visible()
            print(f"Attempt {attempt_num} - Active: Destination '{destination}' visible: {dest_text}")

        # Take screenshot for verification
        await page.screenshot(path=f"/app/test_reports/automation_output/20261110_112240_2b5453e476b9/headout_attempt_{attempt_num}.jpeg", type="jpeg", quality=40, full_page=False)

        # End session - tap "I'm home safely"
        end_btn = page.locator('[data-testid="headout-end"]')
        end_visible = await end_btn.is_visible()
        print(f"Attempt {attempt_num} - End button visible: {end_visible}")

        if end_visible:
            await end_btn.click(force=True)
            await page.wait_for_timeout(2000)

            # Should redirect to destination step
            dest_input_after = page.locator('[data-testid="headout-destination-search"]')
            dest_visible_after = await dest_input_after.is_visible()
            print(f"Attempt {attempt_num} - After end: Back at destination screen: {dest_visible_after}")

            if dest_visible_after:
                print(f"Attempt {attempt_num} - SUCCESS: Clean reset to Step 1 after ending journey")
            else:
                current_url2 = page.url
                print(f"Attempt {attempt_num} - WARNING: URL after end: {current_url2}")

        return timer_visible and end_visible

    try:
        # Login first
        await login_flow()

        # Navigate to Head Out
        at_dest = await navigate_to_headout()

        # Run 3 attempts
        results = []
        destinations = [
            "TEST_QA Campus Library Attempt1",
            "TEST_QA Metro Station Attempt2",
            "TEST_QA Home Gate Attempt3"
        ]

        for i, dest in enumerate(destinations, 1):
            success = await run_headout_attempt(i, dest)
            results.append({"attempt": i, "destination": dest, "success": success})
            print(f"Attempt {i} result: {'PASS' if success else 'FAIL'}")

        print("\n=== SUMMARY ===")
        for r in results:
            print(f"Attempt {r['attempt']} ({r['destination']}): {'PASS' if r['success'] else 'FAIL'}")

        all_pass = all(r["success"] for r in results)
        print(f"\nOverall: {'ALL 3 ATTEMPTS PASSED' if all_pass else 'SOME ATTEMPTS FAILED'}")

    except Exception as e:
        print(f"Error: {e}")
        await page.screenshot(path="/app/test_reports/automation_output/20261110_112240_2b5453e476b9/headout_error.jpeg", type="jpeg", quality=40, full_page=False)

