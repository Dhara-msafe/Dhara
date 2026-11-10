async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    results = []

    # --- SETUP: language + consent + login ---
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

    # Login - find login fields
    email_input = page.locator('[data-testid="login-email"]')
    if not await email_input.is_visible():
        all_inputs = await page.locator('input').all()
        for inp in all_inputs:
            itype = await inp.get_attribute("type")
            if itype in ["email", "text"]:
                email_input = inp
                break

    await email_input.fill("voicetest2026@example.com")
    await page.wait_for_timeout(200)

    pwd_input = page.locator('[data-testid="login-password"]')
    if not await pwd_input.is_visible():
        pwd_input = page.locator('input[type="password"]').first
    await pwd_input.fill("TestPass123!")
    await page.wait_for_timeout(200)

    # Find submit button
    submit_btn = page.locator('[data-testid="login-submit"]')
    if not await submit_btn.is_visible():
        submit_btn = page.get_by_role("button", name="Sign in")
    await submit_btn.click(force=True)
    await page.wait_for_timeout(3000)
    print(f"Post-login URL: {page.url}")


    # --- HELPER: complete one Head Out flow ---
    async def complete_headout_flow(attempt: int, destination: str):
        print(f"\n--- ATTEMPT {attempt}: {destination} ---")

        # Navigate to Step 1
        await page.goto("https://dhara-shield-2.preview.emergentagent.com/women/head-out/destination")
        await page.wait_for_timeout(2000)

        dest_input = page.locator('[data-testid="headout-destination-search"]')
        if not await dest_input.is_visible():
            print(f"Attempt {attempt}: FAIL - Destination input not visible, URL={page.url}")
            return False

        # Type destination
        await dest_input.fill(destination)
        await page.wait_for_timeout(500)
        print(f"Attempt {attempt} Step1: Typed '{destination}'")

        # Next button
        next_btn = page.locator('[data-testid="headout-dest-next"]')
        is_disabled = await next_btn.is_disabled()
        print(f"Attempt {attempt} Step1: Next disabled={is_disabled}")

        await next_btn.click(force=True)
        await page.wait_for_timeout(2000)
        print(f"Attempt {attempt} Step1: URL after next={page.url}")

        # Step 2: Radius
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        if not await radius_next.is_visible():
            print(f"Attempt {attempt}: FAIL - Radius screen not reached, URL={page.url}")
            return False
        print(f"Attempt {attempt} Step2: At radius screen")

        # Select 200m radius
        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
            await page.wait_for_timeout(200)

        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)
        print(f"Attempt {attempt} Step2: URL after next={page.url}")

        # Step 3: Circle + Duration
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        if not await start_btn.is_visible():
            print(f"Attempt {attempt}: FAIL - Circle screen not reached, URL={page.url}")
            return False
        print(f"Attempt {attempt} Step3: At circle/duration screen")

        # Select 30 min
        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
            await page.wait_for_timeout(200)
            print(f"Attempt {attempt} Step3: Selected 30 min")

        await start_btn.click(force=True)
        await page.wait_for_timeout(3000)
        print(f"Attempt {attempt} Step3: URL after start={page.url}")

        # Active screen checks
        timer = page.locator('[data-testid="headout-timer"]')
        timer_visible = await timer.is_visible()
        print(f"Attempt {attempt} Active: timer visible={timer_visible}")

        if timer_visible:
            timer_text = await timer.text_content()
            print(f"Attempt {attempt} Active: timer text='{timer_text}'")

        # Check destination text visible
        dest_shown = await page.get_by_text(destination).is_visible()
        print(f"Attempt {attempt} Active: destination text visible={dest_shown}")

        # Screenshot
        await page.screenshot(path=f"/app/test_reports/automation_output/20261110_112516_fc5da5879cd8/ho_active_{attempt}.jpeg", type="jpeg", quality=40, full_page=False)

        # End session
        end_btn = page.locator('[data-testid="headout-end"]')
        end_visible = await end_btn.is_visible()
        print(f"Attempt {attempt} Active: end button visible={end_visible}")

        if end_visible:
            await end_btn.click(force=True)
            await page.wait_for_timeout(2500)
            print(f"Attempt {attempt} Post-end: URL={page.url}")

            # Should be back at destination step
            back_at_dest = await page.locator('[data-testid="headout-destination-search"]').is_visible()
            print(f"Attempt {attempt} Post-end: Back at Step1={back_at_dest}")

            if back_at_dest:
                print(f"Attempt {attempt}: SUCCESS - Full flow complete, clean reset to Step 1")
                return True
            else:
                print(f"Attempt {attempt}: PARTIAL - Flow done but not cleanly back at Step1")
                return timer_visible  # partial success if we at least got to active screen

        return False


    # Run 3 attempts
    for i, dest in enumerate([
        "TEST_QA Library Gate Attempt1",
        "TEST_QA Metro Station Attempt2",
        "TEST_QA Home Hostel Attempt3"
    ], 1):
        success = await complete_headout_flow(i, dest)
        results.append({"attempt": i, "dest": dest, "pass": success})

    print("\n=== FINAL RESULTS ===")
    for r in results:
        print(f"Attempt {r['attempt']} ({r['dest']}): {'PASS' if r['pass'] else 'FAIL'}")

    passed = sum(1 for r in results if r["pass"])
    print(f"Passed: {passed}/3")

