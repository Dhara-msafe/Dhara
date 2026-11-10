async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    # Step 1: Language screen - select English and continue
    lang_en = page.locator('[data-testid="lang-en"]')
    if await lang_en.is_visible():
        await lang_en.click(force=True)
        await page.wait_for_timeout(300)

    # Find continue on language screen
    lang_confirm = page.locator('[data-testid="lang-confirm"]')
    if await lang_confirm.is_visible():
        await lang_confirm.click(force=True)
        await page.wait_for_timeout(1500)
    else:
        # Try text-based
        cont = page.get_by_text("Continue · जारी रखें")
        if await cont.is_visible():
            await cont.click(force=True)
            await page.wait_for_timeout(1500)
        else:
            # generic continue
            await page.get_by_role("button").first.click(force=True)
            await page.wait_for_timeout(1500)

    print(f"After language: {page.url}")

    # Step 2: Consent screen
    if "consent" in page.url:
        await page.wait_for_timeout(1000)
        # Look for age selection buttons
        all_btns = await page.locator('[role="button"], button, [data-testid]').all()
        for b in all_btns[:10]:
            txt = await b.text_content()
            tid = await b.get_attribute("data-testid")
            print(f"  btn: testid={tid}, text={txt[:30] if txt else ''}")

        # Try scrolling to see the age options
        await page.evaluate("window.scrollTo(0, 500)")
        await page.wait_for_timeout(500)
        await page.screenshot(path="/app/test_reports/automation_output/20261110_112337_84427bd4c5b2/ho_consent.jpeg", type="jpeg", quality=40, full_page=False)

