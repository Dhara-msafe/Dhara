async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    BASE_URL = "https://dhara-shield-2.preview.emergentagent.com"
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

    # Login
    await page.locator('[data-testid="login-email-input"]').fill("voicetest2026@example.com")
    await page.locator('[data-testid="login-password-input"]').fill("TestPass123!")
    await page.locator('[data-testid="login-submit-button"]').click(force=True)
    await page.wait_for_timeout(3000)
    print("After login: " + page.url)

    async def run_attempt(num, dest):
        print("\n=== ATTEMPT " + str(num) + ": " + dest + " ===")

        # Step 1
        await page.goto(BASE_URL + "/women/head-out/destination")
        await page.wait_for_timeout(2000)
        dest_input = page.locator('[data-testid="headout-destination-search"]').first
        dest_vis = await dest_input.is_visible()
        print("Step1 input visible: " + str(dest_vis))
        if not dest_vis:
            return {"attempt": num, "pass": False, "note": "No dest input"}

        await dest_input.fill(dest)
        await page.wait_for_timeout(500)

        next_btn = page.locator('[data-testid="headout-dest-next"]')
        await next_btn.click(force=True)
        await page.wait_for_timeout(2000)

        # Step 2
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        at_r = await radius_next.is_visible()
        print("At radius: " + str(at_r))
        if not at_r:
            return {"attempt": num, "pass": False, "note": "No radius screen"}

        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)

        # Step 3
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        at_c = await start_btn.is_visible()
        print("At circle: " + str(at_c))
        if not at_c:
            return {"attempt": num, "pass": False, "note": "No circle screen"}

        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
        await start_btn.click(force=True)
        await page.wait_for_timeout(3000)
        print("After start: " + page.url)

        # Active screen
        timer = page.locator('[data-testid="headout-timer"]')
        timer_vis = await timer.is_visible()
        timer_text = await timer.text_content() if timer_vis else "N/A"
        print("Timer: " + str(timer_vis) + " = " + str(timer_text))

        dest_shown = await page.get_by_text(dest).is_visible()
        print("Dest in active: " + str(dest_shown))

        await page.screenshot(path="/app/test_reports/automation_output/20261110_112801_1bbd55a3f091/ho_active_.jpeg" + str(num, type="jpeg", quality=40) + ".jpeg", quality=40, full_page=False)

        # End session
        end_btn = page.locator('[data-testid="headout-end"]')
        end_vis = await end_btn.is_visible()
        print("End btn: " + str(end_vis))

        if end_vis:
            await end_btn.click(force=True)
            await page.wait_for_timeout(2500)
            # Check back at step 1 (use .first to avoid strict mode issue)
            back = await page.locator('[data-testid="headout-destination-search"]').first.is_visible()
            print("Back at Step1: " + str(back))
            return {"attempt": num, "pass": timer_vis and end_vis, "timer": timer_text, "back": back}

        return {"attempt": num, "pass": False, "note": "No end button"}

    r2 = await run_attempt(2, "TEST_QA Metro Station Attempt2")
    results.append(r2)
    r3 = await run_attempt(3, "TEST_QA Home Hostel Attempt3")
    results.append(r3)

    print("\n=== RESULTS ===")
    for r in results:
        print(str(r))

