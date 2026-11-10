async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    # Language screen
    lang_en = page.locator('[data-testid="lang-en"]')
    if await lang_en.is_visible():
        await lang_en.click(force=True)
        await page.wait_for_timeout(300)

    lang_confirm = page.locator('[data-testid="lang-confirm"]')
    if await lang_confirm.is_visible():
        await lang_confirm.click(force=True)
        await page.wait_for_timeout(1500)

    print(f"URL: {page.url}")

    # Consent screen - find all testids
    all_els = await page.locator('[data-testid]').all()
    print("All testids on consent screen:")
    for el in all_els:
        tid = await el.get_attribute("data-testid")
        txt = await el.text_content()
        print(f"  {tid}: {(txt or '')[:40]}")

