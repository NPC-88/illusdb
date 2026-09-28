import asyncio, json
from playwright.async_api import async_playwright
scene=json.load(open('/home/claude/dbsig/test/scene_dom.json'))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':440,'height':1300})
        logs=[]; pg.on('console',lambda m:logs.append(m.text)); pg.on('pageerror',lambda e:logs.append('ERR '+str(e)))
        last={}
        async def handle(route):
            last['body']=route.request.post_data or ''
            await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin':'*'}, body=json.dumps({'content':[{'type':'text','text':'Here is the plan:\n'+json.dumps(scene)}]}))
        await pg.route('https://api.anthropic.com/**', handle)
        await pg.goto('file:///home/claude/dbsig/figma/ui.html')
        await pg.evaluate("window.postMessage({pluginMessage:{type:'settings',hasKey:true,key:'test',model:''}},'*')")
        await pg.set_input_files('#file','/home/claude/dbsig/data/sample_dom.jpg')
        await pg.wait_for_timeout(800)
        await pg.click('#aRun'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='/home/claude/dbsig/test/out/figma_a.png', full_page=True)
        await pg.fill('#mSimplify','0.5'); await pg.dispatch_event('#mSimplify','input')
        await pg.click('#rowPlus'); await pg.click('#mirSeg button[data-m=left]'); await pg.click('#parts input[data-i="10"]')
        await pg.fill('#aFeedback','spires taller'); await pg.click('#aRevise'); await pg.wait_for_timeout(800)
        print('revise body has baked render:', 'render' in last['body'])
        await pg.fill('#mOpen','1.4'); await pg.dispatch_event('#mOpen','input'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/claude/dbsig/test/out/figma_b.png', full_page=True)
        print(logs); await b.close()
asyncio.run(main())
