const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;
const rooms = new Map();
const pub = path.join(__dirname, 'public');

const TYPES = { K:'帥', A:'仕', B:'相', N:'傌', R:'俥', C:'炮', P:'兵', k:'將', a:'士', b:'象', n:'馬', r:'車', c:'炮', p:'卒' };
const START = [
  ['R',0,0],['N',0,1],['B',0,2],['A',0,3],['K',0,4],['A',0,5],['B',0,6],['N',0,7],['R',0,8],
  ['C',2,1],['C',2,7],['P',3,0],['P',3,2],['P',3,4],['P',3,6],['P',3,8],
  ['r',9,0],['n',9,1],['b',9,2],['a',9,3],['k',9,4],['a',9,5],['b',9,6],['n',9,7],['r',9,8],
  ['c',7,1],['c',7,7],['p',6,0],['p',6,2],['p',6,4],['p',6,6],['p',6,8]
];
const BEATS = {剪刀:'布',布:'石頭',石頭:'剪刀'};
const AVATARS = ['🧑🏻','🧑🏼','🧑🏽','🧑🏾','🧑🏿','🐱','🐼','🦊','🐯','🐸','🤖','👾','🦄','🐲','😎','🥷'];
function normalizeAvatar(value){
  const v=String(value||'');
  if(AVATARS.includes(v)) return v;
  if(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length<=350000) return v;
  return '🧑🏻';
}

const clone = v => JSON.parse(JSON.stringify(v));
const rid = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const pid = () => crypto.randomBytes(5).toString('hex');
const eventId = () => `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

function newGame(){
  const b = Array.from({length:10},()=>Array(9).fill(null));
  for(const [t,r,c] of START) b[r][c] = {t,id:crypto.randomBytes(4).toString('hex')};
  return {b,turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId()};
}
function newRps(){ return {phase:'rps',choices:{},result:null,winnerPid:null}; }
function own(t,color){ return color==='red' ? /[A-Z]/.test(t) : /[a-z]/.test(t); }
function inside(r,c){ return r>=0&&r<10&&c>=0&&c<9; }
function palace(r,c,color){ return c>=3&&c<=5&&(color==='red'?r<=2:r>=7); }
function clearCount(b,r1,c1,r2,c2){
  const dr=Math.sign(r2-r1), dc=Math.sign(c2-c1); let n=0,r=r1+dr,c=c1+dc;
  while(r!==r2||c!==c2){ if(b[r][c]) n++; r+=dr; c+=dc; }
  return n;
}
function legal(g,p,r1,c1,r2,c2){
  if(!inside(r1,c1)||!inside(r2,c2)) return '座標超出棋盤';
  const a=g.b[r1][c1],d=g.b[r2][c2];
  if(!a) return '起點沒有棋子';
  if(!own(a.t,p.color)) return '只能移動自己的棋子';
  if(d&&own(d.t,p.color)) return '目標已有己方棋子';
  const t=a.t.toLowerCase(),R=r2-r1,C=c2-c1,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k'){
    const facingCapture=d&&d.t.toLowerCase()==='k'&&C===0&&clearCount(g.b,r1,c1,r2,c2)===0;
    if(!facingCapture && !(ar+ac===1&&palace(r2,c2,p.color))) return '將／帥只能在己方九宮內直走一格；面對對方將／帥且中間無子時，可像車一樣直接吃將／帥';
  } else if(t==='a'){
    if(!(ar===1&&ac===1&&palace(r2,c2,p.color))) return '士／仕只能在己方九宮內斜走一格';
  } else if(t==='b'){
    if(!(ar===2&&ac===2)) return '象／相必須斜走兩格';
    if((p.color==='red'&&r2>4)||(p.color==='black'&&r2<5)) return '象／相不能過河';
    if(g.b[r1+R/2][c1+C/2]) return '象眼被堵';
  } else if(t==='n'){
    if(!((ar===2&&ac===1)||(ar===1&&ac===2))) return '馬／傌必須走日字';
    const lr=r1+(ar===2?Math.sign(R):0), lc=c1+(ac===2?Math.sign(C):0);
    if(g.b[lr][lc]) return '馬腿被堵';
  } else if(t==='r'){
    if(!(R===0||C===0)||clearCount(g.b,r1,c1,r2,c2)!==0) return '車／俥只能直線走且不能越子';
  } else if(t==='c'){
    if(!(R===0||C===0)) return '炮必須直線移動';
    const n=clearCount(g.b,r1,c1,r2,c2);
    if(d&&n!==1) return '炮吃子時中間必須恰好一枚炮架';
    if(!d&&n!==0) return '炮移動到空位時不能隔子';
  } else if(t==='p'){
    const f=p.color==='red'?1:-1;
    const crossed=p.color==='red'?r1>=5:r1<=4;
    if(!(R===f&&C===0) && !(crossed&&R===0&&ac===1)) return '兵／卒只能向前；過河後才能左右走一格，不能後退';
  }
  return null;
}
function findKing(g,color){
  const kt=color==='red'?'K':'k';
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]?.t===kt)return[r,c];
  return null;
}
function attacksSquare(g,attackerColor,fromR,fromC,targetR,targetC){
  const a=g.b[fromR]?.[fromC];
  if(!a || !own(a.t,attackerColor) || !inside(targetR,targetC)) return false;
  const d=g.b[targetR][targetC];
  // Attack detection is intentionally separate from `legal()` so a check can
  // be recognized without accidentally applying turn/move legality rules.
  // The user's special rules allow a king to face the enemy king and leave
  // its own king attacked; only the piece's attack pattern matters here.
  const t=a.t.toLowerCase();
  const R=targetR-fromR,C=targetC-fromC,ar=Math.abs(R),ac=Math.abs(C);
  if(fromR===targetR && fromC===targetC) return false;
  if(t==='k'){
    return C===0 && clearCount(g.b,fromR,fromC,targetR,targetC)===0;
  }
  if(t==='a') return ar===1 && ac===1 && palace(targetR,targetC,attackerColor);
  if(t==='b'){
    if(!(ar===2&&ac===2)) return false;
    if((attackerColor==='red'&&targetR>4)||(attackerColor==='black'&&targetR<5)) return false;
    return !g.b[fromR+R/2][fromC+C/2];
  }
  if(t==='n'){
    if(!((ar===2&&ac===1)||(ar===1&&ac===2))) return false;
    const lr=fromR+(ar===2?Math.sign(R):0);
    const lc=fromC+(ac===2?Math.sign(C):0);
    return !g.b[lr][lc];
  }
  if(t==='r') return (R===0||C===0) && clearCount(g.b,fromR,fromC,targetR,targetC)===0;
  if(t==='c') return (R===0||C===0) && d && clearCount(g.b,fromR,fromC,targetR,targetC)===1;
  if(t==='p'){
    const f=attackerColor==='red'?1:-1;
    const crossed=attackerColor==='red'?fromR>=5:fromR<=4;
    return (R===f&&C===0) || (crossed&&R===0&&ac===1);
  }
  return false;
}
function isAttacked(g,attackerColor,targetR,targetC){
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){
    if(attacksSquare(g,attackerColor,r,c,targetR,targetC)) return true;
  }
  return false;
}
function isInCheck(g,color){
  const k=findKing(g,color); return !!(k && isAttacked(g,color==='red'?'black':'red',k[0],k[1]));
}
function checkTarget(g,byColor){
  const target=byColor==='red'?'black':'red';
  return isInCheck(g,target) ? target : null;
}
function hasLegalMove(g,color){
  const p={color};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]&&own(g.b[r][c].t,color)){
    for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++) if(!legal(g,p,r,c,rr,cc)) return true;
  }
  return false;
}
function finishByNoMoves(x){
  const g=x.g;if(g.winner||!g.turn)return;
  const c=g.turn;
  if(!hasLegalMove(g,c)){
    const winner=c==='red'?'black':'red';
    g.winner=winner;g.winnerPid=x.players.find(p=>p.color===winner)?.pid||null;
    g.endedReason=`${c==='red'?'紅方':'黑方'}困斃，${winner==='red'?'紅方':'黑方'}獲勝！`;
    g.turnDeadline=null;
  }
}
function playerList(x){
  return x.players.map(p=>({pid:p.pid,name:p.name,avatar:p.avatar,color:p.color||null,connected:p.connected!==false})).concat(x.ai?[{pid:'ai',name:'電腦',avatar:'🤖',color:'black',connected:true}]:[]);
}
function snapshot(x,p){
  const rps=x.rps?{
    phase:x.rps.phase,result:x.rps.result||null,winnerPid:x.rps.winnerPid||null,
    isRpsWinner:x.rps.winnerPid===p.pid,youChoice:x.rps.choices?.[p.pid]||null,
    hasOpponentChoice:x.players.some(q=>q.pid!==p.pid&&x.rps.choices?.[q.pid])
  }:null;
  return {
    type:'state',roomId:x.ai?null:x.id,color:p.color||null,turn:x.g.turn,winner:x.g.winner,winnerPid:x.g.winnerPid||null,
    endedReason:x.g.endedReason||null,board:x.g.b,history:x.g.history,move:x.g.move,turnDeadline:x.g.turnDeadline,
    players:playerList(x),mode:x.ai?'ai':'online',difficulty:x.difficulty||null,rps,roundKey:x.g.roundKey,chat:x.chat||[],
    checkEvent:x.checkEvent||null,rematch:x.rematchInvite?{pendingForMe:x.rematchInvite.toPid===p.pid,pendingByMe:x.rematchInvite.fromPid===p.pid}:null,
    proposal:x.proposal?{kind:x.proposal.kind,fromPid:x.proposal.fromPid,fromName:x.proposal.fromName,toPid:x.proposal.toPid}:null,
    avatar:p.avatar
  };
}
function send(p,o){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(o));}
function broadcast(x){x.players.forEach(p=>send(p,snapshot(x,p)));}
function setTurnDeadline(x){x.g.turnDeadline=x.g.turn?Date.now()+TURN_SECONDS*1000:null;}
function resetOnlineRound(x){
  x.g=newGame();x.players.forEach(p=>p.color=null);x.rps=newRps();x.rematchInvite=null;x.proposal=null;x.checkEvent=null;x.chat=[];
}
function resolveRps(x){
  if(!x.rps||x.rps.phase!=='rps'||x.players.length<2)return;
  const [a,b]=x.players,ca=x.rps.choices[a.pid],cb=x.rps.choices[b.pid];
  if(!ca||!cb)return;
  if(ca===cb){x.g.turn=null;x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};return broadcast(x);}
  const winner=BEATS[ca]===cb?a:b;
  x.g.turn=null;x.rps={phase:'choose-color',choices:{},result:`${winner.name} 猜拳獲勝！請選擇紅方或黑方。`,winnerPid:winner.pid};broadcast(x);
}
function chooseColor(x,p,color){
  if(!x.rps||x.rps.phase!=='choose-color')return'目前不是選色階段';
  if(x.rps.winnerPid!==p.pid)return'你是猜拳落敗者，請等待對方選擇顏色';
  if(!['red','black'].includes(color))return'顏色無效';
  const loser=x.players.find(q=>q.pid!==p.pid);p.color=color;loser.color=color==='red'?'black':'red';
  x.rps.phase='done';x.rps.result=`${p.name} 選擇${color==='red'?'紅方':'黑方'}，猜拳獲勝者先手。`;x.g.turn=p.color;setTurnDeadline(x);return null;
}
function recordMove(x,before,src,dst,r1,c1,r2,c2){
  const g=x.g;
  g.history.push({n:g.move,color:src.t===src.t.toUpperCase()?'red':'black',piece:TYPES[src.t],from:[r1+1,c1+1],to:[r2+1,c2+1],captured:dst?TYPES[dst.t]:null});
  x.undoStack.push(before);g.move++;
}
function applyMove(x,p,m){
  const g=x.g;
  if(!x.ai&&x.rps?.phase!=='done')return{error:'請先完成猜拳與選色，現在還不能走棋'};
  if(!g.turn)return{error:'等待對局開始'};if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};
  if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'};}
  const r1=Number(m.r1),c1=Number(m.c1),r2=Number(m.r2),c2=Number(m.c2),err=legal(g,p,r1,c1,r2,c2);if(err)return{error:err};
  const before=clone(g),src=g.b[r1][c1],dst=g.b[r2][c2];g.b[r2][c2]=src;g.b[r1][c1]=null;
  recordMove(x,before,src,dst,r1,c1,r2,c2);
  g.turn=null;x.checkEvent=null;
  if(dst&&dst.t.toLowerCase()==='k'){
    g.winner=p.color;g.winnerPid=p.pid;g.endedReason=`${p.color==='red'?'紅方':'黑方'}直接吃掉${p.color==='red'?'黑將':'紅帥'}，獲勝！`;g.turnDeadline=null;
  }else{
    const target=checkTarget(g,p.color);
    x.checkEvent=target?{id:eventId(),by:p.color,target}:null;
    g.turn=p.color==='red'?'black':'red';setTurnDeadline(x);finishByNoMoves(x);
  }
  return{ok:true};
}
function legalMoves(g,color){
  const out=[],p={color};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]&&own(g.b[r][c].t,color))for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!legal(g,p,r,c,rr,cc))out.push({r1:r,c1:c,r2:rr,c2:cc});
  return out;
}
function scoreMove(g,m,level){
  const dst=g.b[m.r2][m.c2];const val={p:100,n:320,b:330,a:200,r:900,c:500,k:10000};let s=0;
  if(dst)s+=(val[dst.t.toLowerCase()]||0)*10;
  if(m.r2>=4&&m.r2<=6)s+=20;
  if(level==='hard'){
    const ng=clone(g);ng.b[m.r2][m.c2]=ng.b[m.r1][m.c1];ng.b[m.r1][m.c1]=null;
    if(dst?.t==='K')s+=100000; if(isInCheck(ng,'red'))s+=300;
    const ck=findKing(ng,'red');if(ck&&isAttacked(ng,'black',ck[0],ck[1]))s+=180;
  }
  return s+Math.random()*3;
}
function aiTurn(x){
  if(!x.ai||x.g.winner||x.g.turn!=='black')return;
  const moves=legalMoves(x.g,'black');
  if(!moves.length){x.g.winner='red';x.g.endedReason='電腦困斃，你獲勝！';x.g.turnDeadline=null;broadcast(x);return;}
  const level=x.difficulty||'normal';let choice;
  if(level==='easy')choice=moves[Math.floor(Math.random()*moves.length)];
  else{const ranked=moves.map(m=>({...m,score:scoreMove(x.g,m,level)})).sort((a,b)=>b.score-a.score);const pool=level==='hard'?ranked.slice(0,3):ranked.slice(0,7);choice=pool[Math.floor(Math.random()*pool.length)];}
  const fake={pid:'ai',color:'black'};const res=applyMove(x,fake,choice);if(res.ok){
    const checkId=x.checkEvent?.id;
    broadcast(x);
    if(checkId)setTimeout(()=>{if(x.checkEvent?.id===checkId){x.checkEvent=null;broadcast(x);}},1500);
  }
}
function timeOut(x){
  if(x.g.winner||!x.g.turn)return;
  const loser=x.g.turn,winner=loser==='red'?'black':'red';x.g.winner=winner;x.g.winnerPid=x.players.find(p=>p.color===winner)?.pid||null;x.g.endedReason=`${loser==='red'?'紅方':'黑方'}超時，${winner==='red'?'紅方':'黑方'}獲勝！`;x.g.turnDeadline=null;broadcast(x);
}
function proposal(x,p,kind){
  if(!x.g||x.g.winner)return'對局尚未結束或已結束';
  if(x.players.length<2)return'目前沒有對手';
  if(x.proposal)return'已有一個請求等待回覆';
  const other=x.players.find(q=>q.pid!==p.pid);x.proposal={kind,fromPid:p.pid,fromName:p.name,toPid:other.pid};send(other,{type:'proposal',kind,fromName:p.name});broadcast(x);return null;
}
function handleProposalResponse(x,p,accept){
  const q=x.proposal;if(!q||q.toPid!==p.pid)return'沒有等待中的請求';
  const from=x.players.find(z=>z.pid===q.fromPid);x.proposal=null;
  if(q.kind==='draw'){
    if(accept){x.g.winner='draw';x.g.endedReason='雙方同意和棋。';x.g.turnDeadline=null;broadcast(x);}
    else{if(from)send(from,{type:'notice',message:`${p.name} 拒絕和棋請求。`});broadcast(x);}
  } else if(q.kind==='undo'){
    if(!accept){if(from)send(from,{type:'notice',message:`${p.name} 拒絕悔棋請求。`});broadcast(x);return null;}
    if(!x.undoStack.length)return'沒有可以悔回的步驟';
    const snapshotState=x.undoStack.pop();x.g=clone(snapshotState);x.checkEvent=null;x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;setTurnDeadline(x);broadcast(x);
  }
  return null;
}

const server=http.createServer((req,res)=>{
  let u=req.url.split('?')[0];if(u==='/')u='/index.html';
  const file=path.join(pub,u);if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404);return res.end('404');}
  const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0'});fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  let x=null,p=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(m.action==='create'){
      x={id:rid(),players:[],g:newGame(),ai:false,rps:newRps(),difficulty:null,undoStack:[],checkEvent:null,proposal:null,rematchInvite:null,chat:[]};rooms.set(x.id,x);
      p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'online'});send(p,snapshot(x,p));broadcast(x);
    } else if(m.action==='ai'){
      const difficulty=['easy','normal','hard'].includes(m.difficulty)?m.difficulty:'normal';x={id:rid(),players:[],g:newGame(),ai:true,difficulty,undoStack:[],checkEvent:null,proposal:null,chat:[]};rooms.set(x.id,x);x.g.turn='red';setTurnDeadline(x);
      p={ws,pid:pid(),name:String(m.name||'玩家1').slice(0,12),avatar:AVATARS.includes(m.avatar)?m.avatar:'🧑🏻',color:'red',connected:true};x.players.push(p);send(p,{type:'room',roomId:null,pid:p.pid,color:'red',mode:'ai'});send(p,snapshot(x,p));
    } else if(m.action==='join'){
      x=rooms.get(String(m.roomId||'').trim().toUpperCase());
      if(!x||x.ai||x.players.length>=2)return send({ws}, {type:'error',message:'房間不存在、已滿，或這是人機房間'});
      p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家2').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);broadcast(x);
    } else if(!x||!p)return;
    else if(m.action==='rps'&&!x.ai){
      if(x.players.length<2)return send(p,{type:'error',message:'請等待另一位玩家加入'});
      if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不是猜拳階段'});
      if(!['剪刀','石頭','布'].includes(m.choice))return send(p,{type:'error',message:'猜拳選項無效'});
      if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你本輪已經出拳，請等待結果'});
      x.rps.choices[p.pid]=m.choice;if(x.players.every(q=>x.rps.choices[q.pid]))resolveRps(x);else broadcast(x);
    } else if(m.action==='chooseColor'&&!x.ai){const e=chooseColor(x,p,m.color);if(e)send(p,{type:'error',message:e});else broadcast(x);
    } else if(m.action==='chat'){
      if(x.ai) return send(p,{type:'error',message:'單人模式沒有聊天室'});
      if(x.rps?.phase!=='done'||!x.g.turn) return send(p,{type:'error',message:'進入對局後才能聊天'});
      const text=String(m.text||'').trim().slice(0,200);
      if(!text) return;
      x.chat=x.chat||[];
      x.chat.push({pid:p.pid,name:p.name,avatar:p.avatar,text,ts:Date.now()});
      if(x.chat.length>100)x.chat=x.chat.slice(-100);
      broadcast(x);
    } else if(m.action==='move'){
      const res=applyMove(x,p,m);if(res.error)send(p,{type:'error',message:res.error});else{
        const checkId=x.checkEvent?.id;
        broadcast(x);
        if(checkId){setTimeout(()=>{if(x.checkEvent?.id===checkId){x.checkEvent=null;broadcast(x);}},1500);}
        if(x.ai&&x.g.turn==='black'&&!x.g.winner)setTimeout(()=>aiTurn(x),500);
      }
    } else if(m.action==='proposal'){
      if(x.ai && m.kind==='undo'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束，不能悔棋'});
        if(!x.undoStack.length)return send(p,{type:'error',message:'目前沒有可以悔回的步驟'});
        const steps=Math.min(2,x.undoStack.length); let restored=null; for(let i=0;i<steps;i++) restored=x.undoStack.pop();
        x.g=clone(restored);x.checkEvent=null;x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;setTurnDeadline(x);send(p,snapshot(x,p));
      } else if(x.ai && m.kind==='draw'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束'});
        x.g.winner='draw';x.g.endedReason='你選擇求和，本局以和棋結束。';x.g.turnDeadline=null;send(p,snapshot(x,p));
      } else {const e=proposal(x,p,m.kind);if(e)send(p,{type:'error',message:e});}
    } else if(m.action==='proposalResponse'){const e=handleProposalResponse(x,p,!!m.accept);if(e)send(p,{type:'error',message:e});
    } else if(m.action==='inviteRematch'&&!x.ai){
      if(!x.g.winner)return send(p,{type:'error',message:'對局結束後才能邀請再戰'});
      if(x.rematchInvite)return send(p,{type:'error',message:'已經有再戰邀請正在等待'});
      const other=x.players.find(q=>q.pid!==p.pid);x.rematchInvite={fromPid:p.pid,toPid:other.pid};send(other,{type:'rematch-invite',fromName:p.name,roomId:x.id,ended:true});broadcast(x);
    } else if(m.action==='rematchResponse'&&!x.ai){
      const inv=x.rematchInvite;if(!inv||inv.toPid!==p.pid)return send(p,{type:'error',message:'沒有等待中的再戰邀請'});x.rematchInvite=null;
      if(m.accept){resetOnlineRound(x);broadcast(x);}else{const inviter=x.players.find(q=>q.pid===inv.fromPid);if(inviter)send(inviter,{type:'notice',message:`${p.name} 暫時不進行下一場。`});broadcast(x);}
    } else if(m.action==='aiRematch'&&x.ai){x.g=newGame();x.g.turn='red';x.undoStack=[];x.checkEvent=null;setTurnDeadline(x);send(p,snapshot(x,p));}
  });
  ws.on('close',()=>{
    if(!x||!p)return;const online=!x.ai,hadTwo=x.players.length===2;x.players=x.players.filter(q=>q!==p);
    if(!x.players.length){rooms.delete(x.id);return;}
    if(online&&hadTwo){const survivor=x.players[0];survivor.color=survivor.color||'red';x.g.winner=survivor.color;x.g.winnerPid=survivor.pid;x.g.endedReason='對方已斷線，你方獲勝！';x.g.turnDeadline=null;x.proposal=null;x.rematchInvite=null;x.rps.phase='done';broadcast(x);}else broadcast(x);
  });
});
setInterval(()=>{for(const x of rooms.values()){if(x.g?.turnDeadline&&Date.now()>x.g.turnDeadline&&!x.g.winner){timeOut(x);}}},500);
server.listen(PORT,()=>console.log(`Xiangqi online on ${PORT}`));
