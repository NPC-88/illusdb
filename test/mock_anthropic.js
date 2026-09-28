const http=require('http'),fs=require('fs');
const scene=JSON.parse(fs.readFileSync(__dirname+'/scene_dom.json'));
http.createServer((req,res)=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>{
  const b=JSON.parse(d); const c=b.messages[0].content;
  const info={stream:!!b.stream,maxTokens:b.max_tokens,key:req.headers['x-api-key'],model:b.model,hasImage:c.some(x=>x.type==='image'),nImages:c.filter(x=>x.type==='image').length,labels:c.filter(x=>x.type==='text'&&x.text.length<40).map(x=>x.text),multi:c.find(x=>x.type==='text'&&x.text.length>1000).text.includes('photos of the SAME landmark'),imgBytes:(c.find(x=>x.type==='image')||{source:{data:''}}).source.data.length,hasSketch:c.filter(x=>x.type==='text').pop().text.includes('SKETCH'),hasFeatures:c.filter(x=>x.type==='text').pop().text.includes('Measured on the photo'),photoLines:(c.filter(x=>x.type==='text').pop().text.match(/^- Photo \d.*$/gm)||[]),promptChars:c.filter(x=>x.type==='text').pop().text.length,injected:JSON.stringify(b).includes('IGNORE PREVIOUS'),lm:/Landmark: (.*)/.exec(c.filter(x=>x.type==='text').pop().text)?.[1]};
  fs.writeFileSync('/tmp/mock_last.json',JSON.stringify(info));
  let text='Plan:\n```json\n'+JSON.stringify({...scene,landmark:'Server draft: '+(info.lm||'?')})+'\n```', stop='end_turn';
  if(info.lm==='CUTOFF'){ text=text.slice(0,400); stop='max_tokens'; }
  if(!b.stream){ res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify({content:[{type:'text',text}],stop_reason:stop,usage:{input_tokens:2100,output_tokens:900}})); }
  res.writeHead(200,{'content-type':'text/event-stream'}); const ev=(o)=>res.write('event: '+o.type+'\ndata: '+JSON.stringify(o)+'\n\n');
  ev({type:'message_start',message:{usage:{input_tokens:2100,output_tokens:1}}});
  ev({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}); ev({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:''}}); ev({type:'content_block_stop',index:0});
  ev({type:'content_block_start',index:1,content_block:{type:'text',text:''}});
  for(let i=0;i<text.length;i+=97) ev({type:'content_block_delta',index:1,delta:{type:'text_delta',text:text.slice(i,i+97)}});
  ev({type:'content_block_stop',index:1}); ev({type:'message_delta',delta:{stop_reason:stop},usage:{output_tokens:900}}); ev({type:'message_stop'}); res.end();});}).listen(4010);
