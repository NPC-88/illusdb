const http=require('http'),fs=require('fs');
const scene=JSON.parse(fs.readFileSync(__dirname+'/scene_dom.json'));
http.createServer((req,res)=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>{
  const b=JSON.parse(d); const c=b.messages[0].content;
  const info={key:req.headers['x-api-key'],model:b.model,hasImage:c.some(x=>x.type==='image'),nImages:c.filter(x=>x.type==='image').length,labels:c.filter(x=>x.type==='text'&&x.text.length<40).map(x=>x.text),multi:c.find(x=>x.type==='text'&&x.text.length>1000).text.includes('photos of the SAME landmark'),imgBytes:(c.find(x=>x.type==='image')||{source:{data:''}}).source.data.length,hasSketch:c.filter(x=>x.type==='text').pop().text.includes('SKETCH'),lm:/Landmark: (.*)/.exec(c.filter(x=>x.type==='text').pop().text)?.[1]};
  fs.writeFileSync('/tmp/mock_last.json',JSON.stringify(info));
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({content:[{type:'text',text:'Plan:\n```json\n'+JSON.stringify({...scene,landmark:'Server draft: '+(info.lm||'?')})+'\n```'}],usage:{input_tokens:2100,output_tokens:900}}));});}).listen(4010);
