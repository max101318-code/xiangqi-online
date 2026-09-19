const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const ASSETS = {'/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
const TYPES = { K:'帥', A:'仕', B:'相', N:'傌', R:'俥', C:'炮', P:'兵', k:'將', a:'士', b:'象', n:'馬', r:'車', c:'炮', p:'卒' };
const START = [
  ['R',0,0],['N',0,1],['B',0,2],['A',0,3],['K',0,4],['A',0,5],['B',0,6],['N',0,7],['R',0,8],
  ['C',2,1],['C',2,7],['P',3,0],['P',3,2],['P',3,4],['P',3,6],['P',3,8],
  ['r',9,0],['n',9,1],['b',9,2],['a',9,3],['k',9,4],['a',9,5],['b',9,6],['n',9,7],['r',9,8],
  ['c',7,1],['c',7,7],['p',6,0],['p',6,2],['p',6,4],['p',6,6],['p',6,8]
];

function rid(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function pid(){ return crypto.randomBytes(4).toString('hex'); }
function eventId(){ return `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }
function newGame(){
  const b=Array.from({length:10},()=>Array(9).fill(null));
  for(const [t,r,c] of START)b[r][c]={t,id:crypto.randomBytes(3).toString('hex')};
  return {b,turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1};
}
function own(t,color){ return color==='red' ? /[A-Z]/.test(t) : /[a-z]/.test(t); }
function inside(r,c){ return r>=0&&r<10&&c>=0&&c<9; }
function palace(r,c,color){ return c>=3&&c<=5&&(color==='red'?r<=2:r>=7); }
function clearCount(b,r1,c1,r2,c2){
  const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1); let n=0,r=r1+dr,c=c1+dc;
  while(r!==r2||c!==c2){if(b[r][c])n++;r+=dr;c+=dc;} return n;
}
function legal(g,p,r1,c1,r2,c2){
  if(!inside(r1,c1)||!inside(r2,c2))return'座標超出棋盤';
  const a=g.b[r1][c1],d=g.b[r2][c2];
  if(!a)return'起點沒有棋子';
  if(!own(a.t,p.color))return'只能移動自己的棋子';
  if(d&&own(d.t,p.color))return'目標已有己方棋子';
  const t=a.t.toLowerCase(),R=r2-r1,C=c2-c1,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k'){
    if(ar+ac!==1||!palace(r2,c2,p.color))return'將／帥只能在己方九宮內直走一格';
  } else if(t==='a'){
    if(ar!==1||ac!==1||!palace(r2,c2,p.color))return'士／仕只能在己方九宮內斜走一格';
  } else if(t==='b'){
    if(ar!==2||ac!==2)return'象／相必須斜走兩格';
    if((p.color==='red'&&r2>4)||(p.color==='black'&&r2<5))return'象／相不能過河';
    if(g.b[r1+R/2][c1+C/2])return'象眼被堵';
  } else if(t==='n'){
    if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return'馬／傌必須走日字';
    const lr=r1+(ar===2?Math.sign(R):0),lc=c1+(ac===2?Math.sign(C):0);
    if(g.b[lr][lc])return'馬腿被堵';
  } else if(t==='r'){
    if(!(R===0||C===0)||clearCount(g.b,r1,c1,r2,c2)!==0)return'車／俥只能直線走且不能越子';
  } else if(t==='c'){
    if(!(R===0||C===0))return'炮必須直線移動';
    const n=clearCount(g.b,r1,c1,r2,c2);
    if(d&&n!==1)return'炮吃子時中間必須恰好一枚炮架';
    if(!d&&n!==0)return'炮移動到空位時不能隔子';
  } else if(t==='p'){
    const f=p.color==='red'?1:-1;
    const crossed=p.color==='red'?r1>=5:r1<=4;
    if(R===f&&C===0){}
    else if(!(crossed&&R===0&&ac===1))return'兵／卒只能向前；過河後才能左右走一格，不能後退';
  }
  return null;
}

function findKing(g,color){
  const kt=color==='red'?'K':'k';
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]?.t===kt)return[r,c];
  return null;
}
function isAttacked(g,attackerColor,targetR,targetC){
  const fake={color:attackerColor};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){
    if(!g.b[r][c]||!own(g.b[r][c].t,attackerColor))continue;
    if(!legal(g,fake,r,c,targetR,targetC))return true;
  }
  return false;
}
function checkTargets(g,byColor){
  const target=byColor==='red'?'black':'red';
  const k=findKing(g,target);
  return k&&isAttacked(g,byColor,k[0],k[1]) ? [target] : [];
}

function playerList(x){ return x.players.map(p=>({name:p.name,color:p.color||null})).concat(x.ai?[{name:'電腦',color:'black'}]:[]); }
function snapshot(x,p){
  const rps=x.rps ? {
    phase:x.rps.phase,
    result:x.rps.result||null,
    winnerPid:x.rps.winnerPid||null,
    isRpsWinner:x.rps.winnerPid===p.pid,
    youChoice:x.rps.choices?.[p.pid]||null,
    hasOpponentChoice:x.players.some(q=>q.pid!==p.pid&&x.rps.choices?.[q.pid])
  }:null;
  return {
    type:'state', roomId:x.ai?null:x.id,color:p.color||null,turn:x.g.turn,winner:x.g.winner,winnerPid:x.g.winnerPid||null,
    endedReason:x.g.endedReason||null,board:x.g.b,history:x.g.history,move:x.g.move,players:playerList(x),mode:x.ai?'ai':'online',difficulty:x.difficulty||null,
    rps,checkEvent:x.checkEvent||null,
    rematch:{pendingForMe:!!x.rematchInvite&&x.rematchInvite.toPid===p.pid,pendingByMe:!!x.rematchInvite&&x.rematchInvite.fromPid===p.pid}
  };
}
function send(p,o){ if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(o)); }
function broadcast(x){ x.players.forEach(p=>send(p,snapshot(x,p))); }
function resetOnlineRound(x){
  x.g=newGame();
  x.players.forEach(p=>p.color=null);
  x.rps={phase:'rps',choices:{},result:'下一場開始：請重新猜拳決定先手。',winnerPid:null};
  x.rematchInvite=null;
  x.checkEvent=null;
}

function resolveRps(x){
  if(!x.rps||x.rps.phase!=='rps'||x.players.length<2)return;
  const a=x.players[0],b=x.players[1],ca=x.rps.choices[a.pid],cb=x.rps.choices[b.pid];
  if(!ca||!cb)return;
  if(ca===cb){
    x.g.turn=null;
    x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};
    return broadcast(x);
  }
  const beats={剪刀:'布',布:'石頭',石頭:'剪刀'};
  const winner=beats[ca]===cb?a:b;
  x.rps={phase:'choose-color',choices:{},result:`${winner.name} 猜拳獲勝！請選擇紅方或黑方。`,winnerPid:winner.pid};
  x.g.turn=null;
  broadcast(x);
}
function chooseColor(x,p,color){
  if(!x.rps||x.rps.phase!=='choose-color')return'目前不是選擇象棋顏色的階段';
  if(x.rps.winnerPid!==p.pid)return'你不是猜拳獲勝者，請等待對方選擇象棋顏色';
  if(color!=='red'&&color!=='black')return'顏色只能選紅方或黑方';
  const loser=x.players.find(q=>q.pid!==p.pid);
  p.color=color; loser.color=color==='red'?'black':'red';
  x.g.turn=p.color;
  x.rps={phase:'done',choices:{},result:`${p.name} 選擇${color==='red'?'紅方':'黑方'}，猜拳獲勝者先手。`,winnerPid:p.pid};
  return null;
}
function applyMove(x,p,m){
  const g=x.g;
  if(!x.ai&&x.rps?.phase!=='done')return{error:'請先完成猜拳與象棋顏色選擇，現在還不能走棋'};
  if(!g.turn)return{error:'等待另一位玩家加入'};
  if(g.winner)return{error:'遊戲已結束'};
  if(g.turn!==p.color)return{error:'還沒輪到你'};
  const r1=Number(m.r1),c1=Number(m.c1),r2=Number(m.r2),c2=Number(m.c2),err=legal(g,p,r1,c1,r2,c2);
  if(err)return{error:err};
  const src=g.b[r1][c1],dst=g.b[r2][c2];
  g.b[r2][c2]=src;g.b[r1][c1]=null;
  g.history.push({n:g.move,color:p.color,piece:TYPES[src.t],from:[r1+1,c1+1],to:[r2+1,c2+1],captured:dst?TYPES[dst.t]:null});
  g.move++;
  if(dst&&dst.t.toLowerCase()==='k'){
    g.winner=p.color;g.winnerPid=p.pid;g.endedReason=`${p.color==='red'?'紅方':'黑方'}直接吃掉${p.color==='red'?'黑將':'紅帥'}，獲勝！`;
    x.checkEvent=null;
  } else {
    x.checkEvent=null;
    const checks=checkTargets(g,p.color);
    if(checks.length)x.checkEvent={id:eventId(),by:p.color,target:checks[0]};
    g.turn=p.color==='red'?'black':'red';
  }
  return{ok:true};
}

function scoreMove(g,m,level){
  const v={p:100,n:320,b:330,a:200,r:900,c:500,k:10000};const dst=g.b[m.r2][m.c2];let s=0;
  if(dst)s+=(dst.t===dst.t.toLowerCase()?v[dst.t.toLowerCase()]||100:0);
  if(m.r2<=2)s+=120;if(m.c2>=3&&m.c2<=5)s+=20;if(level==='hard'){
    const next={...g,b:g.b.map(row=>row.slice())};next.b[m.r2][m.c2]=next.b[m.r1][m.c1];next.b[m.r1][m.c1]=null;
    if(dst&&dst.t==='K')s+=100000;const k=findKing(next,'red');if(k&&isAttacked(next,'black',k[0],k[1]))s+=250;
  }
  return s;
}
function aiTurn(x){
  if(!x.ai||x.g.winner||x.g.turn!=='black')return;
  const level=x.difficulty||'normal',moves=[],p={color:'black'};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(x.g.b[r][c]&&own(x.g.b[r][c].t,'black'))
    for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!legal(x.g,p,r,c,rr,cc))moves.push({r1:r,c1:c,r2:rr,c2:cc});
  if(!moves.length){x.g.winner='red';x.g.endedReason='電腦無法行棋，你獲勝！';return broadcast(x);}
  let choice;
  if(level==='easy')choice=moves[Math.floor(Math.random()*moves.length)];
  else {const ranked=moves.map(m=>({...m,score:scoreMove(x.g,m,level)})).sort((a,b)=>b.score-a.score);const pool=level==='hard'?ranked.slice(0,Math.min(3,ranked.length)):ranked.slice(0,Math.min(6,ranked.length));choice=pool[Math.floor(Math.random()*pool.length)];}
  const result=applyMove(x,p,choice);if(result.ok)broadcast(x);
}

const server=http.createServer((req,res)=>{
  let u=req.url.split('?')[0];
  if(u==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end('ok');}
  if(u==='/')u='/index.html';
  const fileName=ASSETS[u];
  if(!fileName){res.writeHead(404);return res.end('404');}
  const f=path.join(__dirname,fileName);
  if(!fs.existsSync(f)){res.writeHead(404);return res.end('404');}
  const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'}[path.extname(f)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});fs.createReadStream(f).pipe(res);
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  let x=null,p=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(m.action==='create'){
      x={id:rid(),players:[],g:newGame(),ai:false,rps:{phase:'rps',choices:{},result:null,winnerPid:null},rematchInvite:null,checkEvent:null};rooms.set(x.id,x);
      p={ws,pid:pid(),name:String(m.name||'玩家1').slice(0,12),color:null};x.players.push(p);send(p,{type:'room',roomId:x.id,color:null,mode:'online'});
    } else if(m.action==='ai'){
      const difficulty=['easy','normal','hard'].includes(m.difficulty)?m.difficulty:'normal';
      x={id:rid(),players:[],g:newGame(),ai:true,difficulty,checkEvent:null};rooms.set(x.id,x);x.g.turn='red';
      p={ws,pid:pid(),name:String(m.name||'玩家1').slice(0,12),color:'red'};x.players.push(p);send(p,{type:'room',roomId:null,color:'red',mode:'ai'});send(p,snapshot(x,p));
    } else if(m.action==='join'){
      x=rooms.get(String(m.roomId||'').toUpperCase());
      if(!x||x.ai||x.players.length>=2)return send({ws},{type:'error',message:'房間不存在、已滿，或這是人機房間'});
      p={ws,pid:pid(),name:String(m.name||'玩家2').slice(0,12),color:null};x.players.push(p);broadcast(x);
    } else if(m.action==='rps'&&x&&p&&!x.ai){
      if(x.players.length<2)return send(p,{type:'error',message:'請等待另一位玩家加入'});
      if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不能重新猜拳'});
      if(!['剪刀','布','石頭'].includes(m.choice))return send(p,{type:'error',message:'猜拳只能選剪刀、布或石頭'});
      if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你這一輪已經出拳，請等待結果'});
      x.rps.choices[p.pid]=m.choice;if(x.players.every(q=>x.rps.choices[q.pid]))resolveRps(x);else broadcast(x);
    } else if(m.action==='chooseColor'&&x&&p&&!x.ai){
      const e=chooseColor(x,p,m.color);if(e)send(p,{type:'error',message:e});else{ x.checkEvent=null;x.players.forEach(q=>send(q,snapshot(x,q))); }
    } else if(m.action==='move'&&x&&p){
      const result=applyMove(x,p,m);if(result.error)send(p,{type:'error',message:result.error});else{
        broadcast(x);
        if(x.ai&&x.g.turn==='black'&&!x.g.winner)setTimeout(()=>{ x.checkEvent=null;aiTurn(x); },450);
      }
    } else if(m.action==='inviteRematch'&&x&&p&&!x.ai){
      if(x.players.length<2||!x.g.winner)return send(p,{type:'error',message:'目前還不能邀請再戰'});
      if(x.rematchInvite)return send(p,{type:'error',message:'已經有一個再戰邀請正在等待回覆'});
      const other=x.players.find(q=>q.pid!==p.pid);x.rematchInvite={fromPid:p.pid,toPid:other.pid};
      send(other,{type:'rematch-invite',fromName:p.name});broadcast(x);
    } else if(m.action==='rematchResponse'&&x&&p&&!x.ai){
      const inv=x.rematchInvite;if(!inv||inv.toPid!==p.pid)return send(p,{type:'error',message:'沒有等待中的再戰邀請'});
      const inviter=x.players.find(q=>q.pid===inv.fromPid);
      if(m.accept){resetOnlineRound(x);broadcast(x);}
      else{x.rematchInvite=null;if(inviter)send(inviter,{type:'notice',message:`${p.name} 暫時不進行下一場。`});broadcast(x);}
    } else if(m.action==='aiRematch'&&x&&p&&x.ai){
      x.g=newGame();x.g.turn='red';x.checkEvent=null;x.g.winner=null;x.g.endedReason=null;send(p,snapshot(x,p));
    }
  });
  ws.on('close',()=>{
    if(!x||!p)return;
    const wasOnline=!x.ai,hadTwo=x.players.length===2;
    x.players=x.players.filter(q=>q!==p);
    if(!x.players.length){rooms.delete(x.id);return;}
    if(wasOnline&&hadTwo){
      const survivor=x.players[0];survivor.color=survivor.color||'red';x.g.winner=survivor.color;x.g.winnerPid=survivor.pid;x.g.endedReason='對方已斷線，你方獲勝！';x.rematchInvite=null;x.rps={phase:'done',choices:{},result:null,winnerPid:null};broadcast(x);
    } else broadcast(x);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('Xiangqi online on '+PORT));
