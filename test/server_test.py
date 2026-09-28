import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':1000})
        logs=[]; pg.on('pageerror',lambda e:logs.append('ERR '+str(e)))
        await pg.goto('http://localhost:3100/'); await pg.fill('#pw','db-team'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('#aRun'); await pg.wait_for_timeout(1200)
        print('state:', await pg.inner_text('#claudeState'))
        await pg.fill('#landmark','Kölner Dom'); await pg.click('#aRun'); await pg.wait_for_timeout(2500)
        print('title:', await pg.inner_text('#resTitle'), '| msg:', await pg.inner_text('#aMsg'))
        print('mock saw:', open('/tmp/mock_last.json').read())
        # revise
        await pg.fill('#aFeedback','taller'); await pg.click('#aRevise'); await pg.wait_for_timeout(1500)
        # download
        async with pg.expect_download() as dl: await pg.click('#aSave')
        d=await dl.value; print('download:', d.suggested_filename)
        await pg.screenshot(path='out/server_page.png')
        print(logs); await b.close()
asyncio.run(main())
