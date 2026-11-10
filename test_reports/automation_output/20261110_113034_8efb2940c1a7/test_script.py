async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    BASE_URL = "https://dhara-shield-2.preview.emergentagent.com"
    shot_paths = [
        "/app/test_reports/ho_final_a1.jpeg",
        "/app/test_reports/ho_final_a2.jpeg",
        "/app/test_reports/ho_final_a3.jpeg"
    ]
    pass_count = 0
    fail_notes = []

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
    print("Login URL: " + page.url)

    for i in range(3):
        attempt_num = i + 1
        dest = "TEST_QA Journey Attempt" + str(attempt_num)
        shot_path = shot_paths[i]
        print("\n=== ATTEMPT " + str(attempt_num) + " ===")

        # Navigate to Step 1
        await page.goto(BASE_URL + "/women/head-out/destination")
        await page.wait_for_timeout(3000)

        dest_input = page.locator('[data-testid="headout-destination-search"]').first
        if not await dest_input.is_visible():
            fail_notes.append("A" + str(attempt_num) + ": No dest input at " + page.url)
            continue

        await dest_input.click(force=True)
        await page.wait_for_timeout(300)
        await dest_input.fill(dest)
        await page.wait_for_timeout(1000)

        next_btn = page.locator('[data-testid="headout-dest-next"]')
        nd = await next_btn.is_disabled()
        print("Step1 Next disabled=" + str(nd) + " dest=" + dest)
        if nd:
            fail_notes.append("A" + str(attempt_num) + ": Next disabled")
            continue

        await next_btn.click(force=True)
        await page.wait_for_timeout(3000)
        url1 = page.url
        print("After Step1: " + url1)

        if "radius" not in url1:
            fail_notes.append("A" + str(attempt_num) + ": Did not reach radius (" + url1 + ")")
            continue

        # Step 2
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)
        print("After Step2: " + page.url)

        # Step 3
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        if not await start_btn.is_visible():
            fail_notes.append("A" + str(attempt_num) + ": No circle screen at " + page.url)
            continue

        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
        await start_btn.click(force=True)
        await page.wait_for_timeout(3500)
        print("After Step3: " + page.url)

        # Active screen checks
        timer = page.locator('[data-testid="headout-timer"]')
        timer_vis = await timer.is_visible()
        timer_text = "N/A"
        if timer_vis:
            timer_text = await timer.text_content()
        print("Timer vis=" + str(timer_vis) + " text=" + str(timer_text))

        dest_in_card = await page.get_by_text(dest).is_visible()
        print("Dest in active card: " + str(dest_in_card))

        await page.screenshot(path=shot_path, quality=40, full_page=False)

        end_btn = page.locator('[data-testid="headout-end"]')
        end_vis = await end_btn.is_visible()
        print("End btn vis: " + str(end_vis))

        if end_vis:
            await end_btn.click(force=True)
            await page.wait_for_timeout(3000)
            post_url = page.url
            back_dest = await page.locator('[data-testid="headout-destination-search"]').first.is_visible()
            print("Post-end URL: " + post_url + " back_at_step1=" + str(back_dest))

            if timer_vis and end_vis and dest_in_card:
                pass_count += 1
                print("ATTEMPT " + str(attempt_num) + ": PASS")
            else:
                fail_notes.append("A" + str(attempt_num) + ": partial timer=" + str(timer_vis))
        else:
            fail_notes.append("A" + str(attempt_num) + ": No end button")

    print("\n=== FINAL SUMMARY ===")
    print("Passed: " + str(pass_count) + "/3")
    for n in fail_notes:
        print("ISSUE: " + n)

