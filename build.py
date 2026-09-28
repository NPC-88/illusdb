import json, base64, re
core = open('core/dbsig-core.js').read()
names = {'03':['Zeche Zollern','Florianturm','Dortmunder U'],'05':['Semperoper','Frauenkirche','Augustusbrücke'],'07':['Rathaus Duisburg','Salvatorkirche','Schwanentorbrücke'],
 '09':['Schlossturm','Rheinturm','Tonhalle'],'11':['Rathaus Erfurt','Severikirche','Krämerbrücke'],'13':['Marktkirche','Telemax','Neues Rathaus'],'15':['Universität','Brückentor','Alte Brücke']}
ex = json.load(open('data/examples_dp.json'))
refs = []
for k, g in ex.items():
    f, i = k.split('_')
    if f not in names: continue
    W = max(t[0]+t[2] for t in g); H = max(t[1]+t[3] for t in g)
    refs.append({'name': names[f][int(i)], 'W': W, 'H': H, 'b': g})
enc = lambda f: 'data:image/jpeg;base64,' + base64.b64encode(open(f,'rb').read()).decode()
examples = [
  {'photos': [{'photo': enc('data/sample_dom.jpg'), 'crop': {'x':205,'y':64,'w':335,'h':758}, 'role': 'front'}], 'scene': json.load(open('test/scene_dom.json'))},
  {'photos': [{'photo': enc('data/rathaus_a.jpg'), 'crop': {'x':45,'y':22,'w':610,'h':403}, 'role': 'front'},
              {'photo': enc('data/rathaus_b.jpg'), 'crop': {'x':30,'y':5,'w':470,'h':312}, 'role': 'angle', 'caption': 'gables and roof line'},
              {'photo': enc('data/rathaus_c.jpg'), 'crop': {'x':30,'y':10,'w':380,'h':252}, 'role': 'angle', 'caption': 'arcade arches'}], 'scene': json.load(open('test/scene_rathaus.json'))},
]
src = open('web/page.src.html').read()
page = src.replace('/*CORE*/', core).replace('/*EXAMPLES*/[]', json.dumps(examples, ensure_ascii=False)).replace('/*REFS*/null', json.dumps(refs, separators=(',',':'), ensure_ascii=False))
import os
os.makedirs('server/public', exist_ok=True)
open('server/public/index.html','w').write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + page.replace('/*MODE*/', 'server') + '</body></html>')
page = page.replace('/*MODE*/', 'artifact')
open('web/signature-graphics-drafter.html','w').write(page)
# local preview with a proper document wrapper
open('test/out/preview.html','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + page + '</body></html>')
print(len(page))
ui = open('figma/ui.src.html').read().replace('/*CORE*/', core)
open('figma/ui.html','w').write(ui); print('ui', len(ui))
