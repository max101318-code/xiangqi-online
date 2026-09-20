const {spawn}=require('child_process');
const WebSocket=require('ws');
const assert=require('assert');
const PORT=18997;
const srv=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
let logs='';srv.stdout.on('data',d=>logs+=d);srv.stderr.on('data',d=>logs+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function client(){return new WebSocket(`ws://127.0.0.1:${PORT}`)}
function next(ws,pred,timeout=4000){return new Promise((res,rej)=>{const t=setTimeout(()=>{ws.off('message',on);rej(new Error('timeout waiting for message'))},timeout);function on(raw){let m;try{m=JSON.parse(raw)}catch{return}if(pred(m)){clearTimeout(t);ws.off('message',on);res(m)}}ws.on('message',on)})}
async function send(ws,obj){ws.send(JSON.stringify(obj));}
(async()=>{
 try{
  await wait(350);
  // 3-player checkers: full board, RPS ranking then color selection.
  const a=client(),b=client(),c=client();
  await Promise.all([new Promise(r=>a.once('open',r)),new Promise(r=>b.once('open',r)),new Promise(r=>c.once('open',r))]);
  await send(a,{action:'create',mode:'checkers',playerCount:3,name:'A',avatar:'🧑🏻',profileId:'A'});
  const ra=await next(a,m=>m.type==='room'); const room=ra.roomId||ra.spectatorCode;
  await send(b,{action:'join',roomId:room,name:'B',avatar:'🧑🏼',profileId:'B'}); await next(b,m=>m.type==='room');
  await send(c,{action:'join',roomId:room,name:'C',avatar:'🧑🏽',profileId:'C'}); await next(c,m=>m.type==='room');
  await wait(100);
  // RPS round 1: B and C beat A -> B/C tie for first, A third.
  await Promise.all([send(a,{action:'rps',choice:'剪刀'}),send(b,{action:'rps',choice:'石頭'}),send(c,{action:'rps',choice:'石頭'})]);
  await wait(100);
  await Promise.all([send(b,{action:'rps',choice:'石頭'}),send(c,{action:'rps',choice:'剪刀'})]);
  const s1=await next(a,m=>m.type==='state'&&m.rps?.phase==='choose-color');
  assert.equal(s1.rps.rankOrder.length,3); assert.equal(s1.rps.colorTurnPid,s1.rps.rankOrder[0]);
  const rank=s1.rps.rankOrder;
  // first pick red, second pick blue, third gets green automatically
  const firstWs=[a,b,c].find(ws=>ws===a&&rank[0]===s1.players?.find(p=>p.name==='A')?.pid)||null;
  // Use players array to map pid->ws
  const states=[s1, await next(b,m=>m.type==='state'&&m.rps?.phase==='choose-color'), await next(c,m=>m.type==='state'&&m.rps?.phase==='choose-color')];
  const pidByName={};const wsByPid={};for(const st of states){for(const p of st.players){pidByName[p.name]=p.pid;}}
  wsByPid[pidByName.A]=a;wsByPid[pidByName.B]=b;wsByPid[pidByName.C]=c;
  const c1=wsByPid[rank[0]]; await send(c1,{action:'chooseColor',color:'red'});
  const st2=await next(a,m=>m.type==='state'&&m.rps?.phase==='choose-color');
  const p2=st2.rps.rankOrder[1]; await send(wsByPid[p2],{action:'chooseColor',color:'blue'});
  const final=await next(a,m=>m.type==='state'&&m.started===true&&m.rps?.phase==='choose-color');
  assert.equal(final.players.filter(p=>p.color).length,3);
  assert.deepEqual(new Set(final.players.map(p=>p.color)),new Set(['red','blue','green']));
  const boardVals=Object.values(final.board||{});assert.equal(boardVals.length,30,'3-player checker should have 30 starting stones');
  [a,b,c].forEach(ws=>ws.close());

  // 2-player banqi: every cell is a covered circular piece in state.
  const d=client(),e=client(); await Promise.all([new Promise(r=>d.once('open',r)),new Promise(r=>e.once('open',r))]);
  await send(d,{action:'create',mode:'banqi',name:'D',avatar:'🧑🏻'}); const rd=await next(d,m=>m.type==='room'); const r2=rd.roomId;
  await send(e,{action:'join',roomId:r2,name:'E',avatar:'🧑🏼'}); await next(e,m=>m.type==='room');
  const sd=await next(d,m=>m.type==='state'&&m.gameMode==='banqi'&&Array.isArray(m.board));
  assert.equal(sd.board.flat().filter(Boolean).length,32,'banqi should show all 32 covered pieces');
  assert(sd.board.flat().filter(Boolean).every(p=>p.revealed===false),'banqi should begin fully covered');
  d.close();e.close();
  console.log('v3.4 regression tests passed');
 }catch(err){console.error(err);console.error(logs);process.exitCode=1}
 finally{srv.kill()}
})();
