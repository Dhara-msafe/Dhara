async def run_test(page, output_dir, page_url):

    await page.set_viewport_size({"width": 390, "height": 844})
    await page.wait_for_timeout(3000)

    # Language screen
    await page.locator('[data-testid="lang-en"]').click(force=True)
    await page.wait_for_timeout(300)
    await page.locator('[data-testid="language-continue"]').click(force=True)
    await page.wait_for_timeout(2000)
    print(f"URL after language: {page.url}")

    # Consent screen - list all testids
    all_els = await page.locator('[data-testid]').all()
    print("All testids on this screen:")
    for el in all_els:
        tid = await el.get_attribute("data-testid")
        print(f"  {tid}")

