const fs=require('fs'),{PNG}=require('pngjs'),C=require('../core/dbsig-core.js');
const f=process.argv[2], o=JSON.parse(process.argv[3]||'{}');
const img=PNG.sync.read(fs.readFileSync(f)); const t=C.trace(img,o); const {cov,Wp,Hp}=t.debug;
const p=new PNG({width:Wp,height:Hp}); for(let i=0;i<Wp*Hp;i++){const v=cov[i]?30:230;p.data[i*4]=p.data[i*4+1]=p.data[i*4+2]=v;p.data[i*4+3]=255}
fs.writeFileSync('test/out/cov_'+f.split('/').pop(),PNG.sync.write(p));
