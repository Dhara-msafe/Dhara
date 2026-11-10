async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    BASE_URL = "https://dhara-shield-2.preview.emergentagent.com"

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
    print("Login: " + page.url)

    pass_count = 0
    fail_notes = []

    for attempt_num in range(1, 4):
        dest = "TEST_QA Dest Attempt" + str(attempt_num)
        print("\n=== ATTEMPT " + str(attempt_num) + " ===")

        # Step 1
        await page.goto(BASE_URL + "/women/head-out/destination")
        await page.wait_for_timeout(3000)  # extra wait for Zustand/nav to settle

        dest_input = page.locator('[data-testid="headout-destination-search"]').first
        dest_vis = await dest_input.is_visible()
        print("Step1 input: " + str(dest_vis))
        if not dest_vis:
            fail_notes.append("Attempt " + str(attempt_num) + ": No dest input")
            continue

        await dest_input.click(force=True)
        await page.wait_for_timeout(300)
        await dest_input.fill(dest)
        await page.wait_for_timeout(800)  # wait for React state to update

        next_btn = page.locator('[data-testid="headout-dest-next"]')
        is_disabled = await next_btn.is_disabled()
        print("Next disabled: " + str(is_disabled))

        if is_disabled:
            fail_notes.append("Attempt " + str(attempt_num) + ": Next still disabled after fill")
            continue

        await next_btn.click(force=True)
        await page.wait_for_timeout(2500)
        print("After Step1: " + page.url)

        # Step 2
        radius_next = page.locator('[data-testid="headout-radius-next"]')
        at_r = await radius_next.is_visible()
        print("At radius: " + str(at_r))
        if not at_r:
            fail_notes.append("Attempt " + str(attempt_num) + ": Radius screen not reached (URL=" + page.url + ")")
            continue

        r200 = page.locator('[data-testid="headout-radius-200"]')
        if await r200.is_visible():
            await r200.click(force=True)
        await radius_next.click(force=True)
        await page.wait_for_timeout(2000)
        print("After Step2: " + page.url)

        # Step 3
        start_btn = page.locator('[data-testid="headout-start-journey"]')
        at_c = await start_btn.is_visible()
        print("At circle: " + str(at_c))
        if not at_c:
            fail_notes.append("Attempt " + str(attempt_num) + ": Circle screen not reached")
            continue

        dur30 = page.locator('[data-testid="headout-circle-dur-30"]')
        if await dur30.is_visible():
            await dur30.click(force=True)
        await start_btn.click(force=True)
        await page.wait_for_timeout(3500)
        print("After Step3 (start): " + page.url)

        # Active screen
        timer = page.locator('[data-testid="headout-timer"]')
        timer_vis = await timer.is_visible()
        timer_text = await timer.text_content() if timer_vis else "N/A"
        print("Timer: vis=" + str(timer_vis) + " val=" + str(timer_text))

        dest_in_card = await page.get_by_text(dest).is_visible()
        print("Dest in card: " + str(dest_in_card))

        # Screenshot active state
        await page.screenshot(path="/app/test_reports/automation_output/20261110_112919_5a33c95fe189/ho_a.jpeg" + str(attempt_num, type="jpeg", quality=40) + ".jpeg", quality=40, full_page=False)

        # End journey
        end_btn = page.locator('[data-testid="headout-end"]')
        end_vis = await end_btn.is_visible()
        print("End btn: " + str(end_vis))

        if not end_vis:
            fail_notes.append("Attempt " + str(attempt_num) + ": No end button")
            continue

        await end_btn.click(force=True)
        await page.wait_for_timeout(3000)
        post_url = page.url
        print("Post-end URL: " + post_url)

        # Check back at Step 1 (no stale redirect)
        back_dest = await page.locator('[data-testid="headout-destination-search"]').first.is_visible()
        print("Back at Step1: " + str(back_dest))

        success = timer_vis and end_vis and dest_in_card
        if success:
            pass_count += 1
            print("PASS")
        else:
            fail_notes.append("Attempt " + str(attempt_num) + ": timer=" + str(timer_vis) + " end=" + str(end_vis) + " dest=" + str(dest_in_card))
            print("FAIL")

    print("\n=== FINAL SUMMARY ===")
    print("Passed: " + str(pass_count) + "/3")
    if fail_notes:
        for n in fail_notes:
            print("FAIL: " + n)
    else:
        print("All 3 attempts PASSED!")

