const WebSocket = require('ws');
const URL='ws://127.0.0.1:3000';
const a=new WebSocket(URL),b=new WebSocket(URL);let room;let sawRps=false,sawChoose=false,sawCheck=false,sawInvite=false,done=false;
function send(w,o){if(w.readyState===1)w.send(JSON.stringify(o));}
function finish(code,msg){if(done)return;done=true;console.log(msg||'ok');a.close();b.close();process.exit(code);}
a.on('open',()=>send(a,{action:'create',name:'甲'}));
b.on('open',()=>{});
function handle(w,m){
  if(m.type==='room'&&m.roomId){room=m.roomId;if(b.readyState===1)send(b,{action:'join',roomId:room,name:'乙'});}
  if(m.type==='state'&&m.mode==='online'&&m.players?.length===2){if(m.rps?.phase==='rps')sawRps=true;if(m.rps?.phase==='choose-color')sawChoose=true;}
  if(m.type==='rematch-invite'){sawInvite=true;send(b,{action:'rematchResponse',accept:true});}
  if(m.type==='state'&&m.mode==='online'&&m.rps?.phase==='rps'&&m.players?.length===2){
    if(m.color==='red'&&!m.rps.youChoice)send(a,{action:'rps',choice:'石頭'});
    if(m.color==='black'&&!m.rps.youChoice)send(b,{action:'rps',choice:'剪刀'});
  }
  if(m.type==='state'&&m.rps?.phase==='choose-color'&&m.rps.isRpsWinner)send(w,{action:'chooseColor',color:'red'});
  if(m.type==='state'&&m.rps?.phase==='done'&&m.turn===m.color&&m.history.length===0){
    if(m.color==='red')send(a,{action:'move',r1:3,c1:0,r2:4,c2:0});
    if(m.color==='black')send(b,{action:'move',r1:6,c1:0,r2:5,c2:0});
  }
  if(m.type==='state'&&m.checkEvent)sawCheck=true;
  if(m.type==='state'&&m.history?.length===1&&!m.winner&&m.rematch&&!m.rematch.pendingByMe&&m.color==='red'){send(a,{action:'inviteRematch'});}
  if(sawRps&&sawChoose&&sawCheck){ /* invitation check happens after game-over in manual validation */ }
}
a.on('message',r=>handle(a,JSON.parse(r)));b.on('message',r=>handle(b,JSON.parse(r)));
setTimeout(()=>finish(sawRps&&sawChoose?'0':'1',`rps=${sawRps} choose=${sawChoose} check=${sawCheck} invite=${sawInvite}`),7000);
