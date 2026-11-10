"""
Head Out Wizard - 3-attempt full flow test
Tests: Destination -> Radius -> Circle -> Active screen -> End journey
"""
import asyncio

BASE_URL = "https://dhara-shield-2.preview.emergentagent.com"

async def run_test(page):
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    results = []

    # --- SETUP ---
    # Language screen
    await page.locator('[data-testid="lang-en"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="language-continue"]').click(force=True)
    await page.wait_for_timeout(2000)
    print(f"After language: {page.url}")

    # Consent screen
    await page.locator('[data-testid="consent-age-adult"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-terms-checkbox"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-data-checkbox"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="consent-continue-button"]').click(force=True)
    await page.wait_for_timeout(1500)
    print(f"After consent: {page.url}")

    # Login - get testids
    all_tids = []
    for el in await page.locator('[data-testid]').all():
        tid = await el.get_attribute("data-testid")
        all_tids.append(tid)
    print(f"Login screen testids: {all_tids}")

    # Fill email
    email_sel = '[data-testid="login-email"]' if "login-email" in all_tids else 'input[type="email"]'
    await page.locator(email_sel).first.fill("voicetest2026@example.com")

    # Fill password
    pwd_sel = '[data-testid="login-password"]' if "login-password" in all_tids else 'input[type="password"]'
    await page.locator(pwd_sel).first.fill("TestPass123!")
    await page.wait_for_timeout(200)

    # Submit
    submit_sel = '[data-testid="login-submit"]' if "login-submit" in all_tids else None
    if submit_sel:
        await page.locator(submit_sel).click(force=True)
    else:
        await page.get_by_text("Sign In", exact=True).click(force=True)
    await page.wait_for_timeout(3000)
    print(f"After login: {page.url}")

    # --- HELPER FUNCTION ---
    async def run_attempt(attempt_num, destination):
        print(f"\n=== ATTEMPT {attempt_num}: {destination} ===")

        # Navigate to Step 1
        await page.goto(BASE_URL + "/women/head-out/destination")
        await page.wait_for_timeout(2000)

        dest_input = page.locator('[data-testid="headout-destination-search"]')
        if not await dest_input.is_visible():
            print(f"Attempt {attempt_num}: FAIL - Destination input not visible")
            return False

        # Type destination
        await dest_input.fill(destination)
        await page.wait_for_timeout(500)
        print(f"Attempt {attempt_num} Step1: Typed destination")

        # Check Next button
        next_btn = page.locator('[data-testid="headout-dest-next"]')
        disabled = await next_btn.is_disabled()
        print(f"Attempt {attempt_num} Step1: Next disabled={disabled}")

        await next_btn.click(force=True)
        await page.wait_for_timeout(2000)
        print(f"Attempt {attempt_num} Step1 done: {page.url}")

        # Step 2: Radius
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        if not await radius_next.is_visible():
            print(f"Attempt {attempt_num}: FAIL - Not at radius screen, URL={page.url}")
            return False
        print(f"Attempt {attempt_num} Step2: At radius screen")

        # Select 200m preset
        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
            await page.wait_for_timeout(200)

        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)
        print(f"Attempt {attempt_num} Step2 done: {page.url}")

        # Step 3: Circle + Duration
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        if not await start_btn.is_visible():
            print(f"Attempt {attempt_num}: FAIL - Not at circle screen, URL={page.url}")
            return False
        print(f"Attempt {attempt_num} Step3: At circle/duration screen")

        # Select 30 min
        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
            await page.wait_for_timeout(200)
            print(f"Attempt {attempt_num} Step3: Selected 30 min")

        await start_btn.click(force=True)
        await page.wait_for_timeout(3000)
        print(f"Attempt {attempt_num} Step3 done: {page.url}")

        # Active screen checks
        timer = page.locator('[data-testid="headout-timer"]')
        timer_visible = await timer.is_visible()
        timer_text = await timer.text_content() if timer_visible else "N/A"
        print(f"Attempt {attempt_num} Active: timer visible={timer_visible}, text={timer_text}")

        # Verify destination text in active screen
        dest_in_active = await page.get_by_text(destination).is_visible()
        print(f"Attempt {attempt_num} Active: destination text visible={dest_in_active}")

        # Screenshot active state
        await page.screenshot(
            path=f"/app/test_reports/ho_active_{attempt_num}.jpeg",
            quality=40, full_page=False
        )

        # End session
        end_btn = page.locator('[data-testid="headout-end"]')
        end_visible = await end_btn.is_visible()
        print(f"Attempt {attempt_num} Active: end button visible={end_visible}")

        if not end_visible:
            print(f"Attempt {attempt_num}: PARTIAL - Timer visible={timer_visible}, but no end button")
            return timer_visible

        await end_btn.click(force=True)
        await page.wait_for_timeout(2500)
        post_end_url = page.url
        print(f"Attempt {attempt_num} Post-end URL: {post_end_url}")

        # Verify back at Step 1
        back_dest = await page.locator('[data-testid="headout-destination-search"]').is_visible()
        print(f"Attempt {attempt_num} Post-end: Back at Step1={back_dest}")

        if back_dest:
            print(f"Attempt {attempt_num}: PASS - Full flow complete with clean reset")
        else:
            print(f"Attempt {attempt_num}: PARTIAL - Flow done but not at Step1 (URL={post_end_url})")

        return timer_visible and end_visible

    # Run 3 attempts
    for i, dest in enumerate([
        "TEST_QA Library Gate Attempt1",
        "TEST_QA Metro Station Attempt2",
        "TEST_QA Home Hostel Attempt3"
    ], 1):
        success = await run_attempt(i, dest)
        results.append({"attempt": i, "dest": dest, "pass": success})

    print("\n=== FINAL RESULTS ===")
    for r in results:
        status = "PASS" if r["pass"] else "FAIL"
        print(f"Attempt {r['attempt']} ({r['dest']}): {status}")

    passed = sum(1 for r in results if r["pass"])
    print(f"Total passed: {passed}/3")
    return results
