const WebSocket = require('ws');
const a = new WebSocket('ws://127.0.0.1:3000');
const b = new WebSocket('ws://127.0.0.1:3000');
let room=null, states=[], moved=false;
function send(ws,x){ws.send(JSON.stringify(x));}
function handle(ws,m){
  if(m.type==='room'){room=m.roomId; if(b.readyState===1)send(b,{action:'join',roomId:room,name:'黑方'});}
  if(m.type==='state'){states.push({color:m.color,turn:m.turn,rps:m.rps}); if(m.players.length===2&&!m.turn){send(ws,{action:'rps',choice:m.color==='red'?'石頭':'剪刀'});}}
  if(m.type==='state'&&m.turn&&m.color===m.turn&&!moved){moved=true;send(ws,{action:'move',r1:m.color==='red'?3:6,c1:0,r2:m.color==='red'?4:5,c2:0});}
  if(m.type==='state'&&m.history&&m.history.length===1){const colors=states.map(s=>s.color);console.log(`colors=${colors.join(',')} turn=${m.turn} history=${m.history.length}`);process.exit(colors.includes('red')&&colors.includes('black')?0:1);}
}
a.on('open',()=>send(a,{action:'create',name:'紅方'}));b.on('open',()=>{if(room)send(b,{action:'join',roomId:room,name:'黑方'});});a.on('message',r=>handle(a,JSON.parse(r)));b.on('message',r=>handle(b,JSON.parse(r)));
setTimeout(()=>{console.error('timeout',states);process.exit(1)},5000);
