async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    BASE_URL = "https://dhara-shield-2.preview.emergentagent.com"
    results = []

    # Language screen
    await page.locator('[data-testid="lang-en"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="language-continue"]').click(force=True)
    await page.wait_for_timeout(2000)

    # Consent screen
    await page.locator('[data-testid="consent-age-adult"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-terms-checkbox"]').click(force=True)
    await page.wait_for_timeout(200)
    await page.locator('[data-testid="consent-data-checkbox"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="consent-continue-button"]').click(force=True)
    await page.wait_for_timeout(1500)
    print("Login screen reached: " + page.url)

    # Get login testids
    all_tids = [await el.get_attribute("data-testid") for el in await page.locator('[data-testid]').all()]
    print("Login testids: " + str([t for t in all_tids if t and "login" in t]))

    # Fill login
    email_sel = '[data-testid="login-email"]' if "login-email" in all_tids else 'input'
    await page.locator(email_sel).first.fill("voicetest2026@example.com")
    pwd_sel = '[data-testid="login-password"]' if "login-password" in all_tids else 'input[type="password"]'
    await page.locator(pwd_sel).first.fill("TestPass123!")
    await page.wait_for_timeout(200)

    # Submit
    if "login-submit" in all_tids:
        await page.locator('[data-testid="login-submit"]').click(force=True)
    else:
        await page.get_by_text("Sign In").first.click(force=True)
    await page.wait_for_timeout(3000)
    print("After login: " + page.url)

    # ATTEMPT 1
    print("\n=== ATTEMPT 1 ===")
    await page.goto(BASE_URL + "/women/head-out/destination")
    await page.wait_for_timeout(2000)
    dest_input = page.locator('[data-testid="headout-destination-search"]')
    dest_visible = await dest_input.is_visible()
    print("Step1 dest input visible: " + str(dest_visible))

    await dest_input.fill("TEST_QA Library Gate Attempt1")
    await page.wait_for_timeout(500)
    next_btn = page.locator('[data-testid="headout-dest-next"]')
    print("Step1 Next disabled: " + str(await next_btn.is_disabled()))
    await next_btn.click(force=True)
    await page.wait_for_timeout(2000)
    print("After Step1: " + page.url)

    # Step 2
    radius_next = page.locator('[data-testid="headout-radius-next"]')
    at_radius = await radius_next.is_visible()
    print("At radius screen: " + str(at_radius))
    if at_radius:
        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)
        print("After Step2: " + page.url)

    # Step 3
    start_btn = page.locator('[data-testid="headout-start-journey"]')
    at_circle = await start_btn.is_visible()
    print("At circle screen: " + str(at_circle))
    if at_circle:
        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
        await start_btn.click(force=True)
        await page.wait_for_timeout(3000)
        print("After Step3: " + page.url)

    timer = page.locator('[data-testid="headout-timer"]')
    timer_vis = await timer.is_visible()
    timer_text = await timer.text_content() if timer_vis else "N/A"
    print("Timer visible: " + str(timer_vis) + " text: " + str(timer_text))

    dest_shown = await page.get_by_text("TEST_QA Library Gate Attempt1").is_visible()
    print("Destination in active card: " + str(dest_shown))

    await page.screenshot(path="/app/test_reports/automation_output/20261110_112710_f068450d5262/ho_active_1.jpeg", type="jpeg", quality=40, full_page=False)

    end_btn = page.locator('[data-testid="headout-end"]')
    end_vis = await end_btn.is_visible()
    print("End button visible: " + str(end_vis))

    if end_vis:
        await end_btn.click(force=True)
        await page.wait_for_timeout(2500)
        back = await page.locator('[data-testid="headout-destination-search"]').is_visible()
        print("Back at Step1: " + str(back))
        results.append({"attempt": 1, "pass": timer_vis and end_vis, "back_at_step1": back})
    else:
        results.append({"attempt": 1, "pass": False})

    print("Attempt 1 result: " + str(results[-1]))

