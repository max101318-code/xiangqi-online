const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;
const rooms = new Map();
const matchmakingQueue = [];
const pub = path.join(__dirname, 'public');

const MODES = ['xiangqi', 'gomoku', 'go'];
const MODE_NAMES = { xiangqi: '中國象棋', gomoku: '五子棋', go: '圍棋' };
const AVATARS = ['🧑🏻','🧑🏼','🧑🏽','🧑🏾','🧑🏿','🐱','🐼','🦊','🐯','🐸','🤖','👾','🦄','🐲','😎','🥷'];
const RPS_BEATS = { 剪刀: '布', 布: '石頭', 石頭: '剪刀' };
const TYPES = { K:'帥', A:'仕', B:'相', N:'傌', R:'俥', C:'炮', P:'兵', k:'將', a:'士', b:'象', n:'馬', r:'車', c:'炮', p:'卒' };
const XIANGQI_START = [
  ['R',0,0],['N',0,1],['B',0,2],['A',0,3],['K',0,4],['A',0,5],['B',0,6],['N',0,7],['R',0,8],
  ['C',2,1],['C',2,7],['P',3,0],['P',3,2],['P',3,4],['P',3,6],['P',3,8],
  ['r',9,0],['n',9,1],['b',9,2],['a',9,3],['k',9,4],['a',9,5],['b',9,6],['n',9,7],['r',9,8],
  ['c',7,1],['c',7,7],['p',6,0],['p',6,2],['p',6,4],['p',6,6],['p',6,8]
];

const clone = v => JSON.parse(JSON.stringify(v));
const rid = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const pid = () => crypto.randomBytes(5).toString('hex');
const eventId = () => `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
function normalizeMode(v) { return MODES.includes(v) ? v : 'xiangqi'; }
function otherColor(c) { return c === 'red' ? 'black' : c === 'black' ? 'red' : c === 'white' ? 'black' : 'white'; }
function normalizeAvatar(v) {
  const s=String(v||'');
  if(AVATARS.includes(s)) return s;
  if(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length<=350000) return s;
  return '🧑🏻';
}
function send(p,msg){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(msg));}
function broadcast(x){x.players.forEach(p=>send(p,snapshot(x,p)));}
function inside(r,c,rows,cols){return r>=0&&r<rows&&c>=0&&c<cols;}

// ---------- 中國象棋 ----------
function newXiangqi(){
  const b=Array.from({length:10},()=>Array(9).fill(null));
  for(const[t,r,c]of XIANGQI_START)b[r][c]={t,id:crypto.randomBytes(4).toString('hex')};
  return {type:'xiangqi',b,turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),checkEvent:null};
}
function own(t,color){return color==='red'?/[A-Z]/.test(t):/[a-z]/.test(t);}
function palace(r,c,color){return c>=3&&c<=5&&(color==='red'?r<=2:r>=7);}
function clearCount(b,r1,c1,r2,c2){const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1);let n=0,r=r1+dr,c=c1+dc;while(r!==r2||c!==c2){if(b[r][c])n++;r+=dr;c+=dc;}return n;}
function xiangqiLegal(g,p,r1,c1,r2,c2){
  if(!inside(r1,c1,10,9)||!inside(r2,c2,10,9))return'座標超出棋盤';
  const a=g.b[r1][c1],d=g.b[r2][c2];if(!a)return'起點沒有棋子';if(!own(a.t,p.color))return'只能移動自己的棋子';if(d&&own(d.t,p.color))return'目標已有己方棋子';
  const t=a.t.toLowerCase(),R=r2-r1,C=c2-c1,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k'){
    const face=d&&d.t.toLowerCase()==='k'&&C===0&&clearCount(g.b,r1,c1,r2,c2)===0;
    if(!face&&!(ar+ac===1&&palace(r2,c2,p.color)))return'將／帥只能在己方九宮內直走一格；將帥照面時可直線吃將／帥';
  }else if(t==='a'){
    if(!(ar===1&&ac===1&&palace(r2,c2,p.color)))return'士／仕只能在己方九宮內斜走一格';
  }else if(t==='b'){
    if(!(ar===2&&ac===2))return'象／相必須斜走兩格';
    if((p.color==='red'&&r2>4)||(p.color==='black'&&r2<5))return'象／相不能過河';
    if(g.b[r1+R/2][c1+C/2])return'象眼被堵';
  }else if(t==='n'){
    if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return'馬／傌必須走日字';
    const lr=r1+(ar===2?Math.sign(R):0),lc=c1+(ac===2?Math.sign(C):0);if(g.b[lr][lc])return'馬腿被堵';
  }else if(t==='r'){
    if(!(R===0||C===0)||clearCount(g.b,r1,c1,r2,c2)!==0)return'車／俥只能直線走且不能越子';
  }else if(t==='c'){
    if(!(R===0||C===0))return'炮必須直線移動';
    const n=clearCount(g.b,r1,c1,r2,c2);if(d&&n!==1)return'炮吃子時中間必須恰好一枚炮架';if(!d&&n!==0)return'炮移動到空位時不能隔子';
  }else if(t==='p'){
    const f=p.color==='red'?1:-1,crossed=p.color==='red'?r1>=5:r1<=4;
    if(!((R===f&&C===0)||(crossed&&R===0&&ac===1)))return'兵／卒只能向前；過河後才能左右走一格，不能後退';
  }
  return null;
}
function findKing(g,color){const k=color==='red'?'K':'k';for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]?.t===k)return[r,c];return null;}
function attacksSquare(g,color,fr,fc,tr,tc){
  const a=g.b[fr]?.[fc];if(!a||!own(a.t,color)||!inside(tr,tc,10,9)||(fr===tr&&fc===tc))return false;
  const d=g.b[tr][tc],t=a.t.toLowerCase(),R=tr-fr,C=tc-fc,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k')return C===0&&clearCount(g.b,fr,fc,tr,tc)===0;
  if(t==='a')return ar===1&&ac===1&&palace(tr,tc,color);
  if(t==='b'){if(!(ar===2&&ac===2))return false;if((color==='red'&&tr>4)||(color==='black'&&tr<5))return false;return!g.b[fr+R/2][fc+C/2];}
  if(t==='n'){if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return false;const lr=fr+(ar===2?Math.sign(R):0),lc=fc+(ac===2?Math.sign(C):0);return!g.b[lr][lc];}
  if(t==='r')return(R===0||C===0)&&clearCount(g.b,fr,fc,tr,tc)===0;
  if(t==='c')return(R===0||C===0)&&d&&clearCount(g.b,fr,fc,tr,tc)===1;
  if(t==='p'){const f=color==='red'?1:-1,crossed=color==='red'?fr>=5:fr<=4;return(R===f&&C===0)||(crossed&&R===0&&ac===1);}
  return false;
}
function isAttacked(g,color,r,c){for(let fr=0;fr<10;fr++)for(let fc=0;fc<9;fc++)if(attacksSquare(g,color,fr,fc,r,c))return true;return false;}
function hasLegalXiangqi(g,color){const p={color};for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]&&own(g.b[r][c].t,color))for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!xiangqiLegal(g,p,r,c,rr,cc))return true;return false;}

// ---------- 五子棋 ----------
function newGomoku(){return{type:'gomoku',size:15,b:Array.from({length:15},()=>Array(15).fill(null)),turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),lastMove:null};}
function gomokuLegal(g,r,c){if(!inside(r,c,g.size,g.size))return'位置超出棋盤';if(g.b[r][c])return'這個位置已有棋子';return null;}
function gomokuWin(g,r,c,color){for(const[dr,dc]of[[1,0],[0,1],[1,1],[1,-1]]){let n=1;for(let s=1;s<g.size;s++){const rr=r+dr*s,cc=c+dc*s;if(!inside(rr,cc,g.size,g.size)||g.b[rr][cc]!==color)break;n++;}for(let s=1;s<g.size;s++){const rr=r-dr*s,cc=c-dc*s;if(!inside(rr,cc,g.size,g.size)||g.b[rr][cc]!==color)break;n++;}if(n>=5)return true;}return false;}
function legalMovesGomoku(g){
  if(!g.history.length)return[{r:7,c:7}];
  const set=new Set(),out=[];
  for(const h of g.history){const[r,c]=h.from;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){const rr=r-1+dr,cc=c-1+dc;if(inside(rr,cc,g.size,g.size)&&!g.b[rr][cc])set.add(rr+','+cc);}}
  set.forEach(k=>{const[r,c]=k.split(',').map(Number);out.push({r,c});});
  return out.length?out:Array.from({length:g.size},(_,r)=>r).flatMap(r=>Array.from({length:g.size},(_,c)=>({r,c}))).filter(m=>!g.b[m.r][m.c]);
}
function countLine(g,r,c,dr,dc,color){let n=1;for(const s of [-1,1])for(let i=1;i<5;i++){const rr=r+dr*i*s,cc=c+dc*i*s;if(!inside(rr,cc,g.size,g.size)||g.b[rr][cc]!==color)break;n++;}return n;}
function scoreGomokuMove(g,r,c,color){const center=(g.size-1)/2;let s=-((r-center)**2+(c-center)**2)*0.2+Math.random()*4;for(const[dr,dc]of[[1,0],[0,1],[1,1],[1,-1]])s+=countLine(g,r,c,dr,dc,color)**3*8;return s;}

// ---------- 圍棋 9x9 ----------
function newGo(){return{type:'go',size:9,b:Array.from({length:9},()=>Array(9).fill(null)),turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),ko:null,passCount:0,captures:{black:0,white:0},lastMove:null};}
function goNeighbors(g,r,c){const out=[];for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc;if(inside(rr,cc,g.size,g.size))out.push([rr,cc]);}return out;}
function goGroup(g,r,c){const color=g.b[r][c];if(!color)return{stones:[],liberties:new Set()};const q=[[r,c]],seen=new Set([r+','+c]),stones=[],liberties=new Set();while(q.length){const[rr,cc]=q.shift();stones.push([rr,cc]);for(const[nr,nc]of goNeighbors(g,rr,cc)){const v=g.b[nr][nc],k=nr+','+nc;if(!v)liberties.add(k);else if(v===color&&!seen.has(k)){seen.add(k);q.push([nr,nc]);}}}return{stones,liberties};}
function goTryMove(g,r,c,color){
  if(!inside(r,c,g.size,g.size))return{error:'位置超出棋盤'};if(g.b[r][c])return{error:'此處已有棋子'};if(g.ko&&g.ko.r===r&&g.ko.c===c)return{error:'打劫：此處目前不能立即回提'};
  const b=clone(g.b);b[r][c]=color;const tmp={...g,b};let removed=0,captured=[];
  for(const[nr,nc]of goNeighbors(tmp,r,c)){if(tmp.b[nr][nc]&&tmp.b[nr][nc]!==color){const grp=goGroup(tmp,nr,nc);if(grp.liberties.size===0){captured.push(grp.stones);for(const[sr,sc]of grp.stones){tmp.b[sr][sc]=null;removed++;}}}}
  if(goGroup(tmp,r,c).liberties.size===0)return{error:'這一步會自殺，不能落子'};
  let ko=null;if(removed===1&&goGroup(tmp,r,c).stones.length===1){const[sr,sc]=captured[0][0];ko={r:sr,c:sc};}
  return{board:tmp.b,removed,ko};
}
function goScore(g){
  const seen=new Set(),score={black:g.captures.black,white:g.captures.white};
  for(let r=0;r<g.size;r++)for(let c=0;c<g.size;c++){
    const v=g.b[r][c];if(v){score[v]++;continue;}const key=r+','+c;if(seen.has(key))continue;
    const q=[[r,c]],region=[],border=new Set(),regSeen=new Set([key]);
    while(q.length){const[rr,cc]=q.shift();region.push([rr,cc]);for(const[nr,nc]of goNeighbors(g,rr,cc)){const nv=g.b[nr][nc],k=nr+','+nc;if(!nv&&!regSeen.has(k)){regSeen.add(k);q.push([nr,nc]);}if(nv)border.add(nv);}}
    if(border.size===1)score[[...border][0]]+=region.length;
    for(const[rr,cc]of region)seen.add(rr+','+cc);
  }
  return score;
}
function legalMovesGo(g,color){const out=[];for(let r=0;r<g.size;r++)for(let c=0;c<g.size;c++)if(!g.b[r][c]){const res=goTryMove(g,r,c,color);if(!res.error)out.push({r,c,removed:res.removed});}return out;}

function newGame(mode){mode=normalizeMode(mode);return mode==='gomoku'?newGomoku():mode==='go'?newGo():newXiangqi();}
function createRoom(matchmade,mode){const m=normalizeMode(mode);const x={id:roomId(),mode:m,players:[],g:newGame(m),ai:false,aiColor:null,difficulty:null,matchmade:!!matchmade,rps:{phase:'rps',choices:{},result:null,winnerPid:null},undoStack:[],proposal:null,rematchInvite:null,chat:[]};rooms.set(x.id,x);return x;}
function setTurnDeadline(x){x.g.turnDeadline=x.g.turn?Date.now()+TURN_SECONDS*1000:null;}
function resultForPlayer(x,p){if(!x.g.winner)return null;if(x.g.winner==='draw')return'draw';return x.g.winnerPid===p.pid?'win':'loss';}
function playerList(x){return x.players.map(p=>({pid:p.pid,name:p.name,avatar:p.avatar,color:p.color||null,connected:p.connected!==false})).concat(x.ai?[{pid:'ai',name:'電腦',avatar:'🤖',color:x.aiColor,connected:true}]:[]);}
function snapshot(x,p){
  const rps=x.rps?{phase:x.rps.phase,result:x.rps.result||null,winnerPid:x.rps.winnerPid||null,isRpsWinner:x.rps.winnerPid===p.pid,youChoice:x.rps.choices?.[p.pid]||null,hasOpponentChoice:x.players.some(q=>q.pid!==p.pid&&x.rps.choices?.[q.pid])}:null;
  return {type:'state',roomId:x.matchmade?null:x.id,matchmade:!!x.matchmade,mode:x.mode,difficulty:x.difficulty||null,color:p.color||null,turn:x.g.turn,winner:x.g.winner,winnerPid:x.g.winnerPid||null,resultForMe:resultForPlayer(x,p),endedReason:x.g.endedReason||null,board:x.g.b,history:x.g.history,move:x.g.move,turnDeadline:x.g.turnDeadline,players:playerList(x),roundKey:x.g.roundKey,chat:x.chat||[],checkEvent:x.g.checkEvent||null,rematch:x.rematchInvite?{pendingForMe:x.rematchInvite.toPid===p.pid,pendingByMe:x.rematchInvite.fromPid===p.pid}:null,proposal:x.proposal?{kind:x.proposal.kind,fromPid:x.proposal.fromPid,fromName:x.proposal.fromName,toPid:x.proposal.toPid}:null,captures:x.g.captures||null,passCount:x.g.passCount||0,lastMove:x.g.lastMove||null,ko:x.g.ko||null,avatar:p.avatar};
}
function endGame(x,winnerColor,winnerPid,reason){if(x.g.winner)return;x.g.winner=winnerColor;x.g.winnerPid=winnerPid||null;x.g.endedReason=reason;x.g.turnDeadline=null;}

function resolveRps(x){
  if(x.players.length<2||x.rps.phase!=='rps')return;
  const[a,b]=x.players,ca=x.rps.choices[a.pid],cb=x.rps.choices[b.pid];if(!ca||!cb)return;
  if(ca===cb){x.g.turn=null;x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};return broadcast(x);}
  const winner=RPS_BEATS[ca]===cb?a:b;
  x.g.turn=null;
  if(x.mode==='xiangqi'){
    x.rps={phase:'choose-color',choices:{},result:`${winner.name} 猜拳獲勝！請選擇紅方或黑方。`,winnerPid:winner.pid};
  }else{
    winner.color='black';x.players.find(q=>q.pid!==winner.pid).color='white';x.rps={phase:'done',choices:{},result:`${winner.name} 猜拳獲勝，取得黑方並先手。`,winnerPid:winner.pid};x.g.turn='black';setTurnDeadline(x);
  }
  broadcast(x);
}
function chooseColor(x,p,color){
  if(x.mode!=='xiangqi')return'此模式猜拳勝者直接執黑先手';
  if(x.rps.phase!=='choose-color')return'目前不是選色階段';if(x.rps.winnerPid!==p.pid)return'你是猜拳落敗者，請等待對方選色';if(!['red','black'].includes(color))return'顏色無效';
  const loser=x.players.find(q=>q.pid!==p.pid);p.color=color;loser.color=otherColor(color);x.rps.phase='done';x.rps.result=`${p.name} 選擇${color==='red'?'紅方':'黑方'}，猜拳獲勝者先手。`;x.g.turn=color;setTurnDeadline(x);broadcast(x);
}
function timeOut(x){if(x.g.winner||!x.g.turn)return;const loser=x.g.turn,winner=otherColor(loser);const wp=x.players.find(p=>p.color===winner)?.pid||'ai';endGame(x,winner,wp,`${loser==='red'?'紅方':loser==='black'?'黑方':loser==='white'?'白方':loser}超時，${winner==='red'?'紅方':winner==='black'?'黑方':'白方'}獲勝！`);broadcast(x);}

function applyXiangqi(x,p,m){
  const g=x.g;if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'}};
  const r1=+m.r1,c1=+m.c1,r2=+m.r2,c2=+m.c2,err=xiangqiLegal(g,p,r1,c1,r2,c2);if(err)return{error:err};
  const before=clone(g);const src=g.b[r1][c1],dst=g.b[r2][c2];g.b[r2][c2]=src;g.b[r1][c1]=null;g.history.push({n:g.move,color:p.color,piece:TYPES[src.t],from:[r1+1,c1+1],to:[r2+1,c2+1],captured:dst?TYPES[dst.t]:null});x.undoStack.push(before);g.move++;
  if(dst&&dst.t.toLowerCase()==='k'){endGame(x,p.color,p.pid,`${p.color==='red'?'紅方':'黑方'}直接吃掉對方將／帥，獲勝！`);return{ok:true};}
  g.checkEvent=null;const enemy=otherColor(p.color),k=findKing(g,enemy);if(k&&isAttacked(g,p.color,k[0],k[1]))g.checkEvent={id:eventId(),by:p.color,target:enemy};g.turn=enemy;setTurnDeadline(x);if(!hasLegalXiangqi(g,enemy))endGame(x,p.color,p.pid,`${enemy==='red'?'紅方':'黑方'}困斃，${p.color==='red'?'紅方':'黑方'}獲勝！`);return{ok:true};
}
function applyGomoku(x,p,m){
  const g=x.g;if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'}};
  const r=+m.r,c=+m.c,err=gomokuLegal(g,r,c);if(err)return{error:err};const before=clone(g);g.b[r][c]=p.color;g.lastMove={r,c,color:p.color};g.history.push({n:g.move,color:p.color,from:[r+1,c+1]});x.undoStack.push(before);g.move++;
  if(gomokuWin(g,r,c,p.color)){endGame(x,p.color,p.pid,`${p.color==='black'?'黑方':'白方'}五連，獲勝！`);return{ok:true};}
  if(g.move>g.size*g.size){endGame(x,'draw',null,'棋盤已滿，和棋。');return{ok:true};}
  g.turn=otherColor(p.color);setTurnDeadline(x);return{ok:true};
}
function applyGo(x,p,m){
  const g=x.g;if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'}};
  const before=clone(g);
  if(m.pass){g.passCount++;g.history.push({n:g.move,color:p.color,pass:true});g.move++;g.ko=null;if(g.passCount>=2){const s=goScore(g);if(s.black===s.white)endGame(x,'draw',null,`雙方停手，終局計分：黑 ${s.black}、白 ${s.white}。`);else{const w=s.black>s.white?'black':'white',wp=x.players.find(q=>q.color===w)?.pid||'ai';endGame(x,w,wp,`雙方連續停手，終局計分：黑 ${s.black}、白 ${s.white}，${w==='black'?'黑方':'白方'}獲勝。`);}return{ok:true};}x.undoStack.push(before);g.turn=otherColor(p.color);setTurnDeadline(x);return{ok:true};}
  const r=+m.r,c=+m.c,res=goTryMove(g,r,c,p.color);if(res.error)return res; x.undoStack.push(before);g.b=res.board;g.ko=res.ko;g.passCount=0;g.captures[p.color]+=res.removed||0;g.lastMove={r,c,color:p.color};g.history.push({n:g.move,color:p.color,from:[r+1,c+1],captured:res.removed||0});g.move++;g.turn=otherColor(p.color);setTurnDeadline(x);return{ok:true};
}
function applyMove(x,p,m){return x.mode==='gomoku'?applyGomoku(x,p,m):x.mode==='go'?applyGo(x,p,m):applyXiangqi(x,p,m);}

function legalMovesXiangqi(g,color){const out=[],p={color};for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]&&own(g.b[r][c].t,color))for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!xiangqiLegal(g,p,r,c,rr,cc))out.push({r1:r,c1:c,r2:rr,c2:cc});return out;}
function simulateGomokuWin(g,m,color){const b=g.b[m.r][m.c];g.b[m.r][m.c]=color;const yes=gomokuWin(g,m.r,m.c,color);g.b[m.r][m.c]=b;return yes;}
function scoreGomokuCandidate(g,m,me,opp){let s=scoreGomokuMove(g,m.r,m.c,me)*2+scoreGomokuMove(g,m.r,m.c,opp);if(simulateGomokuWin(g,m,me))s+=100000;if(simulateGomokuWin(g,m,opp))s+=90000;return s;}
function legalMovesGomokuAI(g,me,opp){return legalMovesGomoku(g).sort((a,b)=>scoreGomokuCandidate(g,b,me,opp)-scoreGomokuCandidate(g,a,me,opp));}
function legalMovesGoAI(g,color){return legalMovesGo(g,color).map(m=>({...m,score:(m.removed||0)*100-Math.abs(m.r-(g.size-1)/2)-Math.abs(m.c-(g.size-1)/2)+Math.random()*5})).sort((a,b)=>b.score-a.score);}

function aiTurn(x){
  if(!x.ai||x.g.winner||x.g.turn!==x.aiColor)return;
  const fake={pid:'ai',color:x.aiColor},level=x.difficulty||'normal';let choice=null,res=null;
  if(x.mode==='xiangqi'){
    const moves=legalMovesXiangqi(x.g,x.aiColor);if(!moves.length){endGame(x,otherColor(x.aiColor),x.players[0].pid,'電腦無棋可走，你獲勝！');broadcast(x);return;}
    const scored=moves.map(m=>{const d=x.g.b[m.r2][m.c2];let s=(d?({p:100,n:320,b:330,a:200,r:900,c:500,k:10000}[d.t.toLowerCase()]||0)*8:0)+Math.random()*8;if(level==='hard'&&d?.t==='K')s+=100000;return{...m,s};}).sort((a,b)=>b.s-a.s);choice=level==='easy'?moves[Math.floor(Math.random()*moves.length)]:scored[Math.floor(Math.random()*Math.min(level==='hard'?3:7,scored.length))];res=applyMove(x,fake,choice);
  }else if(x.mode==='gomoku'){
    const moves=legalMovesGomokuAI(x.g,x.aiColor,'black');if(!moves.length){endGame(x,'draw',null,'棋盤已滿，和棋。');broadcast(x);return;}
    const ranked=moves;choice=level==='easy'?ranked[Math.floor(Math.random()*Math.min(15,ranked.length))]:ranked[Math.floor(Math.random()*Math.min(level==='hard'?3:8,ranked.length))];res=applyMove(x,fake,choice);
  }else{
    const moves=legalMovesGoAI(x.g,x.aiColor);if(!moves.length){res=applyMove(x,fake,{pass:true});}else{choice=level==='easy'?moves[Math.floor(Math.random()*Math.min(12,moves.length))]:moves[Math.floor(Math.random()*Math.min(level==='hard'?3:8,moves.length))];res=applyMove(x,fake,choice);}
  }
  if(res?.ok){const checkId=x.g.checkEvent?.id;broadcast(x);if(checkId)setTimeout(()=>{if(x.g.checkEvent?.id===checkId){x.g.checkEvent=null;broadcast(x);}},1500);}
}

function propose(x,p,kind){
  if(x.g.winner)return'對局已結束';if(x.ai&&kind==='draw')return'單人模式不需要向對手求和';if(!x.ai&&x.players.length<2)return'目前沒有對手';if(x.proposal)return'已有請求等待回覆';
  if(kind==='undo'&&!x.undoStack.length)return'目前沒有可以悔回的步驟';
  const other=x.players.find(q=>q.pid!==p.pid);if(!other)return'目前沒有對手';x.proposal={kind,fromPid:p.pid,fromName:p.name,toPid:other.pid};send(other,{type:'proposal',kind,fromName:p.name});broadcast(x);return null;
}
function handleProposalResponse(x,p,accept){
  const q=x.proposal;if(!q||q.toPid!==p.pid)return'沒有等待中的請求';x.proposal=null;const from=x.players.find(z=>z.pid===q.fromPid);
  if(q.kind==='draw'){
    if(accept)endGame(x,'draw',null,'雙方同意和棋。');else if(from)send(from,{type:'notice',message:`${p.name} 拒絕和棋請求。`});
  }else if(q.kind==='undo'){
    if(!accept){if(from)send(from,{type:'notice',message:`${p.name} 拒絕悔棋請求。`});}
    else if(x.undoStack.length){x.g=clone(x.undoStack.pop());x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;x.g.checkEvent=null;setTurnDeadline(x);}
  }
  broadcast(x);
}
function resetOnlineRound(x){x.g=newGame(x.mode);x.players.forEach(p=>p.color=null);x.rps={phase:'rps',choices:{},result:null,winnerPid:null};x.undoStack=[];x.proposal=null;x.rematchInvite=null;x.chat=[];}

function removeFromMatchmaking(p){for(let i=matchmakingQueue.length-1;i>=0;i--)if(matchmakingQueue[i].p===p)matchmakingQueue.splice(i,1);}
function tryMatchmaking(){
  while(matchmakingQueue.length>=2){
    const first=matchmakingQueue.shift();if(!first||first.ws.readyState!==1||first.cancelled)continue;let idx=-1;
    for(let i=0;i<matchmakingQueue.length;i++){const c=matchmakingQueue[i];if(c?.ws?.readyState===1&&!c.cancelled&&c.mode===first.mode){idx=i;break;}}
    if(idx<0){matchmakingQueue.unshift(first);break;}
    const second=matchmakingQueue.splice(idx,1)[0];if(!second){continue;}
    const x=createRoom(true,first.mode);x.players.push(first.p,second.p);first.assign(x);second.assign(x);
    send(first.p,{type:'room',roomId:null,pid:first.p.pid,color:null,mode:x.mode,matchmade:true});send(second.p,{type:'room',roomId:null,pid:second.p.pid,color:null,mode:x.mode,matchmade:true});broadcast(x);
  }
}

const server=http.createServer((req,res)=>{let u=req.url.split('?')[0];if(u==='/')u='/index.html';const file=path.join(pub,u);if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404);return res.end('404');}const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0'});fs.createReadStream(file).pipe(res);});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  let x=null,p=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(m.action==='create'){
      x=createRoom(false,m.mode);p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:x.mode,matchmade:false});broadcast(x);
    }else if(m.action==='join'){
      x=rooms.get(String(m.roomId||'').trim().toUpperCase());if(!x||x.ai||x.players.length>=2)return send({ws},{type:'error',message:'房間不存在、已滿，或這是人機房間'});p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家2').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);broadcast(x);
    }else if(m.action==='matchmake'){
      if(x||p)return send({ws},{type:'error',message:'你已經在房間中'});const mm=normalizeMode(m.mode);p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};const item={ws,p,mode:mm,cancelled:false,assign:room=>{x=room;}};matchmakingQueue.push(item);send(p,{type:'matchmaking',status:'searching',mode:mm});tryMatchmaking();
    }else if(m.action==='cancelMatchmake'){
      if(p&&!x){removeFromMatchmaking(p);send(p,{type:'matchmaking',status:'cancelled'});}
    }else if(m.action==='ai'){
      const mode=normalizeMode(m.mode),difficulty=['easy','normal','hard'].includes(m.difficulty)?m.difficulty:'normal';x={id:roomId(),mode,g:newGame(mode),players:[],ai:true,aiColor:mode==='xiangqi'?'black':'white',difficulty,matchmade:false,rps:{phase:'done',choices:{},result:null,winnerPid:null},undoStack:[],proposal:null,rematchInvite:null,chat:[]};rooms.set(x.id,x);p={ws,pid:pid(),profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:mode==='xiangqi'?'red':'black',connected:true};x.players.push(p);x.g.turn=p.color;setTurnDeadline(x);send(p,{type:'room',roomId:null,pid:p.pid,color:p.color,mode:x.mode,difficulty,matchmade:false});send(p,snapshot(x,p));
    }else if(!x||!p)return;
    else if(m.action==='rps'&&!x.ai){
      if(x.players.length<2)return send(p,{type:'error',message:'請等待另一位玩家加入'});if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不是猜拳階段'});if(!['剪刀','石頭','布'].includes(m.choice))return send(p,{type:'error',message:'猜拳選項無效'});if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你本輪已經出拳，請等待結果'});x.rps.choices[p.pid]=m.choice;if(x.players.every(q=>x.rps.choices[q.pid]))resolveRps(x);else broadcast(x);
    }else if(m.action==='chooseColor'&&!x.ai){const e=chooseColor(x,p,m.color);if(e)send(p,{type:'error',message:e});
    }else if(m.action==='chat'){
      if(x.ai)return send(p,{type:'error',message:'單人模式沒有聊天室'});if(x.rps.phase!=='done'||!x.g.turn)return send(p,{type:'error',message:'正式對局開始後才能聊天'});const text=String(m.text||'').trim().slice(0,200);if(!text)return;x.chat.push({pid:p.pid,name:p.name,avatar:p.avatar,text,ts:Date.now()});if(x.chat.length>100)x.chat=x.chat.slice(-100);broadcast(x);
    }else if(m.action==='move'){
      const res=applyMove(x,p,m);if(res.error)send(p,{type:'error',message:res.error});else{const checkId=x.g.checkEvent?.id;broadcast(x);if(checkId)setTimeout(()=>{if(x.g.checkEvent?.id===checkId){x.g.checkEvent=null;broadcast(x);}},1500);if(x.ai&&!x.g.winner&&x.g.turn===x.aiColor)setTimeout(()=>aiTurn(x),500);}
    }else if(m.action==='proposal'){
      if(x.ai&&m.kind==='undo'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束，不能悔棋'});if(x.undoStack.length<2)return send(p,{type:'error',message:'還沒有完整的一輪可以悔回'});
        x.undoStack.pop();x.g=clone(x.undoStack.pop());x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;x.g.checkEvent=null;setTurnDeadline(x);broadcast(x);
      }else if(x.ai&&m.kind==='draw')return send(p,{type:'error',message:'單人模式不提供求和請求'});
      else{const e=propose(x,p,m.kind);if(e)send(p,{type:'error',message:e});}
    }else if(m.action==='proposalResponse'){handleProposalResponse(x,p,!!m.accept);
    }else if(m.action==='inviteRematch'&&!x.ai){
      if(!x.g.winner)return send(p,{type:'error',message:'對局結束後才能邀請再戰'});if(x.rematchInvite)return send(p,{type:'error',message:'已經有再戰邀請正在等待'});const other=x.players.find(q=>q.pid!==p.pid);if(!other)return send(p,{type:'error',message:'對方目前不在房間'});x.rematchInvite={fromPid:p.pid,toPid:other.pid};send(other,{type:'rematch-invite',fromName:p.name,roomId:x.id,ended:true});broadcast(x);
    }else if(m.action==='rematchResponse'&&!x.ai){
      const inv=x.rematchInvite;if(!inv||inv.toPid!==p.pid)return send(p,{type:'error',message:'沒有等待中的再戰邀請'});x.rematchInvite=null;if(m.accept){resetOnlineRound(x);broadcast(x);}else{const inviter=x.players.find(z=>z.pid===inv.fromPid);if(inviter)send(inviter,{type:'notice',message:`${p.name} 暫時不進行下一場。`});broadcast(x);}
    }else if(m.action==='aiRematch'&&x.ai){x.g=newGame(x.mode);x.g.turn=x.players[0].color;x.undoStack=[];x.checkEvent=null;setTurnDeadline(x);broadcast(x);}
  });
  ws.on('close',()=>{
    if(p&&!x){removeFromMatchmaking(p);return;}if(!x||!p)return;const online=!x.ai,hadTwo=x.players.length===2;x.players=x.players.filter(q=>q!==p);
    if(!x.players.length){rooms.delete(x.id);return;}
    if(online&&hadTwo){const survivor=x.players[0];if(!x.g.winner){endGame(x,survivor.color,survivor.pid,'對方已斷線，你方獲勝！');}x.proposal=null;x.rematchInvite=null;x.rps.phase='done';broadcast(x);}else broadcast(x);
  });
});
setInterval(()=>{for(const x of rooms.values())if(x.g?.turnDeadline&&Date.now()>x.g.turnDeadline&&!x.g.winner)timeOut(x);},500);
server.listen(PORT,()=>console.log(`Xiangqi Online v2.8 on ${PORT}`));
