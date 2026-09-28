import sys, asyncio
from playwright.async_api import async_playwright
async def main(src, out, w=1400, h=900, full=False):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        msgs=[]
        pg.on('console', lambda m: msgs.append(m.text)); pg.on('pageerror', lambda e: msgs.append('PAGEERROR '+str(e)))
        await pg.goto('file://' + src); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=out, full_page=full)
        for m in msgs: print(m)
        await b.close()
a=sys.argv; asyncio.run(main(a[1], a[2], int(a[3]) if len(a)>3 else 1400, int(a[4]) if len(a)>4 else 900, len(a)>5))
