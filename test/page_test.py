import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':1000})
        logs=[]; pg.on('console',lambda m:logs.append(m.text)); pg.on('pageerror',lambda e:logs.append('ERR '+str(e)))
        await pg.goto('file:///home/claude/dbsig/test/out/preview.html'); await pg.wait_for_timeout(800)
        await pg.screenshot(path='/home/claude/dbsig/test/out/p1.png', full_page=True)
        # adjust: simplify, rows+1, plinth, mirror, hide a part, hover a part
        await pg.fill('#mSimplify','0.4'); await pg.dispatch_event('#mSimplify','input')
        await pg.click('#rowPlus'); await pg.click('#mPlinth'); await pg.click('#mirSeg button[data-m=left]')
        await pg.click('.part[data-i="10"] input')
        await pg.hover('.part[data-i="5"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/claude/dbsig/test/out/p2.png', full_page=False)
        await pg.set_viewport_size({'width':400,'height':900}); await pg.wait_for_timeout(300)
        w=await pg.evaluate('document.documentElement.scrollWidth'); print('mobile scrollWidth',w)
        print(logs); await b.close()
asyncio.run(main())
