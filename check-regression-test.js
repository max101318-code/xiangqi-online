const http=require('http'), fs=require('fs'), path=require('path'), {spawn}=require('child_process');
const {WebSocket}=require('ws');
const port=34891;
const child=spawn(process.execPath,[path.join(__dirname,'server.js')],{env:{...process.env,PORT:String(port)}});
let ok=false;
const cleanup=()=>{try{child.kill()}catch{}};
setTimeout(()=>{
  const a=new WebSocket(`ws://127.0.0.1:${port}`), b=new WebSocket(`ws://127.0.0.1:${port}`);
  let room, states=0;
  const send=(w,o)=>w.send(JSON.stringify(o));
  a.on('open',()=>send(a,{action:'create',name:'A',avatar:'🤖'}));
  a.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='room'&&m.roomId){room=m.roomId; setTimeout(()=>send(b,{action:'join',roomId:room,name:'B',avatar:'🐼'}),100);}
    if(m.type==='state'&&m.rps?.phase==='rps'&&m.players?.length===2&&states++<2){
      // Only verify that no check event is produced merely by lobby/rps state.
      if(m.checkEvent) throw new Error('checkEvent appeared before any move');
      if(states===2){
        ok=true; a.close(); b.close(); cleanup(); console.log('check regression smoke: OK');
      }
    }
  });
  b.on('message',()=>{});
},500);
setTimeout(()=>{if(!ok){cleanup();console.error('check regression smoke: timeout');process.exit(1)}},5000);
