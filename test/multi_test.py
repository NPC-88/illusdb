import asyncio, json
from playwright.async_api import async_playwright
P='/home/claude/dbsig/data/photos/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':1100})
        logs=[]; pg.on('pageerror',lambda e:logs.append('ERR '+str(e)))
        await pg.goto('http://localhost:3100/'); await pg.fill('#pw','db-team'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('#aRun'); await pg.wait_for_timeout(1000)
        await pg.set_input_files('#file',[P+'user_2.png',P+'user_4.png',P+'09_0.png'])
        await pg.wait_for_timeout(1500)
        print('thumbs:', await pg.locator('.thumb').count(), '| tag:', await pg.inner_text('#skTag'))
        # go to photo 1, pick sky + building, contrast
        await pg.click('.thumb[data-i="0"]'); await pg.wait_for_timeout(300)
        await pg.click('#toolSeg button[data-t=sky]')
        box=await pg.locator('#photo').bounding_box()
        await pg.mouse.click(box['x']+box['width']*0.1, box['y']+box['height']*0.05)
        await pg.click('#toolSeg button[data-t=build]')
        await pg.mouse.click(box['x']+box['width']*0.5, box['y']+box['height']*0.6)
        await pg.fill('#skCon','0.7'); await pg.dispatch_event('#skCon','input'); await pg.wait_for_timeout(500)
        await pg.fill('#landmark','Bremer Rathaus'); await pg.click('#aRun'); await pg.wait_for_timeout(3000)
        print('mock saw:', open('/tmp/mock_last.json').read())
        print('title:', await pg.inner_text('#resTitle'), '| msg:', await pg.inner_text('#aMsg'))
        el=await pg.query_selector('.a-in'); await el.screenshot(path='out/multi_in.png')
        print(logs); await b.close()
asyncio.run(main())
